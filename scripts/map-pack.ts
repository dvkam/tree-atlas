import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { releaseSchema } from "../src/domain.ts";
import type { Bounds, DatasetId, Tree } from "../src/domain.ts";
import { mapCatalogSchema } from "../src/progressive-map.ts";
import type { MapNode } from "../src/progressive-map.ts";

export function packMap(dataset: DatasetId, release: string, trees: Tree[]) {
  const files: { name: string; bytes: Buffer }[] = [];
  const nodes: MapNode[] = [];
  const ids = new Set<string>();
  const located = trees.filter((tree) => {
    if (tree.dataset !== dataset || ids.has(tree.sourceId))
      throw new Error("Invalid map source identity.");
    ids.add(tree.sourceId);
    return tree.position !== null;
  });
  function store(name: string, value: unknown, count: number) {
    const bytes = gzipSync(JSON.stringify(value), { level: 9 });
    files.push({ name, bytes });
    return {
      file: `releases/${release}/${name}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      count,
    };
  }
  function partition(items: Tree[], bounds: Bounds, depth: number): number {
    const index = nodes.length;
    const position: [number, number] = [0, 0];
    for (const tree of items) {
      if (tree.position !== null) {
        position[0] += tree.position[0] / items.length;
        position[1] += tree.position[1] / items.length;
      }
    }
    const node: MapNode = { bounds, position, count: items.length };
    nodes.push(node);
    if (items.length <= 512 || depth >= 20) {
      node.asset = store(
        `mapleaf-${index}.bin`,
        releaseSchema.parse({ version: 1, dataset, release, trees: items }),
        items.length,
      );
    } else {
      const x = (bounds[0] + bounds[2]) / 2;
      const y = (bounds[1] + bounds[3]) / 2;
      const groups: Tree[][] = [[], [], [], []];
      for (const tree of items) {
        if (tree.position !== null)
          groups[(tree.position[0] >= x ? 1 : 0) + (tree.position[1] >= y ? 2 : 0)]?.push(tree);
      }
      node.children = [];
      for (const [quadrant, group] of groups.entries())
        if (group.length > 0)
          node.children.push(
            partition(
              group,
              [
                quadrant % 2 === 0 ? bounds[0] : x,
                quadrant < 2 ? bounds[1] : y,
                quadrant % 2 === 0 ? x : bounds[2],
                quadrant < 2 ? y : bounds[3],
              ],
              depth + 1,
            ),
          );
    }
    return index;
  }
  if (located.length > 0) {
    const bounds: Bounds = [180, 90, -180, -90];
    for (const tree of located)
      if (tree.position !== null) {
        bounds[0] = Math.min(bounds[0], tree.position[0]);
        bounds[1] = Math.min(bounds[1], tree.position[1]);
        bounds[2] = Math.max(bounds[2], tree.position[0]);
        bounds[3] = Math.max(bounds[3], tree.position[1]);
      }
    bounds[0] = Math.max(-180, bounds[0] - 0.000001);
    bounds[1] = Math.max(-90, bounds[1] - 0.000001);
    bounds[2] = Math.min(180, bounds[2] + 0.000001);
    bounds[3] = Math.min(90, bounds[3] + 0.000001);
    partition(located, bounds, 0);
  }
  const catalog = mapCatalogSchema.parse({
    version: 1,
    dataset,
    release,
    locatedCount: located.length,
    nodes,
  });
  const asset = store("map.bin", catalog, located.length);
  return { asset: { file: asset.file, sha256: asset.sha256 }, files };
}
