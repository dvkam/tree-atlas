import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = resolve(root, "../tree-atlas-contract-v1");
const lock = JSON.parse(readFileSync(resolve(contract, "baseline.lock.json")));
const audit = JSON.parse(readFileSync(resolve(contract, "evidence/source-asset-audit.json")));
const plans = [];
for (const dataset of lock.datasets) {
  const files = [
    dataset.file,
    dataset.descriptor.index.file,
    ...(dataset.descriptor.geometry ? [dataset.descriptor.geometry.file] : []),
  ];
  const recorded = audit.datasets.find((item) => item.id === dataset.id);
  const assets = files.map((file) => {
    const item = recorded.assets.find((entry) => entry.file === file);
    if (!item || !item.sha256Verified) throw Error("Missing verified offline asset " + file);
    return { file: item.file, sha256: item.sha256, bytes: item.bytes };
  });
  plans.push({
    dataset: dataset.id,
    release: dataset.release,
    descriptorSha256: dataset.sha256,
    bytes: assets.reduce((sum, item) => sum + item.bytes, 0),
    assets,
  });
}
writeFileSync(resolve(root, "src/offline-pack-plans.json"), JSON.stringify(plans, null, 2) + "\n");
console.log(JSON.stringify(plans.map(({ dataset, bytes }) => ({ dataset, bytes }))));
