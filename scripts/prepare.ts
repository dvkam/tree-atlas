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
  releaseSchema,
} from "../src/domain.ts";
import { importInventory } from "../src/import.ts";

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
});
const rawRoot = resolve("data/raw");
const output = resolve("public/data");
const rawProvenance = await readFile(resolve(rawRoot, "provenance.json"), "utf8");
const provenance = z
  .object({ sources: z.array(sourceSchema).length(3) })
  .parse(JSON.parse(rawProvenance));
if (new Set(provenance.sources.map((source) => source.id)).size !== 3)
  throw new Error("Missing or repeated dataset");
const names = {
  vienna: ["Vienna", "Austria"],
  geneva: ["Geneva", "Switzerland"],
  porto: ["Porto", "Portugal"],
} as const;
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const prepared = await Promise.all(
  provenance.sources.map(async (source) => {
    const raw = await readFile(resolve(rawRoot, source.file));
    if (hash(raw) !== source.sha256) throw new Error(`Raw checksum mismatch: ${source.id}`);
    const imported = importInventory(source.id, JSON.parse(raw.toString("utf8")));
    if (imported.length !== source.count) throw new Error(`Count mismatch: ${source.id}`);
    const trees = imported
      .filter((tree) => contains(source.bbox, tree.position))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    // Immutable identity includes the evidence and metadata, not only tree rows.
    const release = `${source.id}-${hash(JSON.stringify({ normalizationVersion: 1, source, trees })).slice(0, 16)}`;
    const snapshot = releaseSchema.parse({ version: 1, dataset: source.id, release, trees });
    const bytes = JSON.stringify(snapshot);
    const [city, country] = names[source.id];
    const [w, s, e, n] = source.bbox;
    const dataset = datasetSchema.parse({
      id: source.id,
      city,
      country,
      center: [(w + e) / 2, (s + n) / 2],
      bounds: source.bbox,
      release,
      file: `releases/${release}/${source.id}.json`,
      sha256: hash(bytes),
      count: trees.length,
      fetchedAt: source.retrievedAt,
      sourceUrl: source.url,
      license: source.licence,
      licenseUrl: source.licenceUrl,
      attribution: source.attribution,
      coverage: source.coverage,
    });
    return {
      dataset,
      bytes,
      sourceProvenance: JSON.stringify(source),
      report: {
        dataset: source.id,
        release,
        downloaded: imported.length,
        published: trees.length,
        excludedByCoverage: imported.length - trees.length,
        rejected: 0,
        rawSha256: source.sha256,
        identityConflicts: imported
          .filter((tree) => tree.dataset === "geneva" && tree.sourceId.includes(":object:"))
          .map((tree) => ({
            sourceId: tree.sourceId,
            reason:
              "Repeated ID_ARBRE in the source; this row uses a release-scoped object-qualified identity.",
          })),
      },
    };
  }),
);
const provenancePath = `provenance/${hash(rawProvenance)}.json`;
const manifest = manifestSchema.parse({
  version: 1,
  publishedAt: new Date().toISOString(),
  provenance: provenancePath,
  datasets: prepared.map((p) => p.dataset),
});
await mkdir(output, { recursive: true });
async function writeImmutable(path: string, content: string) {
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    if ((await readFile(path, "utf8")) !== content)
      throw new Error("Immutable release collision", { cause: error });
  }
}
// Immutable files are written before the small manifest pointer is replaced.
for (const { dataset, bytes, report, sourceProvenance } of prepared) {
  const dir = resolve(output, "releases", dataset.release);
  await mkdir(dir, { recursive: true });
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
  await rename(nextManifest, resolve(output, "manifest.json"));
} finally {
  await rm(nextManifest, { force: true });
}
process.stdout.write(
  `Published ${prepared.map((p) => `${p.dataset.city}: ${p.dataset.count}`).join(", ")}\n`,
);
