import { expect, it } from "vitest";
import { importInventory } from "../src/import.ts";
import { locationDefinition } from "../src/datasets.ts";

// Synthetic transport fixture. Provider-specific field mappings use acquired-source fixtures.
const atlas = {
  sourceId: "00042",
  idScope: "release",
  tag: "0042",
  scientificName: "Acer campestre",
  commonName: null,
  location: "Test street",
  height: { kind: "range", min: 5, max: 10, unit: "m" },
  crown: { kind: "unknown" },
  circumference: { kind: "unknown" },
  plantingYear: null,
  plantingEstimated: false,
  age: "Mature",
  observedAt: null,
  status: "removed",
  qualityNotes: ["Source diameter category: 10–20; unit not established."],
};
function collection(properties: unknown = atlas, coordinates: unknown = [2.35, 48.85]) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { atlas: properties },
        geometry: coordinates === null ? null : { type: "Point", coordinates },
      },
    ],
  };
}
it("preserves explicit measurements, status, source identity and original uncertainty", () => {
  const [tree] = importInventory("paris", collection());
  expect(tree).toMatchObject({ ...atlas, dataset: "paris", position: [2.35, 48.85] });
  expect(tree?.circumference).toEqual({ kind: "unknown" });
});
it("retains unlocated source records without inventing a position", () => {
  expect(importInventory("berlin", collection(atlas, null))[0]?.position).toBeNull();
});
it("rejects incomplete normalization, unknown fields and invalid positions", () => {
  expect(() => importInventory("paris", collection({ sourceId: "1" }))).toThrow(/Invalid input/u);
  expect(() => importInventory("paris", collection({ ...atlas, diameter: 12 }))).toThrow(
    /Unrecognized key/u,
  );
  expect(() => importInventory("paris", collection(atlas, [200, 95]))).toThrow(/Too big/u);
});
it("rejects repeated identities in a source without confusing IDs in separate cities", () => {
  const input = collection();
  input.features.push(...input.features);
  expect(() => importInventory("paris", input)).toThrow("Duplicate source identity");
  expect(importInventory("berlin", collection())[0]?.sourceId).toBe("00042");
  expect(importInventory("paris", collection())[0]?.sourceId).toBe("00042");
});
it("registers distinct city and selected-tree collections without implying publication", () => {
  expect(locationDefinition("luxembourg").city).toBe("Luxembourg City");
  expect(locationDefinition("luxembourgnational").city).toContain("remarkable");
});
