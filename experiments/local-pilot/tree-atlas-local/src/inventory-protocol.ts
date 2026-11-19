import { z } from "zod";
import { boundsSchema, datasetSchema, treeSchema, positionSchema } from "./domain.ts";

const requestId = z.number().int().nonnegative();
export const inventoryQuerySchema = z.object({
  q: z.string().max(500),
  area: boundsSchema.nullable(),
  viewport: boundsSchema,
  zoom: z.number().finite().min(0).max(24),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
});
export const inventoryRequestSchema = z.discriminatedUnion("kind", [
  z.object({ id: requestId, kind: z.literal("init"), base: z.url(), dataset: datasetSchema }),
  z.object({ id: requestId, kind: z.literal("query"), query: inventoryQuerySchema }),
  z.object({
    id: requestId,
    kind: z.literal("cluster-members"),
    query: inventoryQuerySchema,
    clusterId: z.number().int().nonnegative(),
  }),
  z.object({ id: requestId, kind: z.literal("suggest"), text: z.string().max(500) }),
  z.object({ id: requestId, kind: z.literal("detail"), sourceId: z.string() }),
]);
export type InventoryRequest = z.infer<typeof inventoryRequestSchema>;
const summarySchema = treeSchema
  .pick({
    dataset: true,
    sourceId: true,
    position: true,
    tag: true,
    scientificName: true,
    commonName: true,
    location: true,
  })
  .extend({ positionPending: z.literal(true).optional() });
const resultSchema = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(summarySchema).max(100),
  markers: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("tree"), tree: summarySchema }),
        z.object({
          kind: z.literal("cluster"),
          id: z.union([z.number(), z.string()]),
          position: positionSchema,
          count: z.number().int().positive(),
          zoom: z.number(),
        }),
      ]),
    )
    .max(1000),
  mapAggregated: z.boolean(),
  elapsedMs: z.number().nonnegative(),
  spatialReady: z.boolean().optional(),
  locatedTotal: z.number().int().nonnegative().optional(),
  viewportLocatedTotal: z.number().int().nonnegative().optional(),
  representedLocatedCount: z.number().int().nonnegative().optional(),
});
export const inventoryResponseSchema = z.discriminatedUnion("kind", [
  z.object({ id: requestId, kind: z.literal("spatial"), error: z.string().nullable() }),
  z.object({ id: requestId, kind: z.literal("ready") }),
  z.object({ id: requestId, kind: z.literal("result"), result: resultSchema }),
  z.object({
    id: requestId,
    kind: z.literal("members"),
    total: z.number().int().nonnegative(),
    items: z.array(summarySchema).max(100),
  }),
  z.object({ id: requestId, kind: z.literal("suggestions"), values: z.array(z.string()).max(8) }),
  z.object({ id: requestId, kind: z.literal("record"), tree: treeSchema.nullable() }),
  z.object({ id: requestId, kind: z.literal("error"), message: z.string() }),
]);
export type InventoryResponse = z.infer<typeof inventoryResponseSchema>;
