import { gunzipSync } from "node:zlib";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { packMap } from "../scripts/map-pack.ts";
import { mapCatalogSchema, openProgressiveMap } from "../src/progressive-map.ts";
import { releaseSchema } from "../src/domain.ts";
import type { Dataset, Tree } from "../src/domain.ts";

const base = "https://map.test/data/";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const tree: Tree = {
  dataset: "vienna",
  sourceId: "1",
  idScope: "stable",
  position: [16.4, 48.2],
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
  status: "existing",
};
function fixture(trees: Tree[] = [tree], corrupt = false, wait = 0) {
  const packed = packMap("vienna", "test-release", trees);
  const requests: string[] = [];
  server.use(
    http.get(`${base}releases/test-release/:file`, async ({ params }) => {
      const name = String(params["file"]);
      requests.push(name);
      if (name.startsWith("mapleaf")) await delay(wait);
      const file = packed.files.find((item) => item.name === name);
      if (file === undefined) return new HttpResponse(null, { status: 404 });
      return new HttpResponse(new Uint8Array(corrupt ? [0] : file.bytes).buffer);
    }),
  );
  const dataset: Dataset = {
    id: "vienna",
    city: "Vienna",
    country: "Austria",
    center: [16.4, 48.2],
    bounds: [16, 48, 17, 49],
    release: "test-release",
    file: "releases/test-release/vienna.json",
    sha256: "0".repeat(64),
    count: trees.length,
    locatedCount: trees.filter((item) => item.position !== null).length,
    fetchedAt: "2026-10-26T00:00:00Z",
    sourceUrl: "https://source.test",
    attribution: "Test",
    license: "Test",
    licenseUrl: "https://source.test",
    coverage: "Test",
    map: packed.asset,
  };
  return { packed, requests, dataset };
}
it("publishes every located record exactly once and leaves unlocated records out", () => {
  const trees = Array.from({ length: 1800 }, (_, i): Tree => ({
    ...tree,
    sourceId: String(i),
    position: [16 + i / 10000, 48 + (i % 100) / 1000],
  }));
  trees.push({ ...tree, sourceId: "unlocated", position: null });
  const { packed } = fixture(trees);
  const catalogFile = packed.files.find((file) => file.name === "map.bin");
  expect(catalogFile).toBeDefined();
  if (catalogFile === undefined) return;
  const catalog = mapCatalogSchema.parse(JSON.parse(gunzipSync(catalogFile.bytes).toString()));
  const ids = packed.files
    .filter((file) => file.name.startsWith("mapleaf"))
    .flatMap((file) =>
      releaseSchema
        .parse(JSON.parse(gunzipSync(file.bytes).toString()))
        .trees.map((item) => item.sourceId),
    );
  expect(catalog.locatedCount).toBe(1800);
  expect(ids).toHaveLength(1800);
  expect(new Set(ids).size).toBe(1800);
  expect(ids).not.toContain("unlocated");
});
it("provides clickable details without requesting the complete search index", async () => {
  const { dataset, requests } = fixture();
  const map = await openProgressiveMap(base, dataset, new AbortController().signal);
  const markers = await map.query([16, 48, 17, 49], 18, new AbortController().signal);
  expect(markers).toEqual([{ kind: "tree", tree }]);
  expect(map.detail("vienna:1")).toEqual(tree);
  expect(requests).toEqual(["map.bin", "mapleaf-0.bin"]);
  map.dispose();
  expect(map.detail("1")).toBeNull();
});
it("rejects corrupt assets and catalogue release mismatches", async () => {
  const corrupt = fixture([tree], true);
  await expect(
    openProgressiveMap(base, corrupt.dataset, new AbortController().signal),
  ).rejects.toThrow("integrity");
  const valid = fixture();
  await expect(
    openProgressiveMap(base, { ...valid.dataset, release: "other" }, new AbortController().signal),
  ).rejects.toThrow("catalogue");
});
it("cancels superseded viewport fetches and does not expose cancelled details", async () => {
  const { dataset } = fixture([tree], false, 50);
  const map = await openProgressiveMap(base, dataset, new AbortController().signal);
  const pending = map.query([16, 48, 17, 49], 18, new AbortController().signal);
  const rejected = pending.catch((error: unknown) => error);
  await map.query([-100, -50, -90, -40], 0, new AbortController().signal);
  expect(await rejected).toBeInstanceOf(DOMException);
  expect(map.detail("1")).toBeNull();
  map.dispose();
});
it("rejects duplicate source identities at publication", () => {
  expect(() => packMap("vienna", "r", [tree, tree])).toThrow("identity");
});

it("bounds dense map output without dropping represented records", async () => {
  const trees = Array.from({ length: 6000 }, (_, i): Tree => ({
    ...tree,
    sourceId: String(i),
    position: [16 + i / 100000, 48 + (i % 100) / 10000],
  }));
  const { dataset, requests } = fixture(trees);
  const map = await openProgressiveMap(base, dataset, new AbortController().signal);
  const markers = await map.query([-180, -90, 180, 90], 19, new AbortController().signal);
  expect(markers.length).toBeLessThanOrEqual(1000);
  expect(
    markers.reduce((sum, marker) => sum + (marker.kind === "tree" ? 1 : marker.count), 0),
  ).toBe(6000);
  expect(requests.filter((name) => name.startsWith("mapleaf")).length).toBeLessThanOrEqual(16);
  const selectedTrees = markers.filter((marker) => marker.kind === "tree");
  for (const marker of selectedTrees) expect(map.detail(marker.tree.sourceId)).not.toBeNull();
  map.dispose();
});

it("keeps partial-cell aggregates visible while retaining the full-cell count", async () => {
  const other: Tree = { ...tree, sourceId: "2", position: [16.8, 48.2] };
  const { dataset, requests } = fixture([tree, other]);
  const map = await openProgressiveMap(base, dataset, new AbortController().signal);
  const markers = await map.query([16.39, 48.19, 16.41, 48.21], 0, new AbortController().signal);
  expect(markers).toEqual([{ kind: "cluster", id: 0, position: [16.41, 48.2], count: 2, zoom: 2 }]);
  expect(requests).toEqual(["map.bin"]);
  map.dispose();
});
