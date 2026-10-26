import { describe, expect, it } from "vitest";
import fixtures from "../tests/fixtures/new-sources.json";
import { importInventory } from "./import.ts";

describe("additional official inventory conformance", () => {
  it("retains Amsterdam ranges, placement years and site labels without treating diameter as circumference", () => {
    const rows = importInventory("amsterdam", fixtures.amsterdam.body);
    expect(rows[0]).toMatchObject({
      sourceId: "919933",
      scientificName: "Tilia americana",
      plantingYear: 1948,
      height: { kind: "range", min: 15, max: 18, unit: "m" },
      circumference: { kind: "unknown" },
      observedAt: null,
    });
  });
  it("preserves unlocated Amsterdam rows, unknown year zero and source identity", () => {
    const [record] = importInventory("amsterdam", {
      type: "FeatureCollection",
      features: [fixtures.amsterdamUnlocated.body],
    });
    expect(record).toMatchObject({
      sourceId: "3869075",
      position: null,
      plantingYear: null,
      scientificName: null,
    });
    expect(record?.qualityNotes?.join(" ")).toContain("no recorded coordinates");
  });
  it("preserves Hamburg metre and centimetre measurements from the acquired singleton points", () => {
    const raw = {
      ...fixtures.hamburg.body,
      features: fixtures.hamburg.body.features.map((f) => ({
        ...f,
        geometry: { type: "Point", coordinates: f.geometry.coordinates[0] },
      })),
    };
    expect(importInventory("hamburg", raw)[0]).toMatchObject({
      sourceId: "100000117",
      tag: "F122-83-1",
      crown: { kind: "value", value: 13, unit: "m" },
      circumference: { kind: "value", value: 271, unit: "cm" },
      plantingYear: 1959,
      observedAt: null,
    });
  });
  it("keeps Zürich estimated crown data qualified and category status distinct from life status", () => {
    const [record] = importInventory("zurich", fixtures.zurich.body);
    expect(record).toMatchObject({
      sourceId: "1",
      tag: "nn-1851",
      crown: { kind: "unknown" },
      status: "unknown",
      plantingYear: 1980,
    });
    expect(record?.qualityNotes?.join(" ")).toContain("approximately 14 m");
  });
  it("rejects invalid non-null Amsterdam coordinates and duplicate official IDs", () => {
    const row = fixtures.amsterdamUnlocated.body;
    expect(() =>
      importInventory("amsterdam", {
        type: "FeatureCollection",
        features: [{ ...row, geometry: { type: "Point", coordinates: [400, 99] } }],
      }),
    ).toThrow(/Too big/u);
    expect(() =>
      importInventory("amsterdam", { type: "FeatureCollection", features: [row, row] }),
    ).toThrow("Duplicate");
  });
});
