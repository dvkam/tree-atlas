import { z } from "zod";

export const positionSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export const boundsSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(
    ([w, s, e, n]) => w >= -180 && e <= 180 && s >= -90 && n <= 90 && w < e && s < n,
    "Invalid geographic bounds",
  );
export type Position = z.infer<typeof positionSchema>;
export type Bounds = z.infer<typeof boundsSchema>;
export const datasetIdSchema = z.enum([
  "vienna",
  "geneva",
  "porto",
  "amsterdam",
  "hamburg",
  "zurich",
  "london",
  "camden",
  "edinburgh",
  "belfast",
]);
export type DatasetId = z.infer<typeof datasetIdSchema>;
export const measurementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({ kind: z.literal("value"), value: z.number().positive(), unit: z.enum(["m", "cm"]) }),
  z.object({
    kind: z.literal("range"),
    min: z.number().nonnegative(),
    max: z.number().positive(),
    unit: z.enum(["m", "cm"]),
  }),
  z.object({ kind: z.literal("over"), value: z.number().positive(), unit: z.enum(["m", "cm"]) }),
]);
export type Measurement = z.infer<typeof measurementSchema>;
export const treeSchema = z.object({
  dataset: datasetIdSchema,
  sourceId: z.string().min(1),
  idScope: z.enum(["stable", "release"]),
  position: positionSchema.nullable(),
  tag: z.string().nullable(),
  scientificName: z.string().nullable(),
  commonName: z.string().nullable(),
  location: z.string().nullable(),
  height: measurementSchema,
  crown: measurementSchema,
  circumference: measurementSchema,
  plantingYear: z.number().int().min(1000).max(2200).nullable(),
  plantingEstimated: z.boolean(),
  age: z.string().nullable(),
  observedAt: z.string().nullable(),
  status: z.enum(["existing", "removed", "unknown"]),
  qualityNotes: z.array(z.string()).optional(),
});
export type Tree = z.infer<typeof treeSchema>;
export const datasetSchema = z.object({
  id: datasetIdSchema,
  city: z.string(),
  country: z.string(),
  center: positionSchema,
  bounds: boundsSchema,
  viewBounds: boundsSchema.optional(),
  map: z
    .object({
      file: z.string().regex(/^releases\/[a-zA-Z0-9-]+\/map\.bin$/u),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .optional(),
  release: z.string().regex(/^[a-zA-Z0-9-]+$/u),
  file: z.string().regex(/^releases\/[a-zA-Z0-9-]+\/[a-z]+\.json$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  count: z.number().int().positive(),
  locatedCount: z.number().int().nonnegative().optional(),
  fetchedAt: z.iso.datetime(),
  sourceUrl: z.url(),
  attribution: z.string(),
  license: z.string(),
  licenseUrl: z.url(),
  coverage: z.string(),
  scope: z.enum(["study", "full"]).optional(),
});
export type Dataset = z.infer<typeof datasetSchema>;
export const manifestSchema = z.object({
  version: z.literal(1),
  publishedAt: z.iso.datetime(),
  provenance: z.string().regex(/^provenance\/[a-f0-9]{64}\.json$/u),
  datasets: z.array(datasetSchema).min(1),
});
export type Manifest = z.infer<typeof manifestSchema>;
export const releaseSchema = z.object({
  version: z.literal(1),
  dataset: datasetIdSchema,
  release: z.string(),
  trees: z.array(treeSchema).min(1),
});
export type Release = z.infer<typeof releaseSchema>;

export function contains(bounds: Bounds, [lon, lat]: Position): boolean {
  return lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];
}
export function treeKey(tree: Tree): string {
  return `${tree.dataset}:${tree.sourceId}`;
}
export function measurementLabel(value: Measurement): string {
  switch (value.kind) {
    case "unknown":
      return "Not recorded";
    case "value":
      return `${value.value} ${value.unit}`;
    case "over":
      return `Over ${value.value} ${value.unit}`;
    case "range":
      return `${value.min}–${value.max} ${value.unit}`;
  }
}
