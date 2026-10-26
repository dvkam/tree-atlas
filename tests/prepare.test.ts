import { decodeIndexColumns } from "../src/index-codec.ts";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { gunzipSync } from "node:zlib";
import { indexDescriptorSchema, compactIndexSchema } from "../src/index-format.ts";
import { releaseSchema } from "../src/domain.ts";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/prepare.ts", import.meta.url));
const loader = import.meta.resolve("tsx");
const workspaces: string[] = [];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const manifestShape = z.object({
  provenance: z.string(),
  datasets: z.array(
    z.object({
      id: z.string(),
      release: z.string(),
      count: z.number(),
      fetchedAt: z.string(),
      file: z.string(),
      sha256: z.string(),
    }),
  ),
});

async function fixture() {
  const cwd = await mkdtemp(resolve(tmpdir(), "tree-atlas-prepare-"));
  workspaces.push(cwd);
  const rawRoot = resolve(cwd, "data/raw");
  await mkdir(rawRoot, { recursive: true });
  const rows = {
    vienna: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1, 1] },
          properties: { OBJECTID: 10 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [3, 3] },
          properties: { OBJECTID: 11 },
        },
      ],
    },
    geneva: {
      spatialReference: { wkid: 4326 },
      features: [
        { attributes: { OBJECTID: 20, ID_ARBRE: 7 }, geometry: { x: 1, y: 1 } },
        { attributes: { OBJECTID: 21, ID_ARBRE: 7 }, geometry: { x: 1.1, y: 1.1 } },
      ],
    },
    porto: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1, 1] },
          properties: { objectid: 30, arv_intervalo_idade: "11-20" },
        },
      ],
    },
  };
  const sources = await Promise.all(
    Object.entries(rows).map(async ([id, row]) => {
      const bytes = JSON.stringify(row);
      const sha256 = digest(bytes);
      const file = `${id}-${sha256}.json`;
      await writeFile(resolve(rawRoot, file), bytes);
      return {
        id,
        file,
        sha256,
        count: row.features.length,
        bbox: [0, 0, 2, 2],
        retrievedAt: "2026-10-26T00:00:00.000Z",
        url: "https://example.org/source",
        licence: "Test fixture only",
        licenceUrl: "https://example.org/licence",
        attribution: "Synthetic test data",
        coverage: "Test box",
        scope: "study",
        requests: [{ url: "https://example.org/request", sha256 }],
      };
    }),
  );
  async function save() {
    await writeFile(resolve(rawRoot, "provenance.json"), JSON.stringify({ sources }));
  }
  await save();
  return { cwd, rawRoot, sources, save };
}
async function prepare(cwd: string) {
  return run(process.execPath, ["--import", loader, script], { cwd, timeout: 20_000 });
}
async function manifest(cwd: string) {
  return manifestShape.parse(
    JSON.parse(await readFile(resolve(cwd, "public/data/manifest.json"), "utf8")),
  );
}
afterEach(async () => {
  for (const cwd of workspaces.splice(0)) {
    if (!cwd.startsWith(`${resolve(tmpdir())}${sep}tree-atlas-prepare-`))
      throw new Error("Unexpected cleanup path");
    await rm(cwd, { recursive: true, force: true });
  }
});

test("publishes complete clipped releases with immutable provenance and structured identity conflicts", async () => {
  const f = await fixture();
  await prepare(f.cwd);
  const current = await manifest(f.cwd);
  expect(current.datasets.map((d) => [d.id, d.count])).toEqual([
    ["vienna", 1],
    ["geneva", 2],
    ["porto", 1],
  ]);
  expect(current.provenance).toMatch(/^provenance\/[a-f0-9]{64}\.json$/u);
  expect(await readFile(resolve(f.cwd, "public/data", current.provenance), "utf8")).toBe(
    await readFile(resolve(f.rawRoot, "provenance.json"), "utf8"),
  );
  for (const dataset of current.datasets) {
    const bytes = await readFile(resolve(f.cwd, "public/data", dataset.file), "utf8");
    expect(digest(bytes)).toBe(dataset.sha256);
    const descriptor = indexDescriptorSchema.parse(JSON.parse(bytes));
    const indexBytes = await readFile(resolve(f.cwd, "public/data", descriptor.index.file));
    expect(createHash("sha256").update(indexBytes).digest("hex")).toBe(descriptor.index.sha256);
    const unpacked = gunzipSync(indexBytes);
    const index =
      descriptor.index.encoding === "columns-v1"
        ? decodeIndexColumns(unpacked)
        : compactIndexSchema.parse(JSON.parse(unpacked.toString("utf8")));
    expect(index.rows).toHaveLength(dataset.count);
    const rows = [];
    for (const shard of descriptor.details) {
      const detailBytes = await readFile(resolve(f.cwd, "public/data", shard.file));
      expect(createHash("sha256").update(detailBytes).digest("hex")).toBe(shard.sha256);
      rows.push(...releaseSchema.parse(JSON.parse(gunzipSync(detailBytes).toString("utf8"))).trees);
    }
    expect(rows.map((t) => t.sourceId)).toEqual(index.rows.map((r) => r[0]));
  }
  const geneva = current.datasets.find((d) => d.id === "geneva");
  if (!geneva) throw new Error("Geneva fixture missing");
  const report = z
    .object({ identityConflicts: z.array(z.object({ sourceId: z.string() })) })
    .parse(
      JSON.parse(
        await readFile(
          resolve(f.cwd, "public/data/releases", geneva.release, "report.json"),
          "utf8",
        ),
      ),
    );
  expect(report.identityConflicts.map((r) => r.sourceId)).toEqual(["7:object:20", "7:object:21"]);
});

