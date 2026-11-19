import { treeSchema } from "./domain.ts";
import type { Measurement, Position, Tree } from "./domain.ts";

export type UkDataset = "london" | "camden" | "edinburgh" | "belfast";
const unknown: Measurement = { kind: "unknown" };
function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result === "" || /^(null|not recorded|not provided|unknown)$/iu.test(result)
    ? null
    : result;
}
function metres(value: unknown, explicitSuffix = false): Measurement {
  const label = text(value);
  if (label === null) return unknown;
  const match = explicitSuffix
    ? /^(\d+(?:\.\d+)?)\s*m$/u.exec(label)
    : /^(\d+(?:\.\d+)?)$/u.exec(label);
  const amount = Number(match?.[1]);
  return Number.isFinite(amount) && amount > 0
    ? { kind: "value", value: amount, unit: "m" }
    : unknown;
}
function notes(
  p: Record<string, unknown>,
  fields: readonly (readonly [string, string])[],
): string[] {
  return fields.flatMap(([key, label]) => {
    const value = text(p[key]);
    return value === null ? [] : [`${label}: ${value}.`];
  });
}

/** Source units and identity scope stay explicit; diameter is never circumference. */
export function importUkTree(
  dataset: UkDataset,
  sourceId: string,
  p: Record<string, unknown>,
  position: Position | null,
): Tree {
  const base = {
    dataset,
    sourceId,
    idScope: "release" as const,
    position,
    plantingYear: null,
    plantingEstimated: false,
    observedAt: null,
    status: "unknown" as const,
    circumference: unknown,
    crown: unknown,
  };
  if (dataset === "london")
    return treeSchema.parse({
      ...base,
      tag: null,
      scientificName: text(p["taxon_species"]),
      commonName: text(p["common_name"]),
      location:
        [text(p["borough"]), text(p["maintainer"]), text(p["location"])]
          .filter(Boolean)
          .join(" · ") || null,
      height: metres(p["height_m"], true),
      age: text(p["age_cat"]),
      qualityNotes: notes(p, [
        ["canopy_m", "Source canopy measurement"],
        ["girth_dbh", "Source girth/DBH description; measurement type is not standardised"],
      ]),
    });
  if (dataset === "camden")
    return treeSchema.parse({
      ...base,
      tag: text(p["identifier"]),
      scientificName: text(p["scientific_name"]),
      commonName: text(p["common_name"]),
      location: text(p["site_name"]),
      height: metres(p["height_in_metres"]),
      age: text(p["maturity"]),
      qualityNotes: notes(p, [
        ["number_of_trees", "Trees represented by this source row"],
        ["spread_in_metres", "Source spread in metres"],
        ["crown_in_metres", "Source crown measure in metres"],
        ["diameter_in_centimetres_at_breast_height", "Breast-height diameter in centimetres"],
        ["tree_set_to_be_removed", "Removal planned"],
        ["physiological_condition", "Source condition"],
      ]),
    });
  if (dataset === "edinburgh")
    return treeSchema.parse({
      ...base,
      tag: text(p["LocationOrTagNo"]) ?? text(p["PrimaryKey"]),
      scientificName: text(p["LatinName"]),
      commonName: text(p["CommonName"]),
      location: text(p["Site"]),
      height: unknown,
      age: text(p["AgeGroup"]),
      qualityNotes: [
        ...notes(p, [
          ["Height", "Source height class"],
          ["Spread", "Source spread class"],
          ["DiameterAtBreastHeight", "Source breast-height diameter class; unit not verified"],
          ["PrimaryKey", "Source asset reference"],
        ]),
        ...(text(p["PrimaryKey"])?.startsWith("Grp/")
          ? ["Source record represents a tree group; it is not a count of individual trees."]
          : []),
      ],
    });
  return treeSchema.parse({
    ...base,
    tag: text(p["TreeTag"]),
    scientificName: text(p["Specie"]),
    commonName: text(p["SpecieGroup"]),
    location: text(p["TreeType"]),
    height: unknown,
    age: text(p["AGE"]),
    qualityNotes: notes(p, [
      ["Height", "Source height; unit not verified"],
      ["Spread", "Source spread; unit not verified"],
      ["DBH", "Source breast-height diameter; unit not verified"],
      ["Condition", "Source condition"],
      ["Vigour", "Source vigour"],
    ]),
  });
}
