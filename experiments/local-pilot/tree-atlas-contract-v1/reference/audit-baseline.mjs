// Read-only independent audit of already prepared local canonical records.
// Never imports source data, opens PostgreSQL, downloads, or imports app code.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRuntime, contentLine, fields, identityLine, inside, normalize, sha256, suggest, queryKey } from './oracle.mjs';

assertRuntime();
const contractRoot = fileURLToPath(new URL('../', import.meta.url));
const lockPath = resolve(process.argv[2] ?? resolve(contractRoot, 'baseline.lock.json'));
const dataRoot = resolve(process.argv[3] ?? resolve(contractRoot, '../tree-atlas/public/data'));
const outputPath = resolve(process.argv[4] ?? fileURLToPath(new URL('./reference-results.json', import.meta.url)));
const lockBytes = await readFile(lockPath);
const lock = JSON.parse(lockBytes);
assert.equal(lock.appCommit, '8fb090145c0852a83dec1038fa663e7ba15e0de3');
assert.equal(lock.referenceRuntime.unicode, process.versions.unicode);
assert.equal(lock.referenceRuntime.node, process.version);
assert.equal(lock.referenceRuntime.icu, process.versions.icu);
function localPath(file) {
  const path = resolve(dataRoot, file);
  assert.ok(path.startsWith(dataRoot + sep), 'Asset path leaves data root');
  return path;
}
async function verified(file, expected) {
  const bytes = await readFile(localPath(file));
  assert.equal(sha256(bytes), expected, `Hash mismatch: ${file}`);
  return bytes;
}
const manifest = JSON.parse(await verified(lock.manifest.file, lock.manifest.sha256));
await verified(lock.manifest.provenance, lock.manifest.provenanceSha256);
const report = {
  contract: lock.contract, baselineLockSha256: sha256(lockBytes), appCommit: lock.appCommit,
  runtime: { node: process.version, unicode: process.versions.unicode, icu: process.versions.icu },
  scope: 'Read-only canonical-detail oracle; no upstream completeness, importer, database or backend conformance claim',
  digestEncoding: {
    identity: 'UTF-8 JSON([dataset,release,sourceId]) + LF, in prepared ordinal order',
    content: 'UTF-8 JSON fixed record tuple (see oracle.mjs contentLine), recursively UTF-16-key-sorted objects + LF',
  }, datasets: [],
};
let total = 0;
const started = performance.now();
for (const dataset of lock.datasets) {
  const live = manifest.datasets.find((value) => value.id === dataset.id);
  assert.equal(live?.release, dataset.release);
  assert.equal(live?.sha256, dataset.sha256);
  const descriptor = JSON.parse(await verified(dataset.file, dataset.sha256));
  assert.equal(descriptor.dataset, dataset.id);
  assert.equal(descriptor.release, dataset.release);
  assert.equal(descriptor.details.reduce((sum, asset) => sum + asset.count, 0), dataset.count);
  const [w, s, e, n] = dataset.bounds;
  const viewport = [w + (e - w) / 4, s + (n - s) / 4, e - (e - w) / 4, n - (n - s) / 4];
  const definitions = [
    { name: 'all', q: '' }, { name: 'one-character', q: 'a' },
    { name: 'common-genus', q: 'acer' }, { name: 'rare-genus', q: 'torreya' },
    { name: 'literal-percent', q: '%' }, { name: 'literal-underscore', q: '_' },
    { name: 'literal-backslash', q: '\\' }, { name: 'leading-zeros', q: '0007' },
    { name: 'no-match-sentinel', q: '__tree_atlas_no_match_☃__' },
    { name: 'full-inclusive-area', q: '', area: dataset.bounds },
    { name: 'central-area', q: '', area: viewport },
    { name: 'viewport-independent-list', q: '', viewport },
  ];
  const states = definitions.map((definition) => ({ definition, term: normalize(definition.q),
    total: 0, locatedTotal: 0, viewportLocatedTotal: 0,
    ids: createHash('sha256'), viewportIds: createHash('sha256'),
    first: [], middle: [], ring: new Array(25),
  }));
  const ids = new Set();
  const dictionarySet = new Set();
  const dictionary = [];
  const identityDigest = createHash('sha256');
  const contentDigest = createHash('sha256');
  let count = 0, located = 0, previous = null;
  const idScopes = {}, statuses = {};
  for (const asset of descriptor.details) {
    const compressed = await verified(asset.file, asset.sha256);
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(gunzipSync(compressed)));
    assert.equal(parsed.dataset, dataset.id);
    assert.equal(parsed.release, dataset.release);
    assert.equal(parsed.trees.length, asset.count);
    for (const row of parsed.trees) {
      assert.equal(row.dataset, dataset.id);
      assert.equal(typeof row.sourceId, 'string');
      assert.ok(row.sourceId.length > 0 && row.sourceId.isWellFormed());
      assert.ok(!ids.has(row.sourceId), 'Duplicate source identity');
      assert.ok(previous === null || previous < row.sourceId, 'Prepared source-ID order mismatch');
      previous = row.sourceId;
      ids.add(row.sourceId);
      assert.ok(['stable', 'release'].includes(row.idScope));
      assert.ok(['existing', 'removed', 'unknown'].includes(row.status));
      idScopes[row.idScope] = (idScopes[row.idScope] ?? 0) + 1;
      statuses[row.status] = (statuses[row.status] ?? 0) + 1;
      if (row.position !== null) {
        assert.ok(Array.isArray(row.position) && row.position.length === 2 && row.position.every(Number.isFinite));
        assert.ok(inside(dataset.bounds, row.position));
        located++;
      }
      for (const key of fields.slice(1)) assert.ok(row[key] === null || typeof row[key] === 'string');
      for (const key of fields.slice(1)) {
        const original = row[key];
        if (original !== null && !dictionarySet.has(original)) {
          dictionarySet.add(original); dictionary.push(original);
        }
      }
      const normalized = fields.map((field) => row[field] === null ? null : normalize(row[field]));
      const line = identityLine(dataset.id, dataset.release, row.sourceId);
      identityDigest.update(line);
      contentDigest.update(contentLine(count, row));
      count++;
      for (const state of states) {
        const query = state.definition;
        if (query.area && !inside(query.area, row.position)) continue;
        if (state.term !== '' && !normalized.some((value) => value !== null && value.indexOf(state.term) !== -1)) continue;
        const index = state.total++;
        state.ids.update(line);
        if (row.position !== null) state.locatedTotal++;
        if (inside(query.viewport ?? dataset.bounds, row.position)) {
          state.viewportLocatedTotal++; state.viewportIds.update(line);
        }
        if (index < 25) state.first.push(row.sourceId);
        if (index >= Math.floor(dataset.count / 2) && index < Math.floor(dataset.count / 2) + 25)
          state.middle.push(row.sourceId);
        state.ring[index % 25] = row.sourceId;
      }
    }
  }
  assert.equal(count, dataset.count);
  assert.equal(located, dataset.locatedCount);
  const result = { dataset: dataset.id, release: dataset.release, count, locatedCount: located,
    unlocatedCount: count - located, idScopes, statuses, uniqueIds: ids.size,
    identitySha256: identityDigest.digest('hex'), contentSha256: contentDigest.digest('hex'),
    detailAssetsVerified: descriptor.details.length,
    suggestions: {
      dictionaryOrder: 'first raw occurrence in prepared ordinal, then tag/scientificName/commonName/location order; exact raw deduplication',
      dictionaryCount: dictionary.length,
      dictionarySha256: sha256(dictionary.map((value) => JSON.stringify(value) + '\n').join('')),
      cases: ['a', 'acer', 'pl', 'Ér'].map((q) => ({ q, values: suggest(dictionary, q) })),
    },
    queries: states.map((state) => {
      const lastOffset = state.total === 0 ? 0 : Math.floor((state.total - 1) / 25) * 25;
      const last = [];
      for (let index = lastOffset; index < state.total; index++) last.push(state.ring[index % 25]);
      const pageQueries = [
        { kind: 'first', offset: 0, limit: 25, ids: state.first },
        { kind: 'cohort-midpoint-offset', offset: Math.floor(dataset.count / 2), limit: 25, ids: state.middle },
        { kind: 'last-aligned', offset: lastOffset, limit: 25, ids: last },
        { kind: 'beyond-end', offset: state.total + 1, limit: 25, ids: [] },
      ];
      return { ...state.definition, area: state.definition.area ?? null, zoom: 12,
        viewport: state.definition.viewport ?? dataset.bounds,
        total: state.total, locatedTotal: state.locatedTotal, viewportLocatedTotal: state.viewportLocatedTotal,
        orderedIdentitySha256: state.ids.digest('hex'), viewportIdentitySha256: state.viewportIds.digest('hex'),
        pages: pageQueries.map((page) => ({ ...page, queryKey: queryKey(dataset.id, dataset.release,
          { q: state.definition.q, area: state.definition.area ?? null,
            viewport: state.definition.viewport ?? dataset.bounds, zoom: 12, offset: page.offset, limit: page.limit }) })),
      };
    }),
  };
  report.datasets.push(result);
  total += count;
  console.log(JSON.stringify({ dataset: dataset.id, count, identitySha256: result.identitySha256 }));
}
assert.equal(total, lock.totalRecords);
report.totalRecords = total;
report.elapsedMs = Math.round(performance.now() - started);
report.passed = true;
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, totalRecords: total, elapsedMs: report.elapsedMs }));