test("identical inputs are repeatable, while changed acquisition metadata creates a coherent release", async () => {
  const f = await fixture();
  await prepare(f.cwd);
  const first = await manifest(f.cwd);
  await prepare(f.cwd);
  expect((await manifest(f.cwd)).datasets).toEqual(first.datasets);
  for (const source of f.sources) source.retrievedAt = "2026-10-27T00:00:00.000Z";
  await f.save();
  await prepare(f.cwd);
  const second = await manifest(f.cwd);
  expect(second.datasets.map((d) => d.release)).not.toEqual(first.datasets.map((d) => d.release));
  for (const dataset of second.datasets) {
    const stored = z
      .object({ release: z.string(), fetchedAt: z.string() })
      .parse(
        JSON.parse(
          await readFile(
            resolve(f.cwd, "public/data/releases", dataset.release, "dataset.json"),
            "utf8",
          ),
        ),
      );
    expect(stored.release).toBe(dataset.release);
    expect(stored.fetchedAt).toBe("2026-10-27T00:00:00.000Z");
  }
});

test("full-source publication retains every record beyond the original study window", async () => {
  const f = await fixture();
  for (const source of f.sources) {
    source.scope = "full";
    source.bbox = [0, 0, 4, 4];
  }
  await f.save();
  await prepare(f.cwd);
  expect((await manifest(f.cwd)).datasets.map((d) => [d.id, d.count])).toEqual([
    ["vienna", 2],
    ["geneva", 2],
    ["porto", 1],
  ]);
  const before = await readFile(resolve(f.cwd, "public/data/manifest.json"), "utf8");
  const first = f.sources[0];
  if (!first) throw new Error("Missing fixture");
  first.bbox = [0, 0, 2, 2];
  await f.save();
  await expect(prepare(f.cwd)).rejects.toThrow("Full inventory must not discard");
  expect(await readFile(resolve(f.cwd, "public/data/manifest.json"), "utf8")).toBe(before);
});

test.each(["checksum", "count", "duplicate-dataset", "empty-window", "geometry"] as const)(
  "rejects %s without replacing the previous publication",
  async (failure) => {
    const f = await fixture();
    await prepare(f.cwd);
    const before = await readFile(resolve(f.cwd, "public/data/manifest.json"), "utf8");
    const source = f.sources[0];
    if (!source) throw new Error("Fixture source missing");
    if (failure === "checksum") source.sha256 = "0".repeat(64);
    if (failure === "count") source.count = 999;
    if (failure === "duplicate-dataset") source.id = "porto";
    if (failure === "empty-window") source.bbox = [5, 5, 6, 6];
    if (failure === "geometry") {
      const malformed = JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 100] },
            properties: { OBJECTID: 10 },
          },
        ],
      });
      source.sha256 = digest(malformed);
      source.count = 1;
      await writeFile(resolve(f.rawRoot, source.file), malformed);
    }
    await f.save();
    const expected = {
      checksum: /Raw checksum mismatch/u,
      count: /Count mismatch/u,
      "duplicate-dataset": /Missing or repeated dataset/u,
      "empty-window": /too_small/u,
      geometry: /too_big/u,
    };
    await expect(prepare(f.cwd)).rejects.toThrow(expected[failure]);
    expect(await readFile(resolve(f.cwd, "public/data/manifest.json"), "utf8")).toBe(before);
  },
);

test("rejects a changed immutable descriptor rather than ignoring its collision", async () => {
  const f = await fixture();
  await prepare(f.cwd);
  const current = await manifest(f.cwd);
  const dataset = current.datasets[0];
  if (!dataset) throw new Error("Fixture dataset missing");
  const before = await readFile(resolve(f.cwd, "public/data/manifest.json"), "utf8");
  await writeFile(
    resolve(f.cwd, "public/data/releases", dataset.release, "dataset.json"),
    '{"tampered":true}',
  );
  await expect(prepare(f.cwd)).rejects.toThrow(/Immutable release collision/u);
  expect(await readFile(resolve(f.cwd, "public/data/manifest.json"), "utf8")).toBe(before);
});

test("a blocked final manifest write leaves the existing publication and its provenance unchanged", async () => {
  const f = await fixture();
  await prepare(f.cwd);
  const current = await manifest(f.cwd);
  const before = await readFile(resolve(f.cwd, "public/data/manifest.json"), "utf8");
  const priorProvenance = await readFile(resolve(f.cwd, "public/data", current.provenance), "utf8");
  for (const source of f.sources) source.retrievedAt = "2026-10-28T00:00:00.000Z";
  await f.save();
  await rm(resolve(f.cwd, "public/data/manifest-staging"), { recursive: true });
  await writeFile(resolve(f.cwd, "public/data/manifest-staging"), "blocked staging directory");
  await expect(prepare(f.cwd)).rejects.toThrow(/EEXIST|ENOTDIR/u);
  expect(await readFile(resolve(f.cwd, "public/data/manifest.json"), "utf8")).toBe(before);
  expect(await readFile(resolve(f.cwd, "public/data", current.provenance), "utf8")).toBe(
    priorProvenance,
  );
});
