import { readFile } from "node:fs/promises";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { manifestSchema } from "../src/domain.ts";
import type { DatasetId } from "../src/domain.ts";
import { loadInventory } from "../src/inventory.ts";
import type { InventoryQuery } from "../src/index-format.ts";

const base = "https://expanded-inventory.test/data/";
const server = setupServer(
  http.get(`${base}*`, async ({ request }) => {
    const path = new URL(request.url).pathname.slice("/data/".length);
    if (!/^releases\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.(?:json|bin)$/u.test(path))
      return new HttpResponse(null, { status: 400 });
    try {
      return new HttpResponse(new Uint8Array(await readFile(`public/data/${path}`)));
    } catch {
      return new HttpResponse(null, { status: 404 });
    }
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());

// Independent references from the complete official acquisitions, before publication.
// These deliberately do not derive expectations from the manifest or generated indexes.
const audited = [
  ["liege", 28473, 28473],
  ["eindhoven", 128034, 128034],
  ["arnhem", 47423, 47423],
  ["leipzig", 187989, 187989],
  ["berlin", 962545, 962545],
  ["rostock", 70590, 70590],
  ["luxembourgnational", 238, 238],
  ["nantes", 124583, 124583],
  ["ghent", 68240, 68240],
  ["delft", 36763, 36763],
  ["utrecht", 162653, 162653],
  ["cologne", 108071, 108071],
  ["antwerp", 135017, 135017],
  ["rotterdam", 199558, 199558],
  ["brussels", 4789, 4789],
  ["frankfurt", 163569, 163566],
  ["basel", 32435, 32435],
  ["bologna", 87285, 87285],
  ["strasbourg", 83399, 83398],
  ["bordeaux", 84718, 84718],
  ["rennes", 192000, 192000],
  ["cascais", 37944, 37944],
  ["toulouse", 124214, 124214],
  ["montpellier", 60882, 60882],
  ["bern", 23984, 23984],
  ["valencia", 157649, 157649],
  ["barcelona", 222476, 222476],
  ["lyon", 112425, 112425],
  ["lisbon", 80957, 80957],
  ["turin", 105476, 105476],
  ["madrid", 799110, 799110],
  ["paris", 220112, 220112],
  ["florence", 82269, 82269],
  ["milan", 247779, 247779],
] as const satisfies readonly (readonly [DatasetId, number, number])[];
const world: InventoryQuery = {
  q: "",
  area: null,
  viewport: [-180, -90, 180, 90],
  zoom: 0,
  offset: 0,
  limit: 30,
};

describe("expanded published catalogue conformance", () => {
  for (const [id, count, locatedCount] of audited) {
    it(`${id}: all records remain searchable, paginated and mapped without losing counts`, async () => {
      const manifest = manifestSchema.parse(
        JSON.parse(await readFile("public/data/manifest.json", "utf8")),
      );
      const dataset = manifest.datasets.find((item) => item.id === id);
      if (!dataset) throw new Error(`Missing published inventory: ${id}`);
      expect(dataset.scope).toBe("full");
      expect(dataset.count).toBe(count);
      expect(dataset.locatedCount).toBe(locatedCount);
      const catalogue = await loadInventory(base, dataset);
      try {
        // Text results must include the whole release even before geometry is ready.
        expect(catalogue.query(world).total).toBe(count);
        await catalogue.spatialReady;
        const firstPage = catalogue.query(world);
        expect(firstPage.total).toBe(count);
        expect(firstPage.items).toHaveLength(30);
        const secondPage = catalogue.query({ ...world, offset: 30 });
        expect(
          new Set([...firstPage.items, ...secondPage.items].map((item) => item.sourceId)).size,
        ).toBe(60);
        const lastPage = catalogue.query({ ...world, offset: count - 1 });
        expect(lastPage.items).toHaveLength(1);
        expect(catalogue.query({ ...world, offset: count }).items).toHaveLength(0);
        const first = firstPage.items[0];
        const last = lastPage.items[0];
        if (!first || !last) throw new Error("Missing endpoint record");
        expect(first.sourceId).not.toBe(last.sourceId);
        for (const summary of [first, last]) {
          const detail = await catalogue.detail(summary.sourceId);
          expect(detail?.sourceId).toBe(summary.sourceId);
          expect(detail?.position).toEqual(summary.position);
          const match = catalogue.query({ ...world, q: summary.sourceId });
          expect(match.total).toBeGreaterThan(0);
        }
        expect(firstPage.markers.length).toBeLessThanOrEqual(1000);
        expect(
          firstPage.markers.reduce(
            (total, marker) => total + (marker.kind === "cluster" ? marker.count : 1),
            0,
          ),
        ).toBe(locatedCount);
      } finally {
        catalogue.dispose();
      }
    }, 90_000);
  }
});
