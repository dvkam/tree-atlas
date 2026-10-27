import { locations } from "../src/datasets.ts";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../data/raw/", import.meta.url);
if (!process.argv.includes("--merge-only")) {
  for (const file of [
    "download-sources.mjs",
    "download-new-sources.mjs",
    "download-uk-sources.mjs",
    "download-expansion-south.mjs",
    "download-expansion-north.mjs",
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`Source acquisition failed: ${file}`);
  }
}
const sources = [];
const blocked = [];
for (const file of [
  "original-provenance.json",
  "new-provenance.json",
  "uk-provenance.json",
  "south-provenance.json",
  "north-provenance.json",
]) {
  const evidence = JSON.parse(await readFile(new URL(file, root), "utf8"));
  sources.push(...evidence.sources);
  blocked.push(...(evidence.blocked ?? []));
}
const ids = sources.map((source) => source.id);
if (
  new Set(ids).size !== ids.length ||
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
const registered = locations.map((location) => location.id);
const covered = [...ids, ...blocked.map((entry) => entry.id)];
if (
  new Set(covered).size !== covered.length ||
  covered.some((id) => !registered.includes(id)) ||
  registered.some((id) => !covered.includes(id))
)
  throw new Error(
    "Every registered location must have acquired evidence or an explicit source blocker",
  );
if (
  blocked.some(
    (entry) =>
      typeof entry.reason !== "string" ||
      !entry.reason.trim() ||
      typeof entry.url !== "string" ||
      !entry.url.startsWith("https://"),
  )
)
  throw new Error("Source blockers need a reason and official evidence URL");
const temporary = new URL(`all-provenance-${process.pid}.tmp`, root);
await writeFile(
  temporary,
  JSON.stringify(
    { schemaVersion: 1, acquiredAt: new Date().toISOString(), sources, blocked },
    null,
    2,
  ),
);
await rename(temporary, new URL("provenance.json", root));
console.log(`Combined evidence for ${sources.length} acquired inventories`);
