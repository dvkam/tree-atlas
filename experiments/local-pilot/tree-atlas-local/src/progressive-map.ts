import { z } from "zod";
import {
  boundsSchema,
  contains,
  datasetIdSchema,
  positionSchema,
  releaseSchema,
  treeKey,
} from "./domain.ts";
import type { Bounds, Dataset, Tree } from "./domain.ts";
import type { MapItem } from "./index-format.ts";
import { assetSchema } from "./index-format.ts";
import { readVerifiedAsset } from "./verified-asset.ts";

export const mapNodeSchema = z
  .object({
    bounds: boundsSchema,
    position: positionSchema,
    count: z.number().int().positive(),
    children: z.array(z.number().int().nonnegative()).max(4).optional(),
    asset: assetSchema.optional(),
  })
  .refine((node) => (node.children !== undefined) !== (node.asset !== undefined));
export const mapCatalogSchema = z.object({
  version: z.literal(1),
  dataset: datasetIdSchema,
  release: z.string(),
  locatedCount: z.number().int().nonnegative(),
  nodes: z.array(mapNodeSchema),
});
export type MapCatalog = z.infer<typeof mapCatalogSchema>;
export type MapNode = z.infer<typeof mapNodeSchema>;
export interface ProgressiveMapSession {
  query(bounds: Bounds, zoom: number, signal: AbortSignal): Promise<MapItem[]>;
  detail(id: string): Tree | null;
  dispose(): void;
}
const intersects = (a: Bounds, b: Bounds) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

async function json(
  base: string,
  asset: { file: string; sha256: string },
  signal: AbortSignal,
): Promise<unknown> {
  const bytes = await readVerifiedAsset(new URL(asset.file, base), asset.sha256, signal);
  const text = await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  signal.throwIfAborted();
  return JSON.parse(text);
}

