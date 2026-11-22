"""Exercise both readers at their command lines with one synthetic publication."""

import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parent
READERS = {
    'records': [sys.executable, str(SCRIPTS / 'audit_records.py')],
    'map': [os.environ.get('NODE', 'node'), str(SCRIPTS / 'audit-map.mjs')],
}


def publish(repo, *, search_id='tree-a', map_id='tree-a'):
    base = repo / 'public/data'
    base.mkdir(parents=True, exist_ok=True)

    def asset(name, body):
        payload = json.dumps(body).encode()
        if name.endswith('.bin'):
            payload = gzip.compress(payload, mtime=0)
        (base / name).write_bytes(payload)
        return {'file': name, 'sha256': hashlib.sha256(payload).hexdigest(), 'count': 1}

    pin = {'dataset': 'example', 'release': 'example-one'}
    tree = {'dataset': 'example', 'sourceId': 'tree-a', 'position': [1, 2], 'tag': None,
            'commonName': None, 'scientificName': 'Tilia', 'location': None, 'age': None,
            'observedAt': None, 'plantingYear': 2001,
            'height': {'kind': 'unknown'}, 'crown': {'kind': 'unknown'},
            'circumference': {'kind': 'unknown'}}
    shard = asset('details.bin', {**pin, 'version': 1, 'trees': [tree]})
    index = asset('index.bin', {**pin, 'version': 2, 'strings': ['Tilia'],
                               'rows': [[search_id, 1, 2, -1, 0, -1, -1, 0]]})
    desc = asset('descriptor.json', {**pin, 'version': 2, 'index': index, 'details': [shard]})
    leaf = asset('leaf.bin', {**pin, 'version': 1, 'trees': [{**tree, 'sourceId': map_id}]})
    box = [0, 0, 3, 3]
    catalog = asset('map.bin', {**pin, 'version': 1, 'locatedCount': 1,
                                'nodes': [{'count': 1, 'asset': leaf, 'bounds': box, 'position': [1, 2]}]})
    dataset = {**desc, 'id': 'example', 'release': pin['release'], 'bounds': box,
               'locatedCount': 1, 'map': catalog, 'fetchedAt': '2000-01-01T00:00:00Z'}
    (base / 'manifest.json').write_text(json.dumps({'version': 1, 'datasets': [dataset]}))


class AuditTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.repo = self.root / 'checkout'
        publish(self.repo)

    def run_reader(self, name, output, *options):
        return subprocess.run([*READERS[name], '--repo', str(self.repo), '--output',
                               str(output), *options], capture_output=True, text=True)

    def test_fresh_reports_keep_quality_flags_and_refuse_reuse(self):
        for name in READERS:
            with self.subTest(name=name):
                output = self.root / name
                args = ('--city', 'example')
                passed = self.run_reader(name, output, *args)
                self.assertEqual(passed.returncode, 0, passed.stderr)
                file = output / (name + '.json')
                before = file.read_bytes()
                report = json.loads(before)
                self.assertTrue(report['finished'])
                if name == 'records':
                    self.assertEqual(report['inventories'][0]['sourceQualityFlags'],
                                     {'plantingYearAfterAcquisition': 1})
                self.assertNotEqual(self.run_reader(name, output, *args).returncode, 0)
                self.assertEqual(file.read_bytes(), before)
                self.assertNotEqual(self.run_reader(name, self.repo / name).returncode, 0)
                self.assertFalse((self.repo / name).exists())
                self.assertNotEqual(self.run_reader(name, self.root / 'unused',
                                                    '--city', 'absent').returncode, 0)

    def test_well_hashed_but_mismatched_rows_fail(self):
        publish(self.repo, search_id='wrong', map_id='wrong')
        for name in READERS:
            with self.subTest(name=name):
                result = self.run_reader(name, self.root / name)
                self.assertNotEqual(result.returncode, 0)
                report = json.loads((self.root / name / (name + '.json')).read_bytes())
                self.assertFalse(report['finished'])
                self.assertEqual(report['failure']['dataset'], 'example')
                self.assertEqual(report['inventories'], [])


if __name__ == '__main__':
    unittest.main()
