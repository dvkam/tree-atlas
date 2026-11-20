// Future adapter membership checker. It hashes actual returned IDs, never a
// candidate's claimed digest. Running its self-test is NOT a backend pass.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { assertRuntime, identityLine, queryKey, sha256, normalize, validateQuery } from './oracle.mjs';

export async function compare(reference, entries) {
  assertRuntime();
  const cases = new Map();
  for (const dataset of reference.datasets) for (const expected of dataset.queries) {
    cases.set(`${dataset.dataset}\0${expected.name}`, { dataset, expected,
      nextOffset: 0, count: 0, hash: createHash('sha256'), complete: false });
  }
  let pages = 0;
  for await (const entry of entries) {
    const state = cases.get(`${entry.dataset}\0${entry.case}`);
    assert.ok(state && !state.complete, 'Unknown case or extra page after completion');
    const { dataset, expected } = state;
    const request = entry.request;
    const response = entry.response;
    validateQuery(request);
    assert.equal(entry.release, dataset.release);
    assert.equal(normalize(request.q), normalize(expected.q));
    assert.deepEqual(request.area, expected.area);
    assert.deepEqual(request.viewport, expected.viewport);
    assert.equal(request.zoom, expected.zoom);
    assert.equal(request.offset, state.nextOffset, 'Skipped, repeated or unordered page');
    assert.equal(response.contractVersion, '1.0.0');
    assert.equal(response.dataset, dataset.dataset);
    assert.equal(response.release, dataset.release);
    assert.ok(typeof request.requestKey === 'string' && request.requestKey.length > 0);
    assert.equal(response.requestKey, request.requestKey);
    assert.equal(response.queryKey, queryKey(dataset.dataset, dataset.release, request));
    assert.equal(response.total, expected.total);
    assert.equal(response.locatedTotal, expected.locatedTotal);
    assert.equal(response.viewportLocatedTotal, expected.viewportLocatedTotal);
    assert.notEqual(response.spatialReady, false, 'Not a complete spatial result');
    assert.ok(Array.isArray(response.items));
    assert.equal(response.items.length, Math.max(0, Math.min(request.limit, expected.total - request.offset)),
      'Partial or oversized successful page');
    for (const item of response.items) {
      assert.equal(item.dataset, dataset.dataset);
      assert.ok(typeof item.sourceId === 'string' && item.sourceId.length > 0);
      state.hash.update(identityLine(dataset.dataset, dataset.release, item.sourceId));
      state.count++;
    }
    pages++;
    state.nextOffset += request.limit;
    if (state.nextOffset >= expected.total) {
      assert.equal(state.count, expected.total);
      assert.equal(state.hash.digest('hex'), expected.orderedIdentitySha256,
        'Returned full membership or ordinal order differs from independent reference');
      state.complete = true;
    }
  }
  for (const state of cases.values()) assert.ok(state.complete, 'Missing query or truncated enumeration');
  return { passed: true, cases: cases.size, pages,
    scope: 'Full list membership/order/counts/query correlation only; not importer, geometry/detail, map expansion, offline, or performance conformance' };
}

async function selftest() {
  const ids = ['0007', '10', '2'];
  const dataset = 'vienna', release = 'test-release';
  const expected = { name: 'all', q: '', area: null, viewport: [-180, -90, 180, 90], zoom: 12,
    total: 3, locatedTotal: 2, viewportLocatedTotal: 2,
    orderedIdentitySha256: sha256(ids.map((id) => identityLine(dataset, release, id)).join('')) };
  const reference = { datasets: [{ dataset, release, queries: [expected] }] };
  const entries = [0, 2].map((offset) => {
    const request = { q: '', area: null, viewport: expected.viewport, zoom: 12, offset, limit: 2,
      requestKey: `caller-${offset}` };
    return { dataset, release, case: 'all', request,
      response: { contractVersion: '1.0.0', dataset, release, requestKey: request.requestKey,
        queryKey: queryKey(dataset, release, request), total: 3, locatedTotal: 2, viewportLocatedTotal: 2,
        items: ids.slice(offset, offset + 2).map((sourceId) => ({ dataset, sourceId })) } };
  });
  await compare(reference, entries);
  const mutations = {
    wrongMembership: (value) => { value[1].response.items[0].sourceId = 'other'; },
    wrongOrder: (value) => { value[0].response.items.reverse(); },
    wrongCount: (value) => { value[0].response.total = 2; },
    truncation: (value) => { value.pop(); },
    wrongQueryKey: (value) => { value[0].response.queryKey = '0'.repeat(64); },
    releaseMix: (value) => { value[0].response.release = 'another-release'; },
    staleRequest: (value) => { value[0].response.requestKey = 'old-caller'; },
  };
  for (const mutate of Object.values(mutations)) {
    const bad = structuredClone(entries); mutate(bad);
    await assert.rejects(() => compare(reference, bad));
  }
  const report = { passed: true, scope: 'Synthetic checker self-test, not backend conformance',
    rejectedMutants: Object.keys(mutations) };
  if (process.argv.includes('--record'))
    await writeFile(new URL('./candidate-checker-selftest.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv.includes('--selftest')) await selftest();
else if (process.argv[2] && process.argv[3]) {
  const reference = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const input = createInterface({ input: createReadStream(process.argv[3]), crlfDelay: Infinity });
  async function* entries() { for await (const line of input) if (line.trim()) yield JSON.parse(line); }
  console.log(JSON.stringify(await compare(reference, entries()), null, 2));
}
