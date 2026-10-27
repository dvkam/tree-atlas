import { expect, it } from "vitest";
import fixtures from "./fixtures/expansion-north.json";
import { importInventory } from "../src/import.ts";

it("keeps Latin species distinct from municipality and translated names", () => {
  expect(fixtures.nantes[0]?.properties.nom).toBe("NANTES");
  const [nantes] = importInventory("nantes", {
    type: "FeatureCollection",
    features: fixtures.nantes,
  });
  expect(nantes).toMatchObject({
    scientificName: "Quercus robur",
    location: "NANTES",
    plantingYear: 1820,
  });
  const [liege] = importInventory("liege", { type: "FeatureCollection", features: fixtures.liege });
  expect(liege).toMatchObject({
    scientificName: "Aesculus x carnea",
    height: { kind: "value", value: 16.9, unit: "m" },
    circumference: { kind: "value", value: 189, unit: "cm" },
  });
});
it("preserves verified coordinate transformations and measurement units", () => {
  const [rostock] = importInventory("rostock", {
    type: "FeatureCollection",
    features: fixtures.rostock,
  });
  expect(rostock).toMatchObject({
    position: [12.1164932, 54.0636702],
    scientificName: "Acer species",
    height: { kind: "value", value: 10, unit: "m" },
  });
  const [cologne] = importInventory("cologne", {
    type: "FeatureCollection",
    features: fixtures.cologne,
  });
  expect(cologne?.position?.[0]).toBeCloseTo(7.07534212, 6);
  expect(cologne?.position?.[1]).toBeCloseTo(50.97369611, 6);
  expect(cologne?.circumference).toEqual({ kind: "value", value: 188, unit: "cm" });
  const [frankfurt] = importInventory("frankfurt", {
    type: "FeatureCollection",
    features: fixtures.frankfurt,
  });
  expect(frankfurt?.position?.[0]).toBeCloseTo(8.62761546, 6);
  expect(frankfurt?.height).toEqual({ kind: "unknown" });
});
it("keeps provider height classes and uncertain averages distinct from exact values", () => {
  const [ghent] = importInventory("ghent", { type: "FeatureCollection", features: fixtures.ghent });
  expect(ghent).toMatchObject({
    scientificName: "Prunus cerasifera 'Nigra'",
    height: { kind: "unknown" },
    circumference: { kind: "unknown" },
  });
  const [delft] = importInventory("delft", { type: "FeatureCollection", features: fixtures.delft });
  expect(delft).toMatchObject({
    scientificName: "Fraxinus excelsior",
    plantingYear: 1948,
    height: { kind: "unknown" },
  });
  const [utrecht] = importInventory("utrecht", {
    type: "FeatureCollection",
    features: fixtures.utrecht,
  });
  expect(utrecht).toMatchObject({
    scientificName: "Alnus glutinosa",
    commonName: "Zwarte els",
    sourceId: "0:1",
  });
});
it("retains Frankfurt rows with malformed native northings without inventing a point", () => {
  const trees = importInventory("frankfurt", {
    type: "FeatureCollection",
    features: fixtures.frankfurt,
  });
  const tree = trees.find((item) => item.sourceId === "283546");
  expect(tree?.position).toBeNull();
  expect(tree?.qualityNotes).toContain(
    "Source UTM coordinate is invalid: northing must be finite and within 0–10000000 metres. Position withheld; original values and record retained.",
  );
  expect(fixtures.frankfurt[2]?.properties["ETRS 89 Hochwert"]).toBe("55556033,5");
});
