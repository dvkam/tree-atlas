import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { loadInventory } from "./inventory.ts";
import { encodeTextColumns } from "./index-codec.ts";
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

function serveSplit(conflictingGeometry: boolean) {
  const original = serve();
  const textIndex: CompactIndex = {
    ...index,
    rows: index.rows.map((row): IndexRow => [
      row[0],
      null,
      null,
      row[3],
      row[4],
      row[5],
      row[6],
      row[7],
    ]),
  };
  const textBytes = gzipSync(encodeTextColumns(textIndex));
  const geometry = new Uint8Array(index.rows.length * 16);
  const value = new DataView(new ArrayBuffer(8));
  for (let column = 0; column < 2; column++) {
    for (let i = 0; i < index.rows.length; i++) {
      const row = index.rows[i];
      if (row === undefined) throw new Error("Missing geometry fixture row");
      const coordinate = column === 0 ? row[1] : row[2];
      value.setFloat64(
        0,
        conflictingGeometry && i === 0 && column === 0 ? 16.45 : (coordinate ?? Number.NaN),
        true,
      );
      for (let lane = 0; lane < 8; lane++)
        geometry[column * index.rows.length * 8 + lane * index.rows.length + i] =
          value.getUint8(lane);
    }
  }
  const geometryBytes = gzipSync(geometry);
  const descriptor: IndexDescriptor = {
    ...original.descriptor,
    version: 3,
    index: {
      file: "releases/r2/text.bin",
      sha256: hash(textBytes),
      count: index.rows.length,
      encoding: "text-columns-v1",
    },
    geometry: {
      file: "releases/r2/geometry.bin",
      sha256: hash(geometryBytes),
      count: index.rows.length,
    },
  };
  const descriptorText = JSON.stringify(descriptor);
  let releaseGeometry: (() => void) | undefined;
  const held = new Promise<void>((accept) => {
    releaseGeometry = accept;
  });
  server.use(
    http.get(`${base}${original.dataset.file}`, () => new HttpResponse(descriptorText)),
    http.get(`${base}${descriptor.index.file}`, () => new HttpResponse(new Uint8Array(textBytes))),
    http.get(`${base}${descriptor.geometry?.file}`, async () => {
      await held;
      return new HttpResponse(new Uint8Array(geometryBytes));
    }),
  );
  return {
    dataset: { ...original.dataset, sha256: hash(descriptorText) },
    releaseGeometry() {
      if (releaseGeometry === undefined) throw new Error("Missing geometry fixture gate");
      releaseGeometry();
    },
  };
}

