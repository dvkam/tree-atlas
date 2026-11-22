import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { assertRuntime, fields, normalize, inside, interpret, matches, suggest, queryKey } from './oracle.mjs';

assertRuntime();
const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
export const base = { q: '', area: null, viewport: [-180, -90, 180, 90], zoom: 12, offset: 0, limit: 100 };
let assertions = 0;
for (const [input, expected] of fixtures.normalization) {
  assert.equal(normalize(input), expected); assertions++;
}
function checkCase(test, predicate = matches) {
  const result = interpret(fixtures.rows, { ...base, ...test }, predicate);
  assert.deepEqual(result.ids, test.ids, test.name);
  assert.equal(result.total, test.ids.length, test.name);
  assert.deepEqual(result.items, test.items ?? test.ids.slice(test.offset ?? 0, (test.offset ?? 0) + (test.limit ?? 100)));
  if (test.viewportIds) assert.deepEqual(result.viewportIds, test.viewportIds);
  return result;
}
for (const test of fixtures.queries) { checkCase(test); assertions += 3 + (test.viewportIds ? 1 : 0); }
const complete = interpret(fixtures.rows, base);
assert.equal(complete.locatedTotal, 5); assertions++;
for (const test of fixtures.suggestions.cases) {
  assert.deepEqual(suggest(fixtures.suggestions.dictionary, test.q), test.expected); assertions++;
}
for (const invalid of [{ q: 'x'.repeat(501) }, { q: '\ud800' }, { q: '🌳'.repeat(251) }, { offset: -1 },
  { offset: Number.MAX_SAFE_INTEGER + 1 }, { limit: 101 },
  { area: [1, 0, 0, 1] }, { viewport: null }, { viewport: [0, 0, NaN, 1] }, { zoom: 25 }]) {
  assert.throws(() => interpret(fixtures.rows, { ...base, ...invalid })); assertions++;
}
assert.equal(interpret(fixtures.rows, { ...base, q: '🌳'.repeat(250) }).total, 0); assertions++;
for (const invalid of ['x'.repeat(501), '\ud800', '🌳'.repeat(251), null, 12]) {
  assert.throws(() => suggest(fixtures.suggestions.dictionary, invalid)); assertions++;
}
assert.deepEqual(suggest(fixtures.suggestions.dictionary, '🌳'.repeat(250)), []); assertions++;
// Hash literal JSON input independently checked with Python hashlib, not this normalizer.
assert.equal(queryKey('vienna', 'test-release', { ...base, q: 'ÉRABLE', limit: 25 }),
  '94c169eadc0783cca93156daab852eac14a9f061571690a5164401b0ff20a699'); assertions++;
assert.equal(queryKey('vienna', 'test-release', { ...base, q: 'ÉRABLE', limit: 25, offset: -0 }),
  '94c169eadc0783cca93156daab852eac14a9f061571690a5164401b0ff20a699'); assertions++;
assert.equal(queryKey('vienna', 'test-release', { ...base, q: 'ÉRABLE', limit: 25, offset: 25 }),
  'a5f2bfabee802c885e17ec9bd80b8de143bfea6d25ec6f7bb2b6057ddc83ec07'); assertions++;
assert.equal(queryKey('vienna', 'test-release', { ...base, q: 'ÉRABLE', limit: 25, viewport: [-1, -1, 1, 1] }),
  '7cb34a4cfe217852470cc60b1cfd7782cdc7e911bad2fddca17d5ae516919512'); assertions++;
for (const test of fixtures.recordSets) {
  assert.deepEqual(interpret(test.rows, base).ids, test.expectedIds, test.name); assertions++;
}
const mutants = {
  caseSensitive: (row, query) => matches(row, query, (value) => value.trim()),
  tokenized: (row, query) => normalize(query.q).split(/\s+/u).every((term) =>
    fields.some((field) => row[field] !== null && normalize(row[field]).includes(term))) &&
    (query.area === null || inside(query.area, row.position)),
  joinedFields: (row, query) => fields.map((field) => row[field] ?? '').join(' ').toLowerCase().includes(query.q.toLowerCase()) &&
    (query.area === null || inside(query.area, row.position)),
  dropsUnlocated: (row, query) => row.position !== null && matches(row, query),
  viewportFiltersList: (row, query) => inside(query.viewport, row.position) && matches(row, query),
  excludesBoundary: (row, query) => matches(row, query) && (query.area === null ||
    row.position !== null && row.position[0] > query.area[0] && row.position[0] < query.area[2] &&
    row.position[1] > query.area[1] && row.position[1] < query.area[3]),
};
const killed = [];
for (const [name, predicate] of Object.entries(mutants)) {
  assert.throws(() => { for (const test of fixtures.queries) checkCase(test, predicate); }, `Undetected mutant ${name}`);
  killed.push(name);
}
// A truncated successful page must be caught independently of its reported count.
assert.throws(() => assert.deepEqual(complete.ids.slice(0, 3), fixtures.queries[0].ids));
killed.push('silentTruncation');
const coincident = fixtures.recordSets[0];
assert.throws(() => assert.deepEqual(interpret(coincident.rows.filter((row) => row.status !== 'removed'), base).ids, coincident.expectedIds));
killed.push('dropsRemoved');
assert.throws(() => assert.deepEqual(interpret([coincident.rows[0]], base).ids, coincident.expectedIds));
killed.push('deduplicatesCoordinates');
const report = { scope: 'literal synthetic specification checks, no app or database',
  node: process.version, unicode: process.versions.unicode, assertions,
  normalizationGoldens: fixtures.normalization.length, queryGoldens: fixtures.queries.length,
  killedMutants: killed, passed: true };
if (process.argv.includes('--record')) writeFileSync(new URL('./selftest-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
