import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { loadInventory } from "./inventory.ts";
import type { Dataset, Tree } from "./domain.ts";
import type { CompactIndex, IndexDescriptor, InventoryQuery, IndexRow } from "./index-format.ts";

const base = "https://inventory.test/data/";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const tree: Tree = {
  dataset: "vienna",
  sourceId: "one",
  idScope: "release",
  position: [16.4, 48.2],
  tag: "12",
  scientificName: "Acer campestre",
  commonName: "Feldahorn",
  location: "Außerhalb",
  height: { kind: "unknown" },
  crown: { kind: "unknown" },
  circumference: { kind: "unknown" },
  plantingYear: null,
  plantingEstimated: false,
  age: null,
  observedAt: null,
  status: "unknown",
};
const query: InventoryQuery = {
  q: "",
  area: null,
  viewport: [-180, -90, 180, 90],
  zoom: 13,
  offset: 0,
  limit: 30,
};
const index: CompactIndex = {
  version: 2,
  dataset: "vienna",
  release: "r2",
  strings: ["12", "Acer campestre", "Feldahorn", "Außerhalb"],
  rows: [
    ["one", 16.4, 48.2, 0, 1, 2, 3, 0],
    ["two", 16.5, 48.3, -1, 1, 2, 3, 0],
    ["three", 16.6, 48.4, -1, 1, 2, 3, 0],
  ],
};
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function serve(input: CompactIndex = index) {
  const indexBytes = gzipSync(JSON.stringify(input));
  const trees = input.rows.map((row): Tree => ({
    ...tree,
    sourceId: row[0],
    position: row[1] === null || row[2] === null ? null : [row[1], row[2]],
    tag: row[3] === -1 ? null : "12",
  }));
  const detailBytes = gzipSync(
    JSON.stringify({ version: 1, dataset: "vienna", release: "r2", trees }),
  );
  const descriptor: IndexDescriptor = {
    version: 2,
    dataset: "vienna",
    release: "r2",
    index: {
      file: "releases/r2/index.bin",
      sha256: hash(indexBytes),
      count: input.rows.length,
    },
    details: [{ file: "releases/r2/detail0.bin", sha256: hash(detailBytes), count: trees.length }],
  };
  const text = JSON.stringify(descriptor);
  const dataset: Dataset = {
    id: "vienna",
    city: "Vienna",
    country: "Austria",
    center: [16.4, 48.2],
    bounds: [15, 47, 18, 49],
    release: "r2",
    file: "releases/r2/vienna.json",
    sha256: hash(text),
    count: input.rows.length,
    fetchedAt: "2026-10-26T00:00:00.000Z",
    sourceUrl: "https://example.test",
    licenseUrl: "https://example.test",
    attribution: "Synthetic fixture",
    license: "test",
    coverage: "synthetic",
  };
  let detailRequests = 0;
  server.use(
    http.get(`${base}${dataset.file}`, () => new HttpResponse(text)),
    http.get(`${base}${descriptor.index.file}`, () => new HttpResponse(new Uint8Array(indexBytes))),
    http.get(`${base}${descriptor.details[0]?.file}`, () => {
      detailRequests++;
      return new HttpResponse(new Uint8Array(detailBytes));
    }),
  );
  return { dataset, descriptor, detailRequests: () => detailRequests };
}

