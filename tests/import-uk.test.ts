import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { importInventory } from "../src/import.ts";
import type { UkDataset } from "../src/import-uk.ts";

const fixtures = z
  .record(
    z.enum(["london", "camden", "edinburgh", "belfast"]),
    z.array(
      z.object({
        type: z.literal("Feature"),
        properties: z.record(z.string(), z.unknown()),
        geometry: z.unknown(),
      }),
    ),
  )
  .parse(
    JSON.parse(await readFile(new URL("./fixtures/uk-sources.json", import.meta.url), "utf8")),
  );
const datasets: UkDataset[] = ["london", "camden", "edinburgh", "belfast"];
const collection = (features: unknown[]) => ({ type: "FeatureCollection", features });
describe("UK source import conformance", () => {
  for (const dataset of datasets) {
    it(`${dataset}: retains source rows, coordinates and release identity`, () => {
      const source = fixtures[dataset];
      const trees = importInventory(dataset, collection(source));
      expect(trees).toHaveLength(source.length);
      expect(new Set(trees.map((tree) => tree.sourceId)).size).toBe(source.length);
      for (const tree of trees) {
        expect(tree.idScope).toBe("release");
        expect(tree.circumference).toEqual({ kind: "unknown" });
      }
    });
    it(`${dataset}: retains a record without coordinates and rejects duplicate identity`, () => {
      const first = fixtures[dataset][0];
      expect(first).toBeDefined();
      const [tree] = importInventory(dataset, collection([{ ...first, geometry: null }]));
      expect(tree?.position).toBeNull();
      expect(() => importInventory(dataset, collection([first, first]))).toThrow(
        "Duplicate source identity",
      );
    });
  }
  it("Camden uses row identity and retains repeated asset references", () => {
    const first = fixtures.camden[0];
    if (!first) throw Error("Fixture missing");
    const second = { ...first, properties: { ...first.properties, ":id": "distinct-source-row" } };
    const trees = importInventory("camden", collection([first, second]));
    expect(trees[0]?.tag).toBe(trees[1]?.tag);
    expect(trees[0]?.sourceId).not.toBe(trees[1]?.sourceId);
  });
  it("Edinburgh retains height classes and source coordinates without guessing exact measurements", () => {
    const trees = importInventory("edinburgh", collection(fixtures.edinburgh));
    expect(trees[1]?.height).toEqual({ kind: "unknown" });
    expect(trees[1]?.qualityNotes).toContain("Source height class: 5 to 10 meters.");
    expect(trees[0]?.position).toEqual([-3.45441364771778, 55.833552040985]);
  });
  it("Belfast keeps NULL tags unknown and does not assume measurement units", () => {
    const [tree] = importInventory("belfast", collection(fixtures.belfast));
    expect(tree?.tag).toBeNull();
    expect(tree?.height).toEqual({ kind: "unknown" });
    expect(tree?.qualityNotes).toContain("Source breast-height diameter; unit not verified: 14.");
  });
  it("London imports explicit height metres but keeps ambiguous girth/DBH as a note", () => {
    const [tree] = importInventory("london", collection(fixtures.london));
    expect(tree?.height).toEqual({ kind: "value", value: 10, unit: "m" });
    expect(tree?.qualityNotes).toContain(
      "Source girth/DBH description; measurement type is not standardised: 32 cm.",
    );
  });
});
