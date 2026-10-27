import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { packInventory } from "../scripts/pack.ts";
import { loadInventory } from "../src/inventory.ts";
import type { Dataset, Tree } from "../src/domain.ts";
import type { InventoryQuery } from "../src/index-format.ts";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const tree: Tree = {
  dataset: "london",
  sourceId: "one",
  idScope: "stable",
  position: [-0.1, 51.5],
  tag: null,
  scientificName: "Acer",
  commonName: null,
  location: null,
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
  viewport: [-0.2, 51.4, 0, 51.6],
  zoom: 12,
  offset: 0,
  limit: 30,
};
const base = "https://split.test/data/";
function fixture(fail = false, mismatch = false) {
  const trees = [
    tree,
    {
      ...tree,
      sourceId: "outside",
      scientificName: "Rare outside",
      position: [0.2, 51.7] as [number, number],
    },
  ];
  const packed = packInventory("london", "split", trees);
  if (mismatch) {
    const file = packed.files.find((item) => item.name === "geometry.bin");
    const asset = packed.descriptor.geometry;
    if (file === undefined || asset === undefined) throw new Error("Missing geometry fixture");
    const bytes = gunzipSync(file.bytes);
    const coordinate = Buffer.alloc(8);
    coordinate.writeDoubleLE(-0.11);
    for (let lane = 0; lane < 8; lane++) bytes[lane * trees.length] = coordinate[lane] ?? 0;
    file.bytes = gzipSync(bytes);
    asset.sha256 = createHash("sha256").update(file.bytes).digest("hex");
    packed.bytes = JSON.stringify(packed.descriptor);
  }
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dataset: Dataset = {
    id: "london",
    city: "London",
    country: "UK",
    center: [0, 51.5],
    bounds: [-1, 51, 1, 52],
    release: "split",
    file: "releases/split/london.json",
    sha256: createHash("sha256").update(packed.bytes).digest("hex"),
    count: 2,
    locatedCount: 2,
    fetchedAt: "2026-10-27T00:00:00Z",
    sourceUrl: base,
    licenseUrl: base,
    license: "Test",
    attribution: "Test",
    coverage: "Test",
  };
  server.use(
    http.get(`${base}${dataset.file}`, () => new HttpResponse(packed.bytes)),
    http.get(`${base}releases/split/:file`, async ({ params }) => {
      const name = String(params["file"]);
      if (name === "geometry.bin") {
        await gate;
        if (fail) return new HttpResponse(null, { status: 503 });
      }
      const asset = packed.files.find((item) => item.name === name);
      return asset === undefined
        ? new HttpResponse(null, { status: 404 })
        : new HttpResponse(new Uint8Array(asset.bytes));
    }),
  );
  return { dataset, release };
}
it("makes all records searchable before geometry, including outside the initial viewport", async () => {
  const { dataset, release } = fixture();
  const session = await loadInventory(base, dataset);
  const result = session.query({ ...query, q: "Rare outside" });
  expect(result.total).toBe(1);
  expect(result.items[0]?.sourceId).toBe("outside");
  expect(result.spatialReady).toBe(false);
  expect(result.items[0]?.positionPending).toBe(true);
  expect((await session.detail("outside"))?.position).toEqual([0.2, 51.7]);
  expect(session.suggest("Rare")).toEqual(["Rare outside"]);
  expect(() => session.query({ ...query, area: query.viewport })).toThrow("still loading");
  release();
  await session.spatialReady;
  expect(session.query({ ...query, area: query.viewport }).total).toBe(1);
  expect(session.query(query).spatialReady).toBe(true);
  session.dispose();
});
it("keeps complete text search usable if exact geometry fails", async () => {
  const { dataset, release } = fixture(true);
  const session = await loadInventory(base, dataset);
  release();
  await expect(session.spatialReady).rejects.toThrow("503");
  expect(session.query(query).total).toBe(2);
  expect(session.query(query).spatialReady).toBe(false);
  session.dispose();
});
it("cancels background geometry when the city session closes", async () => {
  const { dataset, release } = fixture();
  const session = await loadInventory(base, dataset);
  const result = session.spatialReady?.catch((error: unknown) => error);
  session.dispose();
  release();
  expect(await result).toBeInstanceOf(DOMException);
  expect(() => session.query(query)).toThrow("aborted");
});

it("does not expose partially applied geometry after a conformance failure", async () => {
  const { dataset, release } = fixture();
  const session = await loadInventory(base, { ...dataset, bounds: [-0.2, 51.4, 0, 51.6] });
  release();
  await expect(session.spatialReady).rejects.toThrow("outside catalogue bounds");
  const result = session.query({ ...query, q: "outside" });
  expect(result.total).toBe(1);
  expect(result.markers).toEqual([]);
  expect(result.spatialReady).toBe(false);
  session.dispose();
});

it("rechecks cached early details against exact geometry", async () => {
  const { dataset, release } = fixture(false, true);
  const session = await loadInventory(base, dataset);
  expect((await session.detail("one"))?.position).toEqual([-0.1, 51.5]);
  release();
  await expect(session.spatialReady).rejects.toThrow("Cached detail does not match");
  expect(session.query(query).spatialReady).toBe(false);
  expect(session.query(query).total).toBe(2);
  session.dispose();
});
