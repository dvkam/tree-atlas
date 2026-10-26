import { treeSchema } from "./domain.ts";
import type { Measurement, Position, Tree } from "./domain.ts";

function text(value: unknown): string | null {
  return (typeof value === "string" || typeof value === "number") && String(value).trim() !== ""
    ? String(value).trim()
    : null;
}
function number(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function scalar(value: unknown, unit: "m" | "cm"): Measurement {
  const n = number(value);
  return n === null ? { kind: "unknown" } : { kind: "value", value: n, unit };
}
function year(value: unknown, notes: string[]): number | null {
  const n = number(value);
  if (n === null) return null;
  if (Number.isInteger(n) && n >= 1000 && n <= 2200) return n;
  notes.push(
    `Source planting year ${String(value)} is outside the supported range; kept as unknown.`,
  );
  return null;
}
function heightClass(value: unknown, notes: string[]): Measurement {
  const label = text(value);
  if (label === null) return { kind: "unknown" };
  notes.push(`Source height class: ${label}`);
  const range = /(\d+(?:[.,]\d+)?)\s*(?:tot|[-–])\s*(\d+(?:[.,]\d+)?)\s*m/u.exec(label);
  if (range?.[1] && range[2]) {
    const min = Number(range[1].replace(",", "."));
    const max = Number(range[2].replace(",", "."));
    if (min >= 0 && max > min) return { kind: "range", min, max, unit: "m" };
  }
  // Open-ended and provider-specific classes remain visible verbatim, rather than guessed bounds.
  return { kind: "unknown" };
}

export function importAdditionalTree(
  dataset: "amsterdam" | "hamburg" | "zurich",
  sourceId: string,
  p: Record<string, unknown>,
  position: Position | null,
): Tree {
  const notes: string[] = [];
  const common = {
    dataset,
    sourceId,
    idScope: "release",
    position,
    tag: null,
    height: { kind: "unknown" },
    crown: { kind: "unknown" },
    circumference: { kind: "unknown" },
    plantingEstimated: false,
    age: null,
    observedAt: null,
    status: "unknown",
  };
  if (dataset === "amsterdam") {
    if (position === null)
      notes.push(
        "The source has no recorded coordinates. This record is searchable but cannot be placed on the map.",
      );
    if (
      position !== null &&
      (position[0] < 4 || position[0] > 6 || position[1] < 52 || position[1] > 53)
    )
      notes.push(
        "The source position lies far outside Amsterdam. It is retained as published and has not been corrected.",
      );
    const diameter = text(p["stamdiameterklasse"]);
    if (diameter !== null)
      notes.push(`Source trunk diameter class (not circumference): ${diameter}`);
    return treeSchema.parse({
      ...common,
      scientificName: text(p["soortnaam"]),
      commonName: text(p["soortnaamTop"]),
      location: text(p["standplaatsGedetailleerd"]) ?? text(p["standplaats"]),
      height: heightClass(p["boomhoogteklasseActueel"], notes),
      plantingYear: year(p["jaarVanAanleg"], notes),
      qualityNotes: notes,
    });
  }
  if (dataset === "hamburg") {
    for (const [field, companion, unit] of [
      ["kronendurchmesser", "kronendurchmesser_z", "m"],
      ["stammumfang", "stammumfang_z", "cm"],
    ] as const) {
      const label = text(p[companion]);
      if (label !== null && label !== `${String(p[field])} ${unit}`)
        notes.push(`Source ${field}: ${label}`);
    }
    return treeSchema.parse({
      ...common,
      tag: text(p["baumnummer"]),
      scientificName: text(p["sorte_latein"]) ?? text(p["art_latein"]) ?? text(p["gattung_latein"]),
      commonName: text(p["sorte_deutsch"]) ?? text(p["art_deutsch"]) ?? text(p["gattung_deutsch"]),
      location: text(p["strasse"]),
      crown: scalar(p["kronendurchmesser"], "m"),
      circumference: scalar(p["stammumfang"], "cm"),
      plantingYear: year(p["pflanzjahr"], notes),
      qualityNotes: notes,
    });
  }
  const crown = number(p["kronendurchmesser"]);
  if (crown !== null)
    notes.push(
      `Source crown diameter: approximately ${crown} m. Zürich describes crown sizes as estimated, incomplete and irregularly updated; this is not an exact measurement.`,
    );
  return treeSchema.parse({
    ...common,
    tag: text(p["baumnummer"]),
    scientificName: text(p["baumnamelat"]),
    commonName: text(p["baumnamedeu"]),
    location: text(p["strasse"]),
    plantingYear: year(p["pflanzjahr"], notes),
    qualityNotes: notes,
  });
}
