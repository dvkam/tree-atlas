import { readFile } from "node:fs/promises";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { manifestSchema } from "../src/domain.ts";
import type { DatasetId, Position } from "../src/domain.ts";
import { loadInventory } from "../src/inventory.ts";
import type { InventoryQuery } from "../src/index-format.ts";

const base = "https://full-inventory.test/data/";
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

// Counts come from separately audited complete upstream acquisitions. Coordinates and source IDs
// below were read from the raw official responses, rather than generated from the prepared index.
const expected: Record<DatasetId, { count: number; outsideId: string; position: Position }> = {
  london: { count: 1111784, outsideId: "69", position: [-0.1446498054134123, 51.63168457437338] },
  camden: { count: 28128, outsideId: "row-dt5b-9ckc_fhty", position: [-0.123797, 51.528505] },
  edinburgh: { count: 50400, outsideId: "1", position: [-3.45441364771778, 55.833552040985] },
  belfast: { count: 56521, outsideId: "1", position: [-5.929743, 54.607214] },
  vienna: { count: 233102, outsideId: "831570825", position: [16.48569958, 48.25896836] },
  geneva: { count: 240827, outsideId: "214933", position: [6.128820091326579, 46.184733145914656] },
  porto: { count: 71634, outsideId: "1", position: [-8.661176779591438, 41.154706316195195] },
  amsterdam: {
    count: 326518,
    outsideId: "919933",
    position: [4.904670906630066, 52.3398135015195],
  },
  hamburg: {
    count: 229876,
    outsideId: "100000117",
    position: [9.846289287519417, 53.52547419808404],
  },
  zurich: { count: 81142, outsideId: "1", position: [8.509643, 47.321987] },
};
const world: InventoryQuery = {
  q: "",
  area: null,
  viewport: [-180, -90, 180, 90],
  zoom: 0,
  offset: 0,
  limit: 30,
};

describe("complete published inventories", () => {
  for (const id of [
    "vienna",
    "geneva",
    "porto",
    "amsterdam",
    "hamburg",
    "zurich",
    "london",
    "camden",
    "edinburgh",
    "belfast",
  ] as const) {
    it(`${id}: preserves audited counts, complete map clusters, endpoint pagination and records outside the old pilot window`, async () => {
      const manifest = manifestSchema.parse(
        JSON.parse(await readFile("public/data/manifest.json", "utf8")),
      );
      const dataset = manifest.datasets.find((source) => source.id === id);
      if (!dataset) throw new Error(`Missing ${id} dataset`);
      const reference = expected[id];
      if (!reference) throw new Error("Missing audited source reference");
      expect(dataset.scope).toBe("full");
      expect(dataset.count).toBe(reference.count);
      const catalogue = await loadInventory(base, dataset);
      try {
        const all = catalogue.query(world);
        expect(all.total).toBe(reference.count);
        expect(all.markers.length).toBeLessThanOrEqual(1000);
        expect(
          all.markers.reduce(
            (count, item) => count + (item.kind === "cluster" ? item.count : 1),
            0,
          ),
        ).toBe(dataset.locatedCount ?? reference.count);
        const first = all.items[0];
        const last = catalogue.query({ ...world, offset: reference.count - 1 }).items[0];
        if (!first || !last) throw new Error("Missing first or last record");
        expect(last.sourceId).not.toBe(first.sourceId);
        expect((await catalogue.detail(first.sourceId))?.sourceId).toBe(first.sourceId);
        expect((await catalogue.detail(last.sourceId))?.sourceId).toBe(last.sourceId);
        const [lon, lat] = reference.position;
        const outside = catalogue.query({
          ...world,
          q: reference.outsideId,
          area: [lon - 0.000001, lat - 0.000001, lon + 0.000001, lat + 0.000001],
        });
        expect(outside.items.some((item) => item.sourceId === reference.outsideId)).toBe(true);
        expect((await catalogue.detail(reference.outsideId))?.position).toEqual(reference.position);
      } finally {
        catalogue.dispose();
      }
    }, 60_000);
  }
  it("keeps the original evidence for Geneva's invalid planting date in its lazy detail", async () => {
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile("public/data/manifest.json", "utf8")),
    );
    const dataset = manifest.datasets.find((source) => source.id === "geneva");
    if (!dataset) throw new Error("Missing Geneva dataset");
    const catalogue = await loadInventory(base, dataset);
    try {
      const uncertain = await catalogue.detail("384757");
      expect(uncertain?.plantingYear).toBeNull();
      expect(uncertain?.qualityNotes).toHaveLength(1);
      expect(uncertain?.qualityNotes?.[0]).toContain("-55784073600000");
    } finally {
      catalogue.dispose();
    }
  }, 60_000);
});

it("retains Amsterdam unlocated records in global search but not spatial results", async () => {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile("public/data/manifest.json", "utf8")),
  );
  const dataset = manifest.datasets.find((source) => source.id === "amsterdam");
  if (!dataset) throw new Error("Missing Amsterdam");
  const session = await loadInventory(base, dataset);
  try {
    expect(dataset.count - (dataset.locatedCount ?? 0)).toBe(24);
    const result = session.query({ ...world, q: "3869075" });
    expect(result.total).toBe(1);
    expect(result.items[0]?.position).toBeNull();
    expect(result.markers).toHaveLength(0);
    expect(session.query({ ...world, q: "3869075", area: dataset.bounds }).total).toBe(0);
    expect((await session.detail("3869075"))?.position).toBeNull();
    const outlier = await session.detail("9441293");
    expect(outlier?.qualityNotes?.join(" ")).toContain("far outside Amsterdam");
    expect(outlier?.position?.[1]).toBeLessThan(48);
  } finally {
    session.dispose();
  }
}, 60_000);
