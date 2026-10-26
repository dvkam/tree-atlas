import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadDataset, loadManifest, loadRelease, searchInventory } from "./catalog.ts";
import { datasetSchema, releaseSchema, treeSchema } from "./domain.ts";
import type { Dataset, Release } from "./domain.ts";

const base = "https://atlas.test/data/";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const tree = treeSchema.parse({
  dataset: "vienna",
  sourceId: "1",
  idScope: "release",
  position: [16, 48],
  tag: "42",
  scientificName: "Acer campestre",
  commonName: "Feldahorn",
  location: "Kegelgasse",
  height: { kind: "unknown" },
  crown: { kind: "unknown" },
  circumference: { kind: "unknown" },
  plantingYear: null,
  plantingEstimated: false,
  age: null,
  observedAt: null,
  status: "unknown",
});
const release: Release = { version: 1, dataset: "vienna", release: "r1", trees: [tree] };
const bytes = JSON.stringify(release);
const dataset: Dataset = {
  id: "vienna",
  city: "Vienna",
  country: "Austria",
  center: [16, 48],
  bounds: [15, 47, 17, 49],
  release: "r1",
  file: "releases/r1/vienna.json",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  count: 1,
  fetchedAt: "2026-10-26T00:00:00.000Z",
  sourceUrl: "https://example.test/source",
  attribution: "Fixture, not real data",
  license: "test",
  licenseUrl: "https://example.test/license",
  coverage: "Test fixture",
};

describe("published catalogue", () => {
  it("loads a checksum-verified release through the real network interface", async () => {
    server.use(http.get(`${base}${dataset.file}`, () => new HttpResponse(bytes)));
    expect(await loadRelease(base, dataset)).toEqual(release);
  });
  it("does not turn an unavailable release into an empty result", async () => {
    server.use(http.get(`${base}${dataset.file}`, () => new HttpResponse(null, { status: 503 })));
    await expect(loadRelease(base, dataset)).rejects.toThrow("503");
  });
  it("rejects corrupted bytes even when the server responds successfully", async () => {
    server.use(
      http.get(`${base}${dataset.file}`, () => HttpResponse.json({ ...release, trees: [] })),
    );
    await expect(loadRelease(base, dataset)).rejects.toThrow("integrity");
  });
  it("rejects a validly hashed file from another release", async () => {
    const wrong = JSON.stringify({ ...release, release: "r2" });
    server.use(http.get(`${base}${dataset.file}`, () => new HttpResponse(wrong)));
    await expect(
      loadRelease(base, { ...dataset, sha256: createHash("sha256").update(wrong).digest("hex") }),
    ).rejects.toThrow("does not match");
  });
  it("reports manifest errors and missing saved releases explicitly", async () => {
    server.use(
      http.get(`${base}manifest.json`, () => new HttpResponse(null, { status: 500 })),
      http.get(`${base}releases/r0/dataset.json`, () => new HttpResponse(null, { status: 404 })),
    );
    await expect(loadManifest(base)).rejects.toThrow("500");
    await expect(loadDataset(base, "vienna", "r0")).rejects.toThrow("unavailable");
  });
  it("does not accept archived metadata for a different dataset", async () => {
    server.use(http.get(`${base}releases/r1/dataset.json`, () => HttpResponse.json(dataset)));
    await expect(loadDataset(base, "porto", "r1")).rejects.toThrow("identity");
  });
  it("preserves exact edge membership and distinguishes no match from outside coverage", () => {
    const sample: Release = {
      ...release,
      trees: [
        tree,
        { ...tree, sourceId: "2", position: [16.00001, 48] },
        { ...tree, sourceId: "3", position: [15.99999, 48] },
      ],
    };
    expect(searchInventory(sample, [15, 47, 16, 48], "acer").map((t) => t.sourceId)).toEqual([
      "1",
      "3",
    ]);
    expect(searchInventory(sample, null, "KEGELGASSE")).toHaveLength(3);
    expect(searchInventory(sample, null, "42")).toHaveLength(3);
    expect(searchInventory(sample, null, "unrecorded")).toEqual([]);
  });
});

describe("published pilot regression", () => {
  const archives = ["vienna-e4fc6f34cf3af532", "geneva-d4250459b8e3aba6", "porto-ac49bc8ef867a843"];
  it("loads every checked-in release and matches its independent published count", async () => {
    const expected = { vienna: 4375, geneva: 4685, porto: 2328 };
    for (const archive of archives) {
      const source = datasetSchema.parse(
        JSON.parse(await readFile(`public/data/releases/${archive}/dataset.json`, "utf8")),
      );
      const file = await readFile(`public/data/${source.file}`, "utf8");
      server.use(http.get(`${base}${source.file}`, () => new HttpResponse(file)));
      const result = await loadRelease(base, source);
      expect(result.trees).toHaveLength(expected[source.id]);
      expect(searchInventory(result, source.bounds, "")).toHaveLength(expected[source.id]);
    }
  });
  it("retains all four conflicting Geneva records without conflating their identity", async () => {
    const source = datasetSchema.parse(
      JSON.parse(
        await readFile("public/data/releases/geneva-d4250459b8e3aba6/dataset.json", "utf8"),
      ),
    );
    const result = releaseSchema.parse(
      JSON.parse(await readFile(`public/data/${source.file}`, "utf8")),
    );
    const conflicts = result.trees.filter((t) => t.sourceId.startsWith("395916:object:"));
    expect(conflicts).toHaveLength(4);
    expect(new Set(conflicts.map((t) => t.sourceId)).size).toBe(4);
    expect(conflicts.every((t) => t.idScope === "release")).toBe(true);
  });
});