export async function openProgressiveMap(
  base: string,
  dataset: Dataset,
  signal: AbortSignal,
): Promise<ProgressiveMapSession> {
  if (dataset.map === undefined) throw new Error("Spatial map is unavailable.");
  const catalog = mapCatalogSchema.parse(await json(base, dataset.map, signal));
  if (
    catalog.dataset !== dataset.id ||
    catalog.release !== dataset.release ||
    catalog.locatedCount !== dataset.locatedCount
  )
    throw new Error("Spatial map does not match the catalogue.");
  const visited = new Set<number>();
  function validate(index: number, parent?: MapNode): number {
    const node = catalog.nodes[index];
    if (node === undefined || visited.has(index)) throw new Error("Invalid spatial hierarchy.");
    visited.add(index);
    if (
      !contains(node.bounds, node.position) ||
      (parent !== undefined &&
        (!contains(parent.bounds, [node.bounds[0], node.bounds[1]]) ||
          !contains(parent.bounds, [node.bounds[2], node.bounds[3]])))
    )
      throw new Error("Invalid spatial bounds.");
    if (node.children !== undefined) {
      if (
        node.children.length === 0 ||
        node.children.reduce((sum, child) => sum + validate(child, node), 0) !== node.count
      )
        throw new Error("Spatial counts do not match.");
    } else if (
      node.asset?.count !== node.count ||
      !node.asset.file.startsWith(`releases/${dataset.release}/mapleaf-`)
    )
      throw new Error("Invalid spatial leaf.");
    return node.count;
  }
  if (
    (catalog.nodes.length === 0 ? 0 : validate(0)) !== catalog.locatedCount ||
    visited.size !== catalog.nodes.length
  )
    throw new Error("Spatial membership count does not match.");
  const cache = new Map<number, Tree[]>();
  let current: AbortController | undefined;
  let disposed = false;
  return {
    async query(bounds, zoom, querySignal) {
      current?.abort();
      current = new AbortController();
      const active = AbortSignal.any([signal, querySignal, current.signal]);
      active.throwIfAborted();
      if (disposed) throw new Error("Spatial map is closed.");
      const selected: number[] = [];
      function visit(index: number) {
        const node = catalog.nodes[index];
        if (node === undefined || !intersects(bounds, node.bounds)) return;
        const pixels = ((node.bounds[2] - node.bounds[0]) / 360) * 256 * 2 ** zoom;
        if (
          node.children !== undefined &&
          (pixels > 100 || zoom >= 15) &&
          selected.length + node.children.length < 900
        )
          node.children.forEach(visit);
        else selected.push(index);
      }
      if (catalog.nodes.length > 0) visit(0);
      let remaining = 4096;
      let leafBudget = 16;
      const leaves = selected.filter((index) => {
        const node = catalog.nodes[index];
        if (
          leafBudget === 0 ||
          node?.asset === undefined ||
          node.count > remaining ||
          (zoom < 15 && ((node.bounds[2] - node.bounds[0]) / 360) * 256 * 2 ** zoom <= 100)
        )
          return false;
        remaining -= node.count;
        leafBudget--;
        return true;
      });
      let cursor = 0;
      const loaded = new Map<number, Tree[]>();
      await Promise.all(
        Array.from({ length: Math.min(3, leaves.length) }, async () => {
          while (cursor < leaves.length) {
            const index = leaves[cursor++];
            if (index === undefined) break;
            active.throwIfAborted();
            const node = catalog.nodes[index];
            if (node?.asset === undefined) throw new Error("Missing spatial leaf.");
            let trees = cache.get(index);
            if (trees === undefined) {
              const leaf = releaseSchema.parse(await json(base, node.asset, active));
              const ids = new Set<string>();
              if (
                leaf.dataset !== dataset.id ||
                leaf.release !== dataset.release ||
                leaf.trees.length !== node.count
              )
                throw new Error("Spatial leaf does not match its release.");
              for (const tree of leaf.trees) {
                if (
                  tree.dataset !== dataset.id ||
                  tree.position === null ||
                  !contains(node.bounds, tree.position) ||
                  ids.has(tree.sourceId)
                )
                  throw new Error("Invalid spatial tree.");
                ids.add(tree.sourceId);
              }
              trees = leaf.trees;
            }
            active.throwIfAborted();
            cache.delete(index);
            cache.set(index, trees);
            loaded.set(index, trees);
            while (cache.size > 16) {
              const oldest = cache.keys().next().value;
              if (oldest !== undefined) cache.delete(oldest);
            }
          }
        }),
      );
      active.throwIfAborted();
      const markers: MapItem[] = [];
      const seen = new Set<string>();
      for (const trees of loaded.values())
        for (const tree of trees) {
          if (seen.has(tree.sourceId)) throw new Error("Duplicate spatial tree identity.");
          seen.add(tree.sourceId);
        }
      for (const index of selected) {
        const node = catalog.nodes[index];
        if (node === undefined) continue;
        const trees = loaded
          .get(index)
          ?.filter((tree) => tree.position !== null && contains(bounds, tree.position));
        if (trees !== undefined && markers.length + trees.length + selected.length < 1000)
          markers.push(...trees.map((tree): MapItem => ({ kind: "tree", tree })));
        else
          markers.push({
            kind: "cluster",
            id: index,
            // Keep a partially visible cell reachable. Its count still covers the whole cell.
            position: [
              Math.max(bounds[0], Math.min(bounds[2], node.position[0])),
              Math.max(bounds[1], Math.min(bounds[3], node.position[1])),
            ],
            count: node.count,
            zoom: Math.min(20, Math.floor(zoom) + 2),
          });
      }
      return markers;
    },
    detail(id) {
      for (const trees of cache.values()) {
        const tree = trees.find((item) => treeKey(item) === id || item.sourceId === id);
        if (tree !== undefined) return tree;
      }
      return null;
    },
    dispose() {
      disposed = true;
      current?.abort();
      cache.clear();
    },
  };
}