describe("full inventory published catalogue", () => {
  it("checks details cached before exact geometry finishes loading", async () => {
    const fixture = serveSplit(false);
    const catalogue = await loadInventory(base, fixture.dataset);
    try {
      expect(catalogue.hasGeometry?.()).toBe(false);
      expect(catalogue.query(query).items[0]?.positionPending).toBe(true);
      expect((await catalogue.detail("one"))?.position).toEqual([16.4, 48.2]);
      fixture.releaseGeometry();
      await catalogue.spatialReady;
      expect(catalogue.hasGeometry?.()).toBe(true);
      expect(catalogue.query(query).items.map((item) => item.position)).toEqual([
        [16.4, 48.2],
        [16.5, 48.3],
        [16.6, 48.4],
      ]);
      expect((await catalogue.detail("one"))?.position).toEqual([16.4, 48.2]);
    } finally {
      fixture.releaseGeometry();
      catalogue.dispose();
    }
  });
  it("rejects valid-hash geometry that conflicts with an already cached canonical detail", async () => {
    const fixture = serveSplit(true);
    const catalogue = await loadInventory(base, fixture.dataset);
    try {
      expect((await catalogue.detail("one"))?.position).toEqual([16.4, 48.2]);
      fixture.releaseGeometry();
      await expect(catalogue.spatialReady).rejects.toThrow(
        "Cached detail does not match exact geometry",
      );
      expect(catalogue.hasGeometry?.()).toBe(false);
    } finally {
      fixture.releaseGeometry();
      catalogue.dispose();
    }
  });
  it("rejects malformed and oversized queries without truncation, while preserving NUL", async () => {
    const fixture = serve();
    const catalogue = await loadInventory(base, fixture.dataset);
    expect(() => catalogue.query({ ...query, q: "\ud800" })).toThrow("valid text");
    expect(() => catalogue.query({ ...query, q: "x".repeat(501) })).toThrow("Too big");
    expect(() => catalogue.suggest("\udfff")).toThrow("valid text");
    expect(() => catalogue.suggest("x".repeat(501))).toThrow("500");
    expect(catalogue.query({ ...query, q: "\u0000" }).total).toBe(0);
    catalogue.dispose();
  });
  it("pages exact coincident cluster members and rejects handles outside the requested filter", async () => {
    const rows: IndexRow[] = Array.from({ length: 205 }, (_, i) => [
      String(i),
      16.4,
      48.2,
      -1,
      1,
      2,
      3,
      0,
    ]);
    rows.push(["nearby", 16.41, 48.21, -1, 1, 2, 3, 0]);
    const fixture = serve({ ...index, rows });
    const catalogue = await loadInventory(base, fixture.dataset);
    const input: InventoryQuery = {
      ...query,
      viewport: [16.399, 48.199, 16.401, 48.201],
      zoom: 19,
      limit: 100,
    };
    const marker = catalogue.query(input).markers.find((item) => item.kind === "cluster");
    if (marker?.kind !== "cluster" || typeof marker.id !== "number")
      throw new Error("Missing fixture cluster");
    const clusterId = marker.id;
    const ids: string[] = [];
    for (const offset of [0, 100, 200]) {
      const page = catalogue.clusterMembers({ ...input, offset }, clusterId);
      expect(page.total).toBe(205);
      ids.push(...page.items.map((item) => item.sourceId));
    }
    expect(ids).toEqual(Array.from({ length: 205 }, (_, i) => String(i)));
    expect(() => catalogue.clusterMembers({ ...input, q: "nearby" }, clusterId)).toThrow(
      "not part",
    );
    catalogue.dispose();
  });
  it("retains exact viewport counts and unlocated search records at inclusive boundaries", async () => {
    const fixture = serve({
      ...index,
      rows: [
        ["west-south", 16.4, 48.2, -1, 1, 2, 3, 0],
        ["east-north", 16.5, 48.3, -1, 1, 2, 3, 0],
        ["outside", 16.6, 48.4, -1, 1, 2, 3, 0],
        ["unlocated", null, null, -1, 1, 2, 3, 0],
      ],
    });
    const catalogue = await loadInventory(base, fixture.dataset);
    const input: InventoryQuery = { ...query, viewport: [16.4, 48.2, 16.5, 48.3] };
    const result = catalogue.query(input);
    expect(result.total).toBe(4);
    expect(result.locatedTotal).toBe(3);
    expect(result.viewportLocatedTotal).toBe(2);
    expect(result.representedLocatedCount).toBe(2);
    expect(result.items.map((item) => item.sourceId)).toEqual([
      "west-south",
      "east-north",
      "outside",
      "unlocated",
    ]);
    expect(catalogue.query({ ...input, q: "unlocated" }).items[0]?.position).toBeNull();
    expect(
      catalogue.query({ ...input, area: input.viewport }).items.map((item) => item.sourceId),
    ).toEqual(["west-south", "east-north"]);
    catalogue.dispose();
  });
  it("rejects old map handles after query, viewport or zoom changes", async () => {
    const fixture = serve({
      ...index,
      rows: [
        ["one", 16.4, 48.2, -1, 1, 2, 3, 0],
        ["two", 16.4, 48.2, -1, 1, 2, 3, 0],
      ],
    });
    const catalogue = await loadInventory(base, fixture.dataset);
    for (const change of [
      { q: "acer" },
      { area: [16.3, 48.1, 16.6, 48.4] as const },
      { viewport: [16.3, 48.1, 16.6, 48.4] as const },
      { zoom: query.zoom + 1 },
    ]) {
      const marker = catalogue.query(query).markers.find((item) => item.kind === "cluster");
      if (marker?.kind !== "cluster" || typeof marker.id !== "number")
        throw new Error("Missing fixture cluster");
      const clusterId = marker.id;
      const changed: InventoryQuery = {
        ...query,
        ...change,
        area: "area" in change ? [...change.area] : query.area,
        viewport: "viewport" in change ? [...change.viewport] : query.viewport,
      };
      expect(() => catalogue.clusterMembers(changed, clusterId)).toThrow("not part");
    }
    catalogue.dispose();
  });
  it("represents exact points in the smallest valid viewport without numeric overflow", async () => {
    const fixture = serve({
      ...index,
      rows: [
        ["origin", 0, 0, -1, 1, 2, 3, 0],
        ["edge", Number.MIN_VALUE, Number.MIN_VALUE, -1, 1, 2, 3, 0],
      ],
    });
    const catalogue = await loadInventory(base, {
      ...fixture.dataset,
      center: [0, 0],
      bounds: [-1, -1, 1, 1],
    });
    const input: InventoryQuery = {
      ...query,
      viewport: [0, 0, Number.MIN_VALUE, Number.MIN_VALUE],
    };
    const result = catalogue.query(input);
    expect(result.total).toBe(2);
    expect(result.viewportLocatedTotal).toBe(2);
    expect(result.representedLocatedCount).toBe(2);
    const ids: string[] = [];
    for (const marker of result.markers) {
      if (marker.kind === "tree") ids.push(marker.tree.sourceId);
      else {
        if (typeof marker.id !== "number") throw new Error("Invalid fixture cluster");
        ids.push(...catalogue.clusterMembers(input, marker.id).items.map((item) => item.sourceId));
      }
    }
    expect(
      result.markers.every((marker) => {
        const position = marker.kind === "tree" ? marker.tree.position : marker.position;
        return position !== null && position.every(Number.isFinite);
      }),
    ).toBe(true);
    expect(ids.toSorted()).toEqual(["edge", "origin"]);
    catalogue.dispose();
  });
  it("keeps polar and inconsistent camera extents bounded without losing visible members", async () => {
    const fixture = serve({
      ...index,
      rows: [
        ["south", -180, -90, -1, 1, 2, 3, 0],
        ["north", 180, 90, -1, 1, 2, 3, 0],
        ["origin", 0, 0, -1, 1, 2, 3, 0],
      ],
    });
    const catalogue = await loadInventory(base, {
      ...fixture.dataset,
      center: [0, 0],
      bounds: [-180, -90, 180, 90],
    });
    for (const zoom of [0, 24]) {
      const result = catalogue.query({ ...query, zoom });
      expect(result.total).toBe(3);
      expect(result.viewportLocatedTotal).toBe(3);
      expect(result.representedLocatedCount).toBe(3);
      expect(result.markers.length).toBeGreaterThan(0);
      expect(result.markers.length).toBeLessThanOrEqual(1000);
      for (const marker of result.markers) {
        const position = marker.kind === "tree" ? marker.tree.position : marker.position;
        expect(position?.every(Number.isFinite)).toBe(true);
      }
    }
    catalogue.dispose();
  });
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
  it("bounds marker density for a phone-sized camera while keeping every member reachable", async () => {
    const rows: IndexRow[] = Array.from({ length: 2500 }, (_, i) => [
      String(i),
      16 + ((i % 50) / 49) * 0.5,
      48 + (Math.floor(i / 50) / 49) * 0.5,
      -1,
      1,
      2,
      3,
      0,
    ]);
    const fixture = serve({ ...index, rows });
    const catalogue = await loadInventory(base, fixture.dataset);
    // This viewport spans about 364 by 548 Web Mercator pixels at zoom 10.
    const input: InventoryQuery = {
      ...query,
      viewport: [16, 48, 16.5, 48.5],
      zoom: 10,
      limit: 100,
    };
    const result = catalogue.query(input);
    expect(result.total).toBe(2500);
    expect(result.viewportLocatedTotal).toBe(2500);
    expect(result.representedLocatedCount).toBe(2500);
    expect(result.markers.length).toBeGreaterThan(0);
    expect(result.markers.length).toBeLessThanOrEqual(100);
    const ids = new Set<string>();
    const totals: [number, number][] = [];
    const duplicateIds: string[] = [];
    for (const marker of result.markers) {
      if (marker.kind === "tree") ids.add(marker.tree.sourceId);
      else {
        if (typeof marker.id !== "number") throw new Error("Invalid fixture cluster");
        for (let offset = 0; offset < marker.count; offset += 100) {
          const page = catalogue.clusterMembers({ ...input, offset }, marker.id);
          totals.push([page.total, marker.count]);
          for (const member of page.items) {
            if (ids.has(member.sourceId)) duplicateIds.push(member.sourceId);
            ids.add(member.sourceId);
          }
        }
      }
    }
    expect(totals.length).toBeGreaterThan(0);
    expect(totals.every(([actual, expected]) => actual === expected)).toBe(true);
    expect(duplicateIds).toEqual([]);
    expect(ids).toEqual(new Set(Array.from({ length: 2500 }, (_, i) => String(i))));
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
    expect(result.markers[0]).toMatchObject({ kind: "cluster", count: 1500 });
    const marker = result.markers[0];
    if (marker?.kind !== "cluster" || typeof marker.id !== "number")
      throw new Error("Missing coincident fixture cluster");
    expect(marker.zoom).toBeGreaterThanOrEqual(22);
    expect(marker.zoom).toBeLessThanOrEqual(24);
    expect(result.mapAggregated).toBe(true);
    expect(result.total).toBe(1500);
    const atMaximum = { ...query, zoom: 24, limit: 100 };
    const maximumMarker = catalogue.query(atMaximum).markers[0];
    if (maximumMarker?.kind !== "cluster" || typeof maximumMarker.id !== "number")
      throw new Error("Missing maximum-zoom fixture cluster");
    const ids: string[] = [];
    for (let offset = 0; offset < 1500; offset += 100)
      ids.push(
        ...catalogue
          .clusterMembers({ ...atMaximum, offset }, maximumMarker.id)
          .items.map((item) => item.sourceId),
      );
    expect(ids).toEqual(Array.from({ length: 1500 }, (_, i) => String(i)));
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
