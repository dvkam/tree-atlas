import Supercluster from "supercluster";
import type { PointFeature } from "supercluster";
import { contains, releaseSchema } from "./domain.ts";
import type { Dataset, Tree } from "./domain.ts";
import { normalizeText } from "./catalog.ts";
import { compactIndexSchema, indexDescriptorSchema } from "./index-format.ts";
import { inventoryQuerySchema } from "./inventory-protocol.ts";
import type {
  CompactIndex,
  IndexDescriptor,
  IndexRow,
  InventoryQuery,
  InventoryResult,
  MapItem,
  Summary,
} from "./index-format.ts";

export interface InventorySession {
  query(query: InventoryQuery): InventoryResult;
  suggest(text: string): string[];
  detail(sourceId: string): Promise<Tree | null>;
  dispose(): void;
}

async function verifiedJson(
  base: string,
  file: string,
  expectedHash: string,
  compressed: boolean,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(new URL(file, base), { signal });
  if (!response.ok) throw new Error(`Inventory asset unavailable (${response.status}). Try again.`);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== expectedHash) throw new Error("Inventory asset failed its integrity check.");
  signal.throwIfAborted();
  const text = compressed
    ? await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).text()
    : new TextDecoder().decode(bytes);
  signal.throwIfAborted();
  return JSON.parse(text);
}

function dictionary(index: CompactIndex, value: number): string | null {
  if (value === -1) return null;
  const text = index.strings[value];
  if (text === undefined) throw new Error("Invalid inventory dictionary reference.");
  return text;
}
function summary(index: CompactIndex, row: IndexRow): Summary {
  return {
    dataset: index.dataset,
    sourceId: row[0],
    position: [row[1], row[2]],
    tag: dictionary(index, row[3]),
    scientificName: dictionary(index, row[4]),
    commonName: dictionary(index, row[5]),
    location: dictionary(index, row[6]),
  };
}
function validateIndex(
  index: CompactIndex,
  descriptor: IndexDescriptor,
  dataset: Dataset,
): Map<string, IndexRow> {
  if (
    index.dataset !== dataset.id ||
    index.release !== dataset.release ||
    index.rows.length !== dataset.count ||
    descriptor.index.count !== dataset.count ||
    descriptor.details.reduce((sum, asset) => sum + asset.count, 0) !== dataset.count
  )
    throw new Error("Index does not match the catalogue.");
  const rows = new Map<string, IndexRow>();
  const counts = descriptor.details.map(() => 0);
  for (const row of index.rows) {
    if (
      rows.has(row[0]) ||
      !contains(dataset.bounds, [row[1], row[2]]) ||
      descriptor.details[row[7]] === undefined
    )
      throw new Error("Invalid or duplicate inventory index record.");
    for (const reference of [row[3], row[4], row[5], row[6]]) dictionary(index, reference);
    counts[row[7]] = (counts[row[7]] ?? 0) + 1;
    rows.set(row[0], row);
  }
  if (descriptor.details.some((asset, i) => asset.count !== counts[i]))
    throw new Error("Detail shard counts do not match the index.");
  const files = [descriptor.index.file, ...descriptor.details.map((asset) => asset.file)];
  if (new Set(files).size !== files.length) throw new Error("Duplicate inventory asset path.");
  return rows;
}

function compactLegacy(trees: Tree[], dataset: Dataset): CompactIndex {
  const strings: string[] = [];
  const lookup = new Map<string, number>();
  function intern(value: string | null): number {
    if (value === null) return -1;
    const existing = lookup.get(value);
    if (existing !== undefined) return existing;
    const id = strings.length;
    strings.push(value);
    lookup.set(value, id);
    return id;
  }
  return {
    version: 2,
    dataset: dataset.id,
    release: dataset.release,
    strings,
    rows: trees.map((tree) => [
      tree.sourceId,
      ...tree.position,
      intern(tree.tag),
      intern(tree.scientificName),
      intern(tree.commonName),
      intern(tree.location),
      0,
    ]),
  };
}