describe("full inventory published catalogue", () => {
  it("searches the full index outside the previous pilot window and fetches detail only on demand", async () => {
    const fixture = serve();
    const catalogue = await loadInventory(base, fixture.dataset);
    expect(catalogue.query({ ...query, q: "außerhalb" }).total).toBe(3);
    expect(catalogue.query({ ...query, q: "three" }).items.map((item) => item.sourceId)).toEqual([
      "three",
    ]);
    expect(fixture.detailRequests()).toBe(0);
    expect((await catalogue.detail("three"))?.position).toEqual([16.6, 48.4]);
    expect((await catalogue.detail("one"))?.tag).toBe("12");
    expect(fixture.detailRequests()).toBe(1);
    catalogue.dispose();
  });

  it("matches exact area membership, including boundary points, without limiting the search to a result page", async () => {
    const fixture = serve();
    const catalogue = await loadInventory(base, fixture.dataset);
    const result = catalogue.query({
      ...query,
      area: [16.5, 48.3, 16.6, 48.4],
      limit: 1,
      offset: 1,
    });
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.sourceId)).toEqual(["three"]);
    expect(catalogue.query({ ...query, q: "ACER" }).total).toBe(3);
    expect(catalogue.suggest("außer")).toEqual(["Außerhalb"]);
    expect(catalogue.query({ ...query, q: "unknown species" }).total).toBe(0);
    catalogue.dispose();
    expect(() => catalogue.query(query)).toThrow("aborted");
  });

  it("keeps every matching record in dense clusters and paginated results", async () => {
    const rows: IndexRow[] = Array.from({ length: 2500 }, (_, i) => [
      String(i),
      16 + (i % 50) * 0.02,
      48 + Math.floor(i / 50) * 0.02,
      -1,
      1,
      2,
      3,
      0,
    ]);
    const fixture = serve({ ...index, rows });
    const catalogue = await loadInventory(base, fixture.dataset);
    const result = catalogue.query({ ...query, zoom: 20, offset: 2400, limit: 100 });
    expect(result.total).toBe(2500);
    expect(result.items).toHaveLength(100);
    expect(result.markers.length).toBeLessThanOrEqual(1000);
    expect(result.mapAggregated).toBe(true);
    expect(
      result.markers.reduce(
        (sum, marker) => sum + (marker.kind === "cluster" ? marker.count : 1),
        0,
      ),
    ).toBe(2500);
    // Filtering changes cluster membership; camera-only queries cannot reuse a stale filter.
    expect(catalogue.query({ ...query, q: "2499" }).total).toBe(1);
    expect(catalogue.query(query).total).toBe(2500);
    catalogue.dispose();
  });

  it("retains coincident trees as a counted cluster even at maximum map zoom", async () => {
    const rows: IndexRow[] = Array.from({ length: 1500 }, (_, i) => [
      String(i),
      16.4,
      48.2,
      -1,
      1,
      2,
      3,
      0,
    ]);
    const fixture = serve({ ...index, rows });
    const catalogue = await loadInventory(base, fixture.dataset);
    const result = catalogue.query({ ...query, zoom: 22 });
    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]).toMatchObject({ kind: "cluster", count: 1500, zoom: 20 });
    expect(result.mapAggregated).toBe(true);
    expect(result.total).toBe(1500);
    catalogue.dispose();
  });

  it("rejects an unavailable or corrupted compressed index instead of reporting zero trees", async () => {
    const fixture = serve();
    server.use(
      http.get(
        `${base}${fixture.descriptor.index.file}`,
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    await expect(loadInventory(base, fixture.dataset)).rejects.toThrow("503");
    server.use(
      http.get(`${base}${fixture.descriptor.index.file}`, () => new HttpResponse("corrupted")),
    );
    await expect(loadInventory(base, fixture.dataset)).rejects.toThrow("integrity");
  });

  it("rejects dictionary and identity corruption even if the compressed asset hash is valid", async () => {
    const missing = serve({ ...index, rows: [["one", 16.4, 48.2, 99, 1, 2, 3, 0]] });
    await expect(loadInventory(base, missing.dataset)).rejects.toThrow("dictionary");
    const duplicates = serve({
      ...index,
      rows: [
        ["one", 16.4, 48.2, -1, 1, 2, 3, 0],
        ["one", 16.5, 48.3, -1, 1, 2, 3, 0],
      ],
    });
    await expect(loadInventory(base, duplicates.dataset)).rejects.toThrow("duplicate");
  });

  it("checks detail shard integrity independently and keeps search available after a detail failure", async () => {
    const fixture = serve();
    const catalogue = await loadInventory(base, fixture.dataset);
    server.use(
      http.get(
        `${base}${fixture.descriptor.details[0]?.file}`,
        () => new HttpResponse("wrong shard"),
      ),
    );
    await expect(catalogue.detail("one")).rejects.toThrow("integrity");
    expect(catalogue.query(query).total).toBe(3);
    expect(await catalogue.detail("missing")).toBeNull();
    catalogue.dispose();
  });

  it("continues to open archived v1 arrays through the same interface", async () => {
    const fixture = serve();
    const payload = JSON.stringify({ version: 1, dataset: "vienna", release: "r2", trees: [tree] });
    server.use(http.get(`${base}${fixture.dataset.file}`, () => new HttpResponse(payload)));
    const catalogue = await loadInventory(base, {
      ...fixture.dataset,
      count: 1,
      sha256: hash(payload),
    });
    expect(catalogue.query(query).items.map((item) => item.sourceId)).toEqual(["one"]);
    expect(await catalogue.detail("one")).toEqual(tree);
    catalogue.dispose();
  });
});
