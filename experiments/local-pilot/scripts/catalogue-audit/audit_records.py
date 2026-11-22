"""Check published detail records against the search index, without application code."""

import argparse
import array
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys
import time


TEXT_FIELDS = ('tag', 'scientificName', 'commonName', 'location')
BROKEN_TEXT = re.compile(r'\ufffd|\u00c3[\x80-\xbf]|\u00c2[\x80-\xbf]|\u00e2\u20ac')
PLACEHOLDER = re.compile(r'null|undefined|unknown|not recorded|n/a|0|-|none|non renseigné', re.I)
MEASUREMENTS = (('height', 'm', 100), ('crown', 'm', 100), ('circumference', 'cm', 3000))


def check(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_report(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n',
                         encoding='utf-8')
    temporary.replace(path)


def read_asset(root, ref, counts):
    path = (root / ref['file']).resolve(strict=True)
    path.relative_to(root)
    data = path.read_bytes()
    check(digest(data) == ref['sha256'], f"SHA-256 mismatch in {ref['file']}")
    if path.suffix == '.bin':
        counts['compressedAssetsRead'] += 1
        return gzip.decompress(data)
    return data


def column(data, offset, count, kind):
    values = array.array(kind)
    width = values.itemsize
    check(width == (8 if kind == 'd' else 4), 'Unsupported native numeric width')
    size = width * count
    decoded = bytearray(size)
    for lane in range(width):
        decoded[lane::width] = data[offset + lane * count:offset + (lane + 1) * count]
    values.frombytes(decoded)
    if sys.byteorder != 'little':
        values.byteswap()
    return values, offset + size


def match_pin(envelope, city, versions):
    check(envelope['dataset'] == city['id'] and envelope['release'] == city['release'],
          'Dataset or release pin mismatch')
    check(envelope['version'] in versions, f"Unsupported envelope version {envelope['version']}")


def index_reader(root, city, descriptor, counts):
    raw = read_asset(root, descriptor['index'], counts)
    size = city['count']
    check(descriptor['index']['count'] == size, 'Index asset count mismatch')
    if raw.startswith(b'{'):
        header = json.loads(raw)
        match_pin(header, city, (2,))
        rows = header['rows']
        check(len(rows) == size, 'Index row count mismatch')
        get_row = rows.__getitem__
    else:
        length, = struct.unpack_from('<I', raw)
        offset = 4 + length
        header = json.loads(raw[4:offset])
        match_pin(header, city, (3, 4))
        ids = header['ids']
        separate = header['version'] == 4
        check(len(ids) == size, 'Column ID count mismatch')
        check(len(raw) == offset + size * (20 if separate else 36), 'Column byte length mismatch')
        if separate:
            geometry_ref = descriptor['geometry']
            check(geometry_ref['count'] == size, 'Geometry count mismatch')
            geometry = read_asset(root, geometry_ref, counts)
            check(len(geometry) == 16 * size, 'Geometry byte length mismatch')
            x, following = column(geometry, 0, size, 'd')
            y, _ = column(geometry, following, size, 'd')
        else:
            x, offset = column(raw, offset, size, 'd')
            y, offset = column(raw, offset, size, 'd')
        columns = []
        for _ in range(5):
            values, offset = column(raw, offset, size, 'i')
            columns.append(values)

        def get_row(i):
            lon, lat = x[i], y[i]
            return (ids[i], None if math.isnan(lon) else lon,
                    None if math.isnan(lat) else lat, *(values[i] for values in columns))

    version = header['version']
    split = version == 4
    check((descriptor['version'] == 3) == split and ('geometry' in descriptor) == split,
          'Descriptor and index disagree on split geometry')
    check(descriptor['index'].get('encoding') == {2: None, 3: 'columns-v1', 4: 'text-columns-v1'}[version],
          'Descriptor index encoding mismatch')
    strings = header['strings']
    check(all(isinstance(value, str) for value in strings), 'Invalid index dictionary')
    return version, strings, get_row


def quality(tree, fetched, flags, counts):
    for key in (*TEXT_FIELDS, 'age', 'observedAt'):
        value = tree[key]
        if value is None:
            counts['missing_' + key] += 1
        else:
            if not value.strip():
                flags['emptyText'] += 1
            if BROKEN_TEXT.search(value):
                flags['replacementOrMojibakeText'] += 1
            if PLACEHOLDER.fullmatch(value):
                counts['placeholder_' + key] += 1
    if tree.get('qualityNotes'):
        counts['withQualityNotes'] += 1
    year = tree['plantingYear']
    if year is not None:
        check(type(year) is int and 1000 <= year <= 2200, 'Invalid planting year')
        if year > int(fetched[:4]):
            flags['plantingYearAfterAcquisition'] += 1
    observed = tree['observedAt']
    if observed and observed[:10] > fetched[:10]:
        flags['observationAfterAcquisition'] += 1
    if observed and year and str(year) > observed[:4]:
        flags['plantingAfterObservation'] += 1
    for key, unit, threshold in MEASUREMENTS:
        measure = tree[key]
        kind = measure['kind']
        if kind == 'unknown':
            continue
        check(kind in ('over', 'value', 'range') and measure['unit'] == unit, 'Invalid ' + key)
        high = measure['max'] if kind == 'range' else measure['value']
        check(math.isfinite(high) and high > 0, 'Invalid ' + key + ' magnitude')
        if kind == 'range':
            check(0 <= measure['min'] < high, 'Invalid ' + key + ' range')
        if high > threshold:
            flags['extreme_' + key] += 1


def audit(root, city):
    counts, flags = Counter(), Counter()
    descriptor = json.loads(read_asset(root, city, counts))
    match_pin(descriptor, city, (2, 3))
    version, strings, row_at = index_reader(root, city, descriptor, counts)
    ids = set()
    west, south, east, north = city['bounds']
    for shard_i, ref in enumerate(descriptor['details']):
        shard = json.loads(read_asset(root, ref, counts))
        match_pin(shard, city, (1,))
        check(len(shard['trees']) == ref['count'], 'Detail shard count mismatch')
        for tree in shard['trees']:
            i = counts['records']
            if i >= city['count']:
                raise ValueError('Excess detail rows')
            row = row_at(i)
            source_id = tree['sourceId']
            where = f"{city['id']} detail row {i}"
            check(len(row) == 8 and tree['dataset'] == city['id'] and row[7] == shard_i,
                  where + ': dataset, row width or shard reference mismatch')
            check(isinstance(source_id, str) and source_id and source_id == source_id.strip() and
                  row[0] == source_id and source_id not in ids, where + ': invalid or duplicate ID')
            ids.add(source_id)
            for key, number in zip(TEXT_FIELDS, row[3:7]):
                check(type(number) is int and -1 <= number < len(strings),
                      where + ': invalid dictionary reference')
                check((None if number == -1 else strings[number]) == tree[key],
                      where + ': ' + key + ' differs')
            lon, lat = row[1:3]
            pos = tree['position']
            if pos is None:
                check(lon is None and lat is None, where + ': unexpected index coordinate')
            else:
                check(pos == [lon, lat] and lon is not None and lat is not None and
                      -180 <= lon <= 180 and -90 <= lat <= 90 and west <= lon <= east and
                      south <= lat <= north, where + ': invalid or unequal coordinates')
                if lon == 0 or lat == 0:
                    flags['zeroCoordinate'] += 1
                counts['located'] += 1
            counts['records'] += 1
            quality(tree, city['fetchedAt'], flags, counts)
    check(counts['records'] == city['count'] and counts['located'] == city['locatedCount'],
          'Manifest detail totals mismatch')
    catalog = json.loads(read_asset(root, city['map'], counts))
    match_pin(catalog, city, (1,))
    nodes = catalog['nodes']
    check(catalog['locatedCount'] == counts['located'] and
          (nodes[0]['count'] if nodes else 0) == counts['located'] and
          sum(node['count'] for node in nodes if 'asset' in node) == counts['located'],
          'Map catalogue totals mismatch')
    return {'dataset': city['id'], 'release': city['release'], 'indexVersion': version,
            'counts': dict(counts), 'sourceQualityFlags': dict(flags)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--city', action='append')
    args = parser.parse_args()
    repo = args.repo.resolve(strict=True)
    root = (repo / 'public/data').resolve(strict=True)
    output = args.output.resolve()
    check(repo != output and repo not in output.parents, 'Output must be outside the input checkout')
    raw = (root / 'manifest.json').read_bytes()
    manifest = json.loads(raw)
    check(manifest['version'] == 1, 'Unknown manifest version')
    datasets = manifest['datasets']
    ids = [item['id'] for item in datasets]
    check(ids and len(ids) == len(set(ids)), 'Empty manifest or duplicate dataset IDs')
    selected = ids if args.city is None else args.city
    check(len(set(selected)) == len(selected) and set(selected) <= set(ids),
          'Unknown or repeated --city')
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    summary = {'manifestSha256': digest(raw), 'selected': selected, 'finished': False,
               'checkedAt': datetime.now(timezone.utc).isoformat(), 'inventories': []}
    report_path = output / 'records.json'
    write_report(report_path, summary)
    for city in datasets:
        if city['id'] not in selected:
            continue
        try:
            result = audit(root, city)
        except (KeyError, IndexError, ValueError, OSError, TypeError, struct.error, EOFError) as exc:
            summary['failure'] = {'dataset': city['id'], 'release': city['release'], 'error': str(exc)}
            write_report(report_path, summary)
            raise ValueError(f"{city['id']}: {exc}") from exc
        summary['inventories'].append(result)
        write_report(report_path, summary)
        print(f"{city['id']}: {result['counts']['records']} records", flush=True)
    summary['finished'] = True
    summary['elapsedSeconds'] = round(time.monotonic() - started, 3)
    write_report(report_path, summary)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        sys.exit(str(error))
