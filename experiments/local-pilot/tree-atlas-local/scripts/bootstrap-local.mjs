// Copy metadata only. Original public app and source assets are read-only inputs.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frozen = resolve(root, "../tree-atlas-contract-v1");
const lock = JSON.parse(await readFile(resolve(frozen, "baseline.lock.json")));
const old = JSON.parse(await readFile(resolve(root, "../tree-atlas/public/data/manifest.json")));
const reference = JSON.parse(await readFile(resolve(frozen, "reference/reference-results.json")));
const datasets = lock.datasets.map((pin) => {
  const dataset = old.datasets.find(
    (value) => value.id === pin.id && value.release === pin.release,
  );
  if (!dataset || dataset.sha256 !== pin.sha256 || dataset.count !== pin.count)
    throw Error("Frozen catalogue changed");
  return pin;
});
await mkdir(resolve(root, "public/data"), { recursive: true });
await mkdir(resolve(root, "evidence"), { recursive: true });
await writeFile(resolve(root, "public/data/manifest.json"), JSON.stringify({ ...old, datasets }));
await writeFile(
  resolve(root, "public/data/local-config.json"),
  JSON.stringify({
    contractVersion: "1.0.0",
    fingerprints: Object.fromEntries(
      reference.datasets.map((item) => [item.dataset, item.contentSha256]),
    ),
  }),
);
const bytes = await readFile(resolve(frozen, "freeze-v1.json"));
await writeFile(
  resolve(root, "evidence/bootstrap.json"),
  JSON.stringify(
    {
      baseCommit: lock.appCommit,
      freezeSha256: createHash("sha256").update(bytes).digest("hex"),
      datasets: datasets.map((item) => ({
        dataset: item.id,
        release: item.release,
        count: item.count,
      })),
      originalAppChanged: false,
      deployment: false,
    },
    null,
    2,
  ),
);
console.log("Prepared four frozen local catalogue entries; no inventory copied or published");
