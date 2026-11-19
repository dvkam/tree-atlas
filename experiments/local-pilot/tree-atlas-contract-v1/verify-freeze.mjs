import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async file => JSON.parse(await readFile(resolve(root,file)));
const seal = await read('freeze-v1.json');
const lock = await read('baseline.lock.json');
assert.equal(seal.status, 'frozen-local');
assert.equal(process.version, lock.referenceRuntime.node);
assert.equal(process.versions.unicode, lock.referenceRuntime.unicode);
assert.equal(process.versions.icu, lock.referenceRuntime.icu);
function confined(base, file) {
  const target = resolve(base,file);
  assert.ok(target.startsWith(base+sep), 'Path leaves its root');
  return target;
}
for (const entry of seal.files) {
  const bytes = await readFile(confined(root,entry.file));
  assert.equal(bytes.length,entry.bytes,entry.file);
  assert.equal(hash(bytes),entry.sha256,entry.file);
}
for (const args of [['reference/selftest.mjs'],['reference/compare-candidate.mjs','--selftest']]) {
  const result = spawnSync(process.execPath,[resolve(root,args[0]),...args.slice(1)],{stdio:'inherit'});
  assert.equal(result.status,0,args[0]);
}
const independentHashes = spawnSync('python3',[resolve(root,'reference/check-query-key-goldens.py')],{stdio:'inherit'});
assert.equal(independentHashes.status,0,'Independent literal query-key hashes');
const lifecycle = await read('lifecycle-cases.json');
assert.equal(new Set(lifecycle.cases.map(item=>item.id)).size,lifecycle.cases.length);
let assets = 0;
if (process.argv.includes('--assets')) {
  const data = resolve(root,'../tree-atlas/public/data');
  const auditBytes = await readFile(resolve(root,lock.assetAudit.file));
  assert.equal(hash(auditBytes),lock.assetAudit.sha256);
  const audit = JSON.parse(auditBytes);
  const seen = new Set();
  for (const dataset of audit.datasets) for (const asset of dataset.assets) {
    assert.ok(!seen.has(asset.file),'Duplicate asset path');
    seen.add(asset.file);
    const bytes = await readFile(confined(data,asset.file));
    assert.equal(bytes.length,asset.bytes,asset.file);
    assert.equal(hash(bytes),asset.sha256,asset.file);
    assets++;
  }
  assert.equal(assets,lock.assetAudit.verifiedAssetCount);
  for (const entry of [lock.manifest,{file:lock.manifest.provenance,sha256:lock.manifest.provenanceSha256}])
    assert.equal(hash(await readFile(confined(data,entry.file))),entry.sha256,entry.file);
}
console.log(JSON.stringify({passed:true,sealedFiles:seal.files.length,assetsRechecked:assets,
  lifecycleCases:lifecycle.cases.length,lifecycleExecution:'not-run; future adapter acceptance cases',
  databaseImport:false,deployment:false},null,2));
