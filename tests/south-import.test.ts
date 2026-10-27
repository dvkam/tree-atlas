import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { importInventory } from "../src/import.ts";
import { datasetIdSchema, positionSchema } from "../src/domain.ts";
import type { DatasetId } from "../src/domain.ts";
const fixtures = z
  .record(
    z.string(),
    z.array(
      z.object({
        type: z.literal("Feature"),
        properties: z.record(z.string(), z.unknown()),
        geometry: z.object({ type: z.literal("Point"), coordinates: positionSchema }).nullable(),
      }),
    ),
  )
  .parse(
    JSON.parse(await readFile(new URL("./fixtures/south-sources.json", import.meta.url), "utf8")),
  );
// Expected facts were read from publisher fields before normalization, not derived from atlas values.
const expected: [DatasetId, string, string | null, number, number][] = [
  ["barcelona", "arbrat-viari:0000423AR", "Pinus pinea", 2.1651098, 41.4378722],
  ["madrid", "1", "PINUS PINEA", -3.626725361688026, 40.4153747224347],
  ["valencia", "4787916", "Phoenix canariensis hembra", -0.34842030126589785, 39.46545116523415],
  ["milan", "225", "Platanus x acerifolia", 9.188071541304282, 45.473225113816696],
  ["florence", "152541", "Malus domestica", 11.2959213, 43.7807631],
  ["bologna", "137705", "Populus alba", 11.399964838195684, 44.52294149993507],
  ["turin", "840226", "Thuja orientalis", 7.66734, 45.04528],
  ["basel", "BA_Baeume.338772", 'Fagus sylvatica "Purpurea"', 7.597602784034255, 47.53118828174598],
  ["bern", "1", "Acer", 7.451793187094861, 46.95915702185526],
  ["paris", "295991", "Pyrus calleryana", 2.351549724804429, 48.84094377545107],
  ["lyon", "1", "Pirus calleryana Chanticleer", 4.95562913, 45.71210108],
  ["toulouse", "131677", "Celtis australis", 1.4383896194719425, 43.59007677527503],
  ["bordeaux", "229750", "Carpinus betulus", -0.5222952, 44.8485669],
  ["strasbourg", "128436", "Abies grandis", 7.6997018022, 48.5289164067],
  ["rennes", "arbre.59048", null, -1.696578429760254, 48.09225630176826],
  ["montpellier", "145", "Platanus × hispanica", 3.8496634726, 43.6337783863],
  ["lisbon", "62234", "Quercus robur", -9.09522380117233, 38.7745173661825],
  ["cascais", "arvore.20643270", "Prunus cerasifera", -9.430045, 38.69621],
];
function trees(id: DatasetId) {
  const features = fixtures[id];
  if (!features) throw Error("Missing fixture");
  return importInventory(id, { type: "FeatureCollection", features });
}
describe("southern source conformance", () => {
  for (const [id, sourceId, name, lon, lat] of expected)
    it(`${id}: imports independently checked publisher identity, name and coordinates`, () => {
      const imported = trees(id);
      expect(imported[0]).toMatchObject({
        sourceId,
        scientificName: name,
        position: [lon, lat],
        idScope: "release",
      });
      const sourceFeatures = fixtures[id];
      if (sourceFeatures === undefined) throw new Error("Missing source fixture");
      expect(imported).toHaveLength(sourceFeatures.length);
    });
  it("keeps unknown measurements, dimension classes and missing coordinates", () => {
    for (const id of ["valencia", "bologna", "strasbourg", "lisbon"] as const) {
      expect(trees(id)[0]?.height).toEqual({ kind: "unknown" });
      expect(trees(id)[0]?.circumference).toEqual({ kind: "unknown" });
    }
    const first = fixtures["strasbourg"]?.[0];
    expect(
      importInventory("strasbourg", {
        type: "FeatureCollection",
        features: [{ ...first, geometry: null }],
      })[0]?.position,
    ).toBeNull();
  });
  it("uses only documented metric measurements and never treats diameter as circumference", () => {
    expect(trees("madrid")[0]).toMatchObject({
      height: { kind: "value", value: 4, unit: "m" },
      circumference: { kind: "value", value: 18, unit: "cm" },
    });
    expect(trees("paris")[0]).toMatchObject({
      height: { kind: "value", value: 6, unit: "m" },
      circumference: { kind: "value", value: 55, unit: "cm" },
    });
    expect(trees("florence")[0]?.circumference).toEqual({ kind: "value", value: 15.7, unit: "cm" });
    expect(trees("lyon")[0]).toMatchObject({
      height: { kind: "value", value: 6, unit: "m" },
      crown: { kind: "value", value: 3, unit: "m" },
      circumference: { kind: "value", value: 42, unit: "cm" },
    });
    expect(trees("milan")[0]?.circumference).toEqual({ kind: "unknown" });
  });
  it("preserves removed Cascais records and explicit living Turin status", () => {
    expect(trees("cascais")[0]?.status).toBe("removed");
    expect(trees("turin")[0]?.status).toBe("existing");
  });
  it("does not interpret Basel standing years as a calendar planting year", () => {
    expect(trees("basel")[0]?.plantingYear).toBeNull();
    expect(trees("bologna")[0]?.plantingYear).toBe(2026);
    expect(trees("bern")[0]?.plantingYear).toBe(1996);
  });
  it("retains the published Turin count disagreement", async () => {
    const status = z
      .object({
        id: datasetIdSchema,
        upstreamCountVerified: z.boolean(),
        exportCount: z.number(),
        hitsCount: z.number(),
        coverage: z.string(),
      })
      .parse(
        JSON.parse(
          await readFile(new URL("./fixtures/south-source-status.json", import.meta.url), "utf8"),
        ),
      );
    expect(status).toMatchObject({
      id: "turin",
      upstreamCountVerified: false,
      exportCount: 105476,
      hitsCount: 105439,
    });
    expect(status.coverage).toContain("Completeness against live service is unverified.");
  });
});