type PointProperties = { row: number };
type ClusterProperties = Record<string, never>;

function engine(
  index: CompactIndex,
  readDetail: (sourceId: string) => Promise<Tree | null>,
  controller: AbortController,
  detach: () => void,
): InventorySession {
  const normalized = index.strings.map(normalizeText);
  const ids = index.rows.map((row) => normalizeText(row[0]));
  let cachedFilter: string | null = null;
  let filtered: number[] = [];
  let clusters: Supercluster<PointProperties, ClusterProperties> | null = null;
  function open() {
    controller.signal.throwIfAborted();
  }
  return {
    query(input) {
      open();
      const started = performance.now();
      const query = inventoryQuerySchema.parse(input);
      const term = normalizeText(query.q);
      const key = JSON.stringify([term, query.area]);
      if (key !== cachedFilter) {
        filtered = [];
        for (let i = 0; i < index.rows.length; i++) {
          const row = index.rows[i];
          if (!row) continue;
          if (query.area !== null && !contains(query.area, [row[1], row[2]])) continue;
          if (
            term !== "" &&
            !ids[i]?.includes(term) &&
            ![row[3], row[4], row[5], row[6]].some((reference) =>
              normalized[reference]?.includes(term),
            )
          )
            continue;
          filtered.push(i);
        }
        clusters = new Supercluster<PointProperties, ClusterProperties>({
          maxZoom: 20,
          radius: 60,
        });
        const points: PointFeature<PointProperties>[] = [];
        for (const i of filtered) {
          const row = index.rows[i];
          if (row)
            points.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [row[1], row[2]] },
              properties: { row: i },
            });
        }
        clusters.load(points);
        cachedFilter = key;
      }
      if (clusters === null) throw new Error("Inventory index unavailable.");
      const activeClusters = clusters;
      let zoom = Math.min(20, Math.floor(query.zoom));
      let features = clusters.getClusters(query.viewport, zoom);
      while (features.length > 1000 && zoom > 0) {
        zoom--;
        features = clusters.getClusters(query.viewport, zoom);
      }
      // The bounded world has <1000 radius-60 clusters at zoom zero. Fail explicitly if that invariant changes.
      if (features.length > 1000)
        throw new Error("Map density exceeds the display budget. Narrow the search area.");
      let mapAggregated = zoom < Math.floor(query.zoom);
      const markers: MapItem[] = features.map((feature) => {
        if ("cluster" in feature.properties) {
          const [lon, lat] = feature.geometry.coordinates;
          if (lon === undefined || lat === undefined) throw new Error("Invalid cluster position.");
          const expansion = activeClusters.getClusterExpansionZoom(feature.properties.cluster_id);
          if (expansion > 20) mapAggregated = true;
          return {
            kind: "cluster",
            id: feature.properties.cluster_id,
            position: [lon, lat],
            count: feature.properties.point_count,
            zoom: Math.min(20, expansion),
          };
        }
        const row = index.rows[feature.properties.row];
        if (!row) throw new Error("Invalid cluster record.");
        return { kind: "tree", tree: summary(index, row) };
      });
      const items: Summary[] = [];
      for (const i of filtered.slice(query.offset, query.offset + query.limit)) {
        const row = index.rows[i];
        if (row) items.push(summary(index, row));
      }
      return {
        total: filtered.length,
        items,
        markers,
        mapAggregated,
        elapsedMs: performance.now() - started,
      };
    },
    suggest(text) {
      open();
      const term = normalizeText(text);
      if (term.length < 2) return [];
      const matches = new Set<string>();
      for (let i = 0; i < index.strings.length; i++) {
        const value = index.strings[i];
        if (value !== undefined && normalized[i]?.includes(term)) matches.add(value);
        if (matches.size === 8) break;
      }
      return [...matches];
    },
    detail(sourceId) {
      open();
      return readDetail(sourceId);
    },
    dispose() {
      controller.abort();
      detach();
      clusters = null;
      filtered = [];
    },
  };
}

