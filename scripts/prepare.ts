import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
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
import { loadSourceTrees } from "./source-loader.ts";
import { locationDefinition } from "../src/datasets.ts";
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
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
async function prepareSource(source: z.infer<typeof sourceSchema>) {
  const imported = await loadSourceTrees(source.id, resolve(rawRoot, source.file), source.sha256);
  if (imported.length !== source.count) throw new Error(`Count mismatch: ${source.id}`);
  const trees = imported
    .filter((tree) => tree.position === null || contains(source.bbox, tree.position))
    .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  if (source.scope === "full" && trees.length !== imported.length)
    throw new Error("Full inventory must not discard records outside its declared bounds");
  // Immutable identity includes the evidence and metadata, not only tree rows.
  const identity = createHash("sha256").update(
    JSON.stringify({ normalizationVersion: 2, storageVersion: 6, source }),
  );
  for (const tree of trees) identity.update(JSON.stringify(tree));
  const release = `${source.id}-${identity.digest("hex").slice(0, 16)}`;
  const { bytes, files, descriptor, map } = packInventory(source.id, release, trees);
  const { city, country } = locationDefinition(source.id);
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
    map,
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
      indexBytes: files.find((f) => f.name === "text.bin" || f.name === "index.bin")?.bytes.length,
      geometryBytes: files.find((f) => f.name === "geometry.bin")?.bytes.length,
      detailShardCount: descriptor.details.length,
      compressedBytes: files.reduce((sum, f) => sum + f.bytes.length, 0),
      qualityWarningCount: trees.filter((tree) => tree.qualityNotes !== undefined).length,
      qualityWarnings: trees
        .filter((tree) => tree.qualityNotes !== undefined)
        .slice(0, 1000)
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
// Retain only dataset metadata between sources, not compressed inventories.
const datasets = [];
let previous = null;
if (process.argv.includes("--reuse-unchanged")) {
  try {
    previous = manifestSchema.parse(
      JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8")),
    );
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}
for (const source of provenance.sources) {
  const existing = previous?.datasets.find((dataset) => dataset.id === source.id);
  if (existing !== undefined) {
    const directory = resolve(output, "releases", existing.release);
    const evidence = JSON.parse(await readFile(resolve(directory, "provenance.json"), "utf8"));
    if (JSON.stringify(evidence) === JSON.stringify(source)) {
      const descriptorBytes = await readFile(resolve(output, existing.file));
      if (
        hash(descriptorBytes) !== existing.sha256 ||
        (await readFile(resolve(directory, "dataset.json"), "utf8")) !== JSON.stringify(existing)
      )
        throw new Error("Immutable release collision");
      const descriptor = z
        .object({
          version: z.number().int(),
          index: z.object({ encoding: z.string() }).optional(),
        })
        .parse(JSON.parse(descriptorBytes.toString("utf8")));
      if (source.id !== "london" || descriptor.index?.encoding === "text-columns-v1") {
        const digest = createHash("sha256");
        for await (const bytes of createReadStream(resolve(rawRoot, source.file)))
          digest.update(bytes);
        if (digest.digest("hex") !== source.sha256)
          throw new Error(`Raw checksum mismatch: ${source.id}`);
        datasets.push(existing);
        continue;
      }
    }
  }
  const { dataset, bytes, report, sourceProvenance, files } = await prepareSource(source);
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
  datasets.push(dataset);
  process.stdout.write(`Prepared ${dataset.city}: ${dataset.count} records\n`);
}
const provenancePath = `provenance/${hash(rawProvenance)}.json`;
const manifest = manifestSchema.parse({
  version: 1,
  publishedAt: new Date().toISOString(),
  provenance: provenancePath,
  datasets,
});
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
  `Published ${datasets.map((dataset) => `${dataset.city}: ${dataset.count}`).join(", ")}\n`,
);
