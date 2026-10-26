import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  boundsSchema,
  contains,
  datasetIdSchema,
  datasetSchema,
  manifestSchema,
} from "../src/domain.ts";
import { importInventory } from "../src/import.ts";
import { packInventory } from "./pack.ts";

const sourceSchema = z.looseObject({
  id: datasetIdSchema,
  file: z.string().regex(/^[a-z]+-[a-f0-9]+\.json$/u),
  sha256: z.string(),
  count: z.number().int().positive(),
  bbox: boundsSchema,
  retrievedAt: z.iso.datetime(),
  url: z.url(),
  licence: z.string(),
  licenceUrl: z.url(),
  attribution: z.string(),
  coverage: z.string(),
  scope: z.enum(["study", "full"]).optional(),
});
const rawRoot = resolve("data/raw");
const output = resolve("public/data");
const rawProvenance = await readFile(resolve(rawRoot, "provenance.json"), "utf8");
const provenance = z
  .object({ sources: z.array(sourceSchema).min(1) })
  .parse(JSON.parse(rawProvenance));
if (new Set(provenance.sources.map((source) => source.id)).size !== provenance.sources.length)
  throw new Error("Missing or repeated dataset");
const names = {
  vienna: ["Vienna", "Austria"],
  geneva: ["Geneva", "Switzerland"],
  porto: ["Porto", "Portugal"],
  amsterdam: ["Amsterdam", "Netherlands"],
  hamburg: ["Hamburg", "Germany"],
  zurich: ["Zürich", "Switzerland"],
} as const;
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
async function prepareSource(source: z.infer<typeof sourceSchema>) {
  const raw = await readFile(resolve(rawRoot, source.file));
  if (hash(raw) !== source.sha256) throw new Error(`Raw checksum mismatch: ${source.id}`);
  const imported = importInventory(source.id, JSON.parse(raw.toString("utf8")));
  if (imported.length !== source.count) throw new Error(`Count mismatch: ${source.id}`);
  const trees = imported
    .filter((tree) => tree.position === null || contains(source.bbox, tree.position))
    .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  if (source.scope === "full" && trees.length !== imported.length)
    throw new Error("Full inventory must not discard records outside its declared bounds");
  // Immutable identity includes the evidence and metadata, not only tree rows.
  const identity = createHash("sha256").update(
    JSON.stringify({ normalizationVersion: 2, storageVersion: 3, source }),
  );
  for (const tree of trees) identity.update(JSON.stringify(tree));
  const release = `${source.id}-${identity.digest("hex").slice(0, 16)}`;
  const { bytes, files, descriptor } = packInventory(source.id, release, trees);
  const [city, country] = names[source.id];
  const [w, s, e, n] = source.bbox;
  const dataset = datasetSchema.parse({
    id: source.id,
    city,
    country,
    center: [(w + e) / 2, (s + n) / 2],
    bounds: source.bbox,
    ...(source.id === "amsterdam" ? { viewBounds: [4.7, 52.25, 5.1, 52.45] } : {}),
    release,
    file: `releases/${release}/${source.id}.json`,
    sha256: hash(bytes),
    count: trees.length,
    locatedCount: trees.filter((tree) => tree.position !== null).length,
    fetchedAt: source.retrievedAt,
    sourceUrl: source.url,
    license: source.licence,
    licenseUrl: source.licenceUrl,
    attribution: source.attribution,
    coverage: source.coverage,
    scope: source.scope ?? "study",
  });
  return {
    dataset,
    bytes,
    files,
    sourceProvenance: JSON.stringify(source),
    report: {
      dataset: source.id,
      release,
      downloaded: imported.length,
      published: trees.length,
      excludedByCoverage: imported.length - trees.length,
      rejected: 0,
      unlocated: trees.filter((tree) => tree.position === null).length,
      rawSha256: source.sha256,
      indexBytes: files.find((f) => f.name === "index.bin")?.bytes.length,
      detailShardCount: descriptor.details.length,
      compressedBytes: files.reduce((sum, f) => sum + f.bytes.length, 0),
      qualityWarnings: trees
        .filter((tree) => tree.qualityNotes !== undefined)
        .map((tree) => ({ sourceId: tree.sourceId, notes: tree.qualityNotes })),
      identityConflicts: imported
        .filter((tree) => tree.dataset === "geneva" && tree.sourceId.includes(":object:"))
        .map((tree) => ({
          sourceId: tree.sourceId,
          reason:
            "Repeated ID_ARBRE in the source; this row uses a release-scoped object-qualified identity.",
        })),
    },
  };
}
// Process sources sequentially so full inventories do not multiply peak import memory.
const prepared = [];
for (const source of provenance.sources) prepared.push(await prepareSource(source));
const provenancePath = `provenance/${hash(rawProvenance)}.json`;
const manifest = manifestSchema.parse({
  version: 1,
  publishedAt: new Date().toISOString(),
  provenance: provenancePath,
  datasets: prepared.map((p) => p.dataset),
});
await mkdir(output, { recursive: true });
async function writeImmutable(path: string, content: string | Buffer) {
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    if (!(await readFile(path)).equals(Buffer.from(content)))
      throw new Error("Immutable release collision", { cause: error });
  }
}
// Immutable files are written before the small manifest pointer is replaced.
for (const { dataset, bytes, report, sourceProvenance, files } of prepared) {
  const dir = resolve(output, "releases", dataset.release);
  await mkdir(dir, { recursive: true });
  for (const file of files) await writeImmutable(resolve(dir, file.name), file.bytes);
  for (const [name, content] of [
    [`${dataset.id}.json`, bytes],
    ["dataset.json", JSON.stringify(dataset)],
    ["report.json", JSON.stringify(report)],
    ["provenance.json", sourceProvenance],
  ]) {
    if (name === undefined || content === undefined) throw new Error("Missing release asset");
    const path = resolve(dir, name);
    await writeImmutable(path, content);
  }
}
await mkdir(resolve(output, "provenance"), { recursive: true });
await writeImmutable(resolve(output, provenancePath), rawProvenance);
const staging = resolve(output, "manifest-staging");
await mkdir(staging, { recursive: true });
const nextManifest = resolve(staging, `${process.pid}.json`);
try {
  await writeFile(nextManifest, JSON.stringify(manifest, null, 2), { flag: "wx" });
  // Windows file watchers can briefly hold a reader without delete sharing.
  // Retry the atomic replacement; never delete the live pointer as a workaround.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(nextManifest, resolve(output, "manifest.json"));
      break;
    } catch (error) {
      if (
        attempt >= 5 ||
        !(error instanceof Error) ||
        !("code" in error) ||
        !["EPERM", "EBUSY", "EACCES"].includes(String(error.code))
      )
        throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100 * 2 ** attempt));
    }
  }
} finally {
  await rm(nextManifest, { force: true });
}
process.stdout.write(
  `Published ${prepared.map((p) => `${p.dataset.city}: ${p.dataset.count}`).join(", ")}\n`,
);
