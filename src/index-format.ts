import { z } from "zod";
import { datasetIdSchema } from "./domain.ts";
import type { Bounds, Tree } from "./domain.ts";

export const assetSchema = z.object({
  file: z.string().regex(/^releases\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.bin$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  count: z.number().int().positive(),
});
export const indexDescriptorSchema = z
  .object({
    version: z.union([z.literal(2), z.literal(3)]),
    dataset: datasetIdSchema,
    release: z.string(),
    index: assetSchema.extend({ encoding: z.enum(["columns-v1", "text-columns-v1"]).optional() }),
    geometry: assetSchema.optional(),
    details: z.array(assetSchema).min(1),
  })
  .refine(
    (value) => (value.version === 3) === (value.geometry !== undefined),
    "Invalid geometry descriptor",
  );
export type IndexDescriptor = z.infer<typeof indexDescriptorSchema>;
// Dictionary indexes use -1 for an absent value. Source IDs are never converted to numbers.
export const indexRowSchema = z
  .tuple([
    z.string().min(1),
    z.number().min(-180).max(180).nullable(),
    z.number().min(-90).max(90).nullable(),
    z.number().int().min(-1),
    z.number().int().min(-1),
    z.number().int().min(-1),
    z.number().int().min(-1),
    z.number().int().nonnegative(),
  ])
  .refine(
    (row) => (row[1] === null) === (row[2] === null),
    "Both coordinates must be present or absent",
  );
export const compactIndexSchema = z.object({
  version: z.literal(2),
  dataset: datasetIdSchema,
  release: z.string(),
  strings: z.array(z.string()),
  rows: z.array(indexRowSchema).min(1),
});
export type CompactIndex = z.infer<typeof compactIndexSchema>;
export type IndexRow = z.infer<typeof indexRowSchema>;
export type Summary = Pick<
  Tree,
  "dataset" | "sourceId" | "position" | "tag" | "scientificName" | "commonName" | "location"
> & { positionPending?: true | undefined };
export type MapItem =
  | { kind: "tree"; tree: Summary }
  | { kind: "cluster"; id: number; position: [number, number]; count: number; zoom: number };
export type InventoryQuery = {
  q: string;
  area: Bounds | null;
  viewport: Bounds;
  zoom: number;
  offset: number;
  limit: number;
};
export type InventoryResult = {
  total: number;
  items: Summary[];
  markers: MapItem[];
  mapAggregated: boolean;
  elapsedMs: number;
  spatialReady?: boolean | undefined;
};
