import { describe, expect, it } from "vitest";
import { serialize } from "flatgeobuf/lib/mjs/geojson.js";
import { importCanopy } from "../scripts/canopy.ts";

describe("official canopy import interface", () => {
  it("rejects a file whose declared coordinates are not EPSG:3035", async () => {
    // Synthetic conformance fixture; never published as Copernicus observations.
    const fixture = serialize(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { id: "fixture" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [16.39, 48.21],
                  [16.4, 48.21],
                  [16.4, 48.22],
                  [16.39, 48.21],
                ],
              ],
            },
          },
        ],
      },
      4326,
    );
    await expect(importCanopy(fixture)).rejects.toThrow("EPSG:3035");
  });

  it("reprojects canopy with release-scoped identity without inventing tree details", async () => {
    // Synthetic triangle; EPSG:3035 reference coordinates independently generated with PROJ / pyproj 3.8.0.
    const ring = [
      [4795463.200792815, 2809042.8796067014],
      [4795537.238787364, 2809049.308447573],
      [4795527.865871475, 2809160.1155484],
      [4795463.200792815, 2809042.8796067014],
    ];
    const bytes = serialize(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { id: "synthetic" },
            geometry: { type: "Polygon", coordinates: [ring] },
          },
        ],
      },
      3035,
    );
    const imported = await importCanopy(bytes);
    expect(imported.features).toHaveLength(1);
    const feature = imported.features[0];
    expect(feature?.properties).toEqual({ kind: "canopy", referenceYear: 2021, sourceIndex: 1 });
    expect(feature?.id).toMatch(/^copernicus-stl2021:[a-f0-9]{16}:1$/u);
    if (feature?.geometry.type !== "Polygon") throw new Error("Expected a polygon");
    expect(feature.geometry.coordinates[0]?.[0]?.[0]).toBeCloseTo(16.39, 7);
    expect(feature.geometry.coordinates[0]?.[0]?.[1]).toBeCloseTo(48.21, 7);
  });

  it("rejects malformed unclosed rings instead of publishing invalid canopy", async () => {
    const bytes = serialize(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [4795463, 2809042],
                  [4795537, 2809049],
                  [4795527, 2809160],
                  [4795480, 2809100],
                ],
              ],
            },
          },
        ],
      },
      3035,
    );
    await expect(importCanopy(bytes)).rejects.toThrow("closed ring");
  });
});
