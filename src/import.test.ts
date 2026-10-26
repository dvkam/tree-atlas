import { describe, expect, it } from "vitest";
import { importInventory } from "./import.ts";

const feature = (properties: Record<string, unknown>, coordinates = [16.39, 48.207]) => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", geometry: { type: "Point", coordinates }, properties }],
});

describe("provider import conformance", () => {
  it("preserves Vienna class ranges and qualifies release-scoped IDs", () => {
    const [tree] = importInventory(
      "vienna",
      feature({
        OBJECTID: 42,
        BAUMNUMMER: "17",
        GATTUNG_ART: "Acer campestre (Feldahorn)",
        BAUMHOEHE: 2,
        KRONENDURCHMESSER: 8,
        PFLANZJAHR: 0,
      }),
    );
    expect(tree).toMatchObject({
      dataset: "vienna",
      sourceId: "42",
      idScope: "release",
      scientificName: "Acer campestre",
      commonName: "Feldahorn",
      height: { kind: "range", min: 6, max: 10, unit: "m" },
      crown: { kind: "over", value: 21, unit: "m" },
      plantingYear: null,
    });
  });
  it("uses Geneva stable IDs while preserving conflicting records with release-scoped IDs", () => {
    const row = (objectId: number, id: number) => ({
      attributes: {
        OBJECTID: objectId,
        ID_ARBRE: id,
        NOM_COMPLET: "Tilia cordata",
        HAUTEUR_TOTALE: 5.9,
        DATE_PLANTATION: 1009843200000,
        DATE_PLANTATION_ESTIMEE: 1,
        DATE_OBSERVATION: 1353888000000,
        SOUCHE: "Non",
      },
      geometry: { x: 6.14, y: 46.2 },
    });
    const trees = importInventory("geneva", {
      spatialReference: { wkid: 4326 },
      features: [row(1, 123), row(2, 456), row(3, 456)],
    });
    expect(trees[0]).toMatchObject({
      sourceId: "123",
      idScope: "stable",
      plantingYear: 2002,
      plantingEstimated: true,
      height: { kind: "value", value: 5.9, unit: "m" },
      status: "existing",
    });
    expect(trees.slice(1).map((t) => [t.sourceId, t.idScope])).toEqual([
      ["456:object:2", "release"],
      ["456:object:3", "release"],
    ]);
  });
  it("keeps Porto age text separate from an unknown planting year and unknown measurements", () => {
    const [tree] = importInventory(
      "porto",
      feature(
        {
          objectid: 42,
          esp_nomecientifico: "Platanus × hispanica",
          esp_nomecomum: "Plátano",
          arv_intervalo_idade: "20 a 40 anos",
        },
        [-8.61, 41.15],
      ),
    );
    expect(tree).toMatchObject({
      dataset: "porto",
      sourceId: "42",
      idScope: "release",
      age: "20 a 40 anos",
      plantingYear: null,
      height: { kind: "unknown" },
    });
  });
  it("preserves Geneva dates before and at the Unix epoch", () => {
    const raw = {
      spatialReference: { wkid: 4326 },
      features: [
        {
          attributes: {
            ID_ARBRE: 231187,
            OBJECTID: 1,
            DATE_PLANTATION: -252460800000,
            DATE_PLANTATION_ESTIMEE: 1,
            DATE_OBSERVATION: 0,
          },
          geometry: { x: 6.14, y: 46.2 },
        },
      ],
    };
    expect(importInventory("geneva", raw)[0]).toMatchObject({
      plantingYear: 1962,
      plantingEstimated: true,
      observedAt: "1970-01-01",
    });
  });
  it("fails closed for empty data, invalid coordinates and duplicate record keys", () => {
    expect(() => importInventory("vienna", { type: "FeatureCollection", features: [] })).toThrow(
      /Too small/u,
    );
    expect(() => importInventory("porto", feature({ objectid: 1 }, [200, 91]))).toThrow(/Too big/u);
    const f = feature({ OBJECTID: 1 });
    expect(() =>
      importInventory("vienna", { ...f, features: [...f.features, ...f.features] }),
    ).toThrow("Duplicate");
  });
});