/** The worker and conformance tests use this same verified catalogue interface. */
export async function loadInventory(
  base: string,
  dataset: Dataset,
  signal?: AbortSignal,
): Promise<InventorySession> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.throwIfAborted();
  signal?.addEventListener("abort", abort, { once: true });
  const detach = () => signal?.removeEventListener("abort", abort);
  try {
    const raw = await verifiedJson(base, dataset.file, dataset.sha256, false, controller.signal);
    const legacy = releaseSchema.safeParse(raw);
    if (legacy.success) {
      const release = legacy.data;
      if (
        release.dataset !== dataset.id ||
        release.release !== dataset.release ||
        release.trees.length !== dataset.count
      )
        throw new Error("Release does not match the catalogue.");
      const trees = new Map<string, Tree>();
      for (const tree of release.trees) {
        if (
          tree.dataset !== dataset.id ||
          trees.has(tree.sourceId) ||
          !contains(dataset.bounds, tree.position)
        )
          throw new Error("Invalid or duplicate inventory record.");
        trees.set(tree.sourceId, tree);
      }
      return engine(
        compactLegacy(release.trees, dataset),
        (id) => Promise.resolve(trees.get(id) ?? null),
        controller,
        detach,
      );
    }
    const descriptor = indexDescriptorSchema.parse(raw);
    if (descriptor.dataset !== dataset.id || descriptor.release !== dataset.release)
      throw new Error("Descriptor does not match the catalogue.");
    const index = compactIndexSchema.parse(
      await verifiedJson(
        base,
        descriptor.index.file,
        descriptor.index.sha256,
        true,
        controller.signal,
      ),
    );
    const rows = validateIndex(index, descriptor, dataset);
    const cache = new Map<number, Map<string, Tree>>();
    const pending = new Map<number, Promise<Map<string, Tree>>>();
    async function readShard(shard: number): Promise<Map<string, Tree>> {
      const asset = descriptor.details[shard];
      if (!asset) throw new Error("Missing detail shard.");
      const release = releaseSchema.parse(
        await verifiedJson(base, asset.file, asset.sha256, true, controller.signal),
      );
      if (
        release.dataset !== dataset.id ||
        release.release !== dataset.release ||
        release.trees.length !== asset.count
      )
        throw new Error("Detail shard does not match the catalogue.");
      const trees = new Map<string, Tree>();
      for (const tree of release.trees) {
        const row = rows.get(tree.sourceId);
        if (!row || row[7] !== shard || tree.dataset !== dataset.id || trees.has(tree.sourceId))
          throw new Error("Detail record does not match its index.");
        const expected = summary(index, row);
        if (
          tree.position[0] !== expected.position[0] ||
          tree.position[1] !== expected.position[1] ||
          tree.tag !== expected.tag ||
          tree.scientificName !== expected.scientificName ||
          tree.commonName !== expected.commonName ||
          tree.location !== expected.location
        )
          throw new Error("Detail record does not match its index.");
        trees.set(tree.sourceId, tree);
      }
      cache.set(shard, trees);
      while (cache.size > 4) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return trees;
    }
    return engine(
      index,
      async (id) => {
        const row = rows.get(id);
        if (!row) return null;
        const shard = row[7];
        const cached = cache.get(shard);
        if (cached) {
          cache.delete(shard);
          cache.set(shard, cached);
          return cached.get(id) ?? null;
        }
        let loading = pending.get(shard);
        if (!loading) {
          loading = readShard(shard);
          pending.set(shard, loading);
        }
        try {
          return (await loading).get(id) ?? null;
        } finally {
          pending.delete(shard);
        }
      },
      controller,
      detach,
    );
  } catch (error) {
    controller.abort();
    detach();
    throw error;
  }
}
