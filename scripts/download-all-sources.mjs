import { spawnSync } from "node:child_process";
import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../data/raw/", import.meta.url);
if (!process.argv.includes("--merge-only")) {
  for (const file of [
    "download-sources.mjs",
    "download-new-sources.mjs",
    "download-uk-sources.mjs",
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`Source acquisition failed: ${file}`);
  }
}
const sources = [];
for (const file of ["original-provenance.json", "new-provenance.json", "uk-provenance.json"]) {
  const evidence = JSON.parse(await readFile(new URL(file, root), "utf8"));
  sources.push(...evidence.sources);
}
const ids = sources.map((source) => source.id);
if (
  new Set(ids).size !== 10 ||
  ![
    "vienna",
    "geneva",
    "porto",
    "amsterdam",
    "hamburg",
    "zurich",
    "london",
    "camden",
    "edinburgh",
    "belfast",
  ].every((id) => ids.includes(id))
)
  throw new Error("Incomplete or repeated acquisition set");
const temporary = new URL(`all-provenance-${process.pid}.tmp`, root);
await writeFile(
  temporary,
  JSON.stringify({ schemaVersion: 1, acquiredAt: new Date().toISOString(), sources }, null, 2),
);
await rename(temporary, new URL("provenance.json", root));
console.log(`Combined evidence for ${sources.length} complete source acquisitions`);
