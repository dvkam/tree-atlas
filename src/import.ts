import { z } from "zod";
import { positionSchema, treeSchema } from "./domain.ts";
import type { DatasetId, Measurement, Tree } from "./domain.ts";

const collectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z
    .array(
      z.object({
        type: z.literal("Feature"),
        geometry: z.object({ type: z.literal("Point"), coordinates: positionSchema }),
        properties: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1),
});
const unknown: Measurement = { kind: "unknown" };
const esriSchema = z.object({
  spatialReference: z.object({ wkid: z.literal(4326) }),
  features: z
    .array(
      z.object({
        attributes: z.record(z.string(), z.unknown()),
        geometry: z.object({ x: z.number(), y: z.number() }),
      }),
    )
    .min(1),
});
function text(value: unknown): string | null {
  return (typeof value === "string" || typeof value === "number") && String(value).trim() !== ""
    ? String(value).trim()
    : null;
}
function positive(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}
function scalar(value: unknown, unit: "m" | "cm"): Measurement {
  const n = positive(value);
  return n === null ? unknown : { kind: "value", value: n, unit };
}
function sizeClass(value: unknown, step: number): Measurement {
  const code = positive(value);
  if (code === null || !Number.isInteger(code) || code > 8) return unknown;
  if (code === 8) return { kind: "over", value: step * 7, unit: "m" };
  return {
    kind: "range",
    min: code === 1 ? 0 : step * (code - 1) + 1,
    max: step * code,
    unit: "m",
  };
}
function requiredId(value: unknown): string {
  const id = text(value);
  if (id === null) throw new Error("Source record has no identifier");
  return id;
}
function epoch(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = z.number().finite().parse(value);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid source date");
  return date;
}

/** Each import is all-or-nothing. Provider schema failures cannot publish a partial inventory. */
export function importInventory(dataset: DatasetId, raw: unknown): Tree[] {
  const input =
    dataset === "geneva"
      ? (() => {
          const esri = esriSchema.parse(raw);
          return {
            type: "FeatureCollection",
            features: esri.features.map((f) => ({
              type: "Feature",
              properties: f.attributes,
              geometry: { type: "Point", coordinates: [f.geometry.x, f.geometry.y] },
            })),
          };
        })()
      : raw;
  const { features } = collectionSchema.parse(input);
  const genevaIds = new Map<string, number>();
  if (dataset === "geneva")
    for (const f of features) {
      const id = requiredId(f.properties["ID_ARBRE"]);
      genevaIds.set(id, (genevaIds.get(id) ?? 0) + 1);
    }
  const sourceIds = new Set<string>();
  return features.map(({ geometry, properties: p }) => {
    const stableId = dataset === "geneva" ? requiredId(p["ID_ARBRE"]) : "";
    const conflict = (genevaIds.get(stableId) ?? 0) > 1;
    const sourceId =
      dataset === "geneva"
        ? conflict
          ? `${stableId}:object:${requiredId(p["OBJECTID"])}`
          : stableId
        : requiredId(p[dataset === "porto" ? "objectid" : "OBJECTID"]);
    if (sourceIds.has(sourceId)) throw new Error("Duplicate source identity");
    sourceIds.add(sourceId);
    if (dataset === "porto")
      return treeSchema.parse({
        dataset,
        sourceId,
        idScope: "release",
        position: geometry.coordinates,
        tag: null,
        scientificName: text(p["esp_nomecientifico"]),
        commonName: text(p["esp_nomecomum"]),
        location: null,
        height: unknown,
        crown: unknown,
        circumference: unknown,
        plantingYear: null,
        plantingEstimated: false,
        age: text(p["arv_intervalo_idade"]),
        observedAt: null,
        status: "unknown",
      });
    if (dataset === "geneva") {
      const planted = epoch(p["DATE_PLANTATION"]);
      const observed = epoch(p["DATE_OBSERVATION"]);
      return treeSchema.parse({
        dataset,
        sourceId,
        idScope: conflict ? "release" : "stable",
        position: geometry.coordinates,
        tag: text(p["NO_INVENTAIRE"]),
        scientificName: text(p["NOM_COMPLET"]),
        commonName: null,
        location: text(p["SITUATION"]),
        height: scalar(p["HAUTEUR_TOTALE"], "m"),
        crown: scalar(p["DIAMETRE_COURONNE"], "m"),
        circumference: scalar(p["CIRCONFERENCE_1M"], "cm"),
        plantingYear: planted === null ? null : planted.getUTCFullYear(),
        plantingEstimated: p["DATE_PLANTATION_ESTIMEE"] === 1,
        age: null,
        observedAt: observed === null ? null : observed.toISOString().slice(0, 10),
        status: p["SOUCHE"] === "Oui" ? "removed" : p["SOUCHE"] === "Non" ? "existing" : "unknown",
      });
    }
    const species = text(p["GATTUNG_ART"]);
    const match = species === null ? null : /^(.*?)\s*\(([^()]+)\)$/u.exec(species);
    return treeSchema.parse({
      dataset,
      sourceId,
      idScope: "release",
      position: geometry.coordinates,
      tag: text(p["BAUMNUMMER"]),
      scientificName: match?.[1]?.trim() ?? species,
      commonName: match?.[2]?.trim() ?? null,
      location: text(p["OBJEKT_STRASSE"]),
      height: sizeClass(p["BAUMHOEHE"], 5),
      crown: sizeClass(p["KRONENDURCHMESSER"], 3),
      circumference: scalar(p["STAMMUMFANG"], "cm"),
      plantingYear: positive(p["PFLANZJAHR"]),
      plantingEstimated: false,
      age: null,
      observedAt: null,
      status: "unknown",
    });
  });
}
