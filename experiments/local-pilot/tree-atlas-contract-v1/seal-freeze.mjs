// One-time local seal. A revised contract gets a new version, not silent repinning.
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(resolve(root, file)));
const lockBytes = await readFile(resolve(root, 'baseline.lock.json'));
const lock = JSON.parse(lockBytes);
const result = await json('reference/reference-results.json');
const selftest = await json('reference/selftest-results.json');
const review = await json('evidence/review-results.json');
assert.equal(result.baselineLockSha256, hash(lockBytes));
assert.equal(result.totalRecords, lock.totalRecords);
assert.equal(result.passed, true);
assert.equal(selftest.passed, true);
assert.equal(review.verdict, 'accept-local-contract-freeze');
const files = [];
async function visit(directory) {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (/\.(?:json|md|mjs|py)$/.test(entry.name) && entry.name !== 'freeze-v1.json') {
      const bytes = await readFile(path);
      files.push({file:relative(root,path).replaceAll('\\','/'), sha256:hash(bytes), bytes:bytes.length});
    }
  }
}
await visit(root);
files.sort((a,b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
const seal = {contract:lock.contract, version:'1.0.0', status:'frozen-local', date:'2026-11-08',
  appCommit:lock.appCommit, totalRecords:lock.totalRecords,
  verified:['literal reference and mutation sentinels','canonical frozen-record audit','stored asset integrity','independent subagent review'],
  notRun:['database import','PostgreSQL/PostGIS inventory conformance','remote adapter','offline pack implementation','browser journeys','production performance','deployment'],
  files};
await writeFile(resolve(root, 'freeze-v1.json'), JSON.stringify(seal,null,2)+'\n', {flag:'wx'});
console.log(`Sealed ${files.length} local artifacts; no imports or deployment.`);
