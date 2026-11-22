// Read existing local releases only. Never fetch, prepare, import or publish.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const app = resolve(root, '../tree-atlas');
const data = resolve(app, 'public/data');
const expectedCommit = '8fb090145c0852a83dec1038fa663e7ba15e0de3';
const pins = {
  london: ['london-316fa121a19059da', 1111784],
  vienna: ['vienna-2925984ab1dd6276', 233102],
  geneva: ['geneva-a3456b2d943dc57d', 240827],
  porto: ['porto-6be0471b6c303ac2', 71634],
};
if (process.versions.unicode !== '17.0') throw Error('Frozen reference requires Unicode 17.0');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const appCommit = execFileSync('git', ['-C', app, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
if (appCommit !== expectedCommit) throw Error('Baseline commit changed; do not silently repin');
const bytes = await readFile(resolve(data, 'manifest.json'));
const manifest = JSON.parse(bytes);
const auditBytes = await readFile(resolve(root, 'evidence/source-asset-audit.json'));
const audit = JSON.parse(auditBytes);
if (audit.baselineGitHead !== appCommit || audit.manifest.sha256 !== hash(bytes))
  throw Error('Asset audit does not bind this baseline');
const datasets = [];
for (const [id, [release, count]] of Object.entries(pins)) {
  const dataset = manifest.datasets.find(entry => entry.id === id);
  if (!dataset || dataset.release !== release || dataset.count !== count || dataset.locatedCount !== count)
    throw Error(`Baseline identity/count mismatch: ${id}`);
  const descriptor = await readFile(resolve(data, dataset.file));
  if (hash(descriptor) !== dataset.sha256) throw Error(`Descriptor mismatch: ${id}`);
  const provenanceFile = `releases/${release}/provenance.json`;
  const provenance = await readFile(resolve(data, provenanceFile));
  const audited = audit.datasets.find(entry => entry.id === id);
  if (!audited || audited.missingAssets.length || audited.digestMismatches.length ||
      audited.assets.some(asset => !asset.sha256Verified)) throw Error(`Asset audit failed: ${id}`);
  datasets.push({...dataset, descriptor: JSON.parse(descriptor), provenanceFile,
    provenanceSha256: hash(provenance), importNormalizerVersion: null,
    versionNote: 'Legacy publication does not declare an authoritative import-normalizer version; do not infer one from the current preparation code.'});
}
const lock = {contract: 'tree-atlas-search-release-v1', contractVersion: '1.0.0',
  frozenOn: '2026-11-08', appCommit, searchNormalizer: 'nfd-diacritic-unicode17-default-lower-trim-v1',
  referenceRuntime: {node: process.version, unicode: process.versions.unicode, icu: process.versions.icu},
  assetAudit: {file: 'evidence/source-asset-audit.json', sha256:hash(auditBytes),
    verifiedAssetCount:audit.assetCountIncludingMetadata, storedBytes:audit.assetBytesIncludingMetadata},
  manifest: {file:'manifest.json', sha256:hash(bytes), publishedAt:manifest.publishedAt,
    provenance: manifest.provenance, provenanceSha256:hash(await readFile(resolve(data,manifest.provenance)))},
  totalRecords: datasets.reduce((sum, item) => sum + item.count, 0), datasets};
await writeFile(resolve(root, 'baseline.lock.json'), JSON.stringify(lock, null, 2) + '\n');
console.log(`Pinned ${datasets.length} existing releases, ${lock.totalRecords} records; no inventory imported.`);
