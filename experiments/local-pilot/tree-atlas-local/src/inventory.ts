import { decodeIndexColumns, decodeTextColumns } from "./index-codec.ts";
import { readVerifiedAsset } from "./verified-asset.ts";
import { contains, releaseSchema, treeSchema } from "./domain.ts";
import type { Dataset, Tree } from "./domain.ts";
import { normalizeText } from "./catalog.ts";
import { validateFrozenQueryText } from "./frozen-normalizer.ts";
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
  clusterMembers(query: InventoryQuery, clusterId: number): { total: number; items: Summary[] };
  suggest(text: string): string[];
  detail(sourceId: string): Promise<Tree | null>;
  dispose(): void;
  spatialReady?: Promise<void>;
  hasGeometry?: () => boolean;
}
export type InventoryAssetReader = (
  url: URL,
  hash: string,
  signal: AbortSignal,
) => Promise<ArrayBuffer>;
export type InventoryLoadOptions = {
  readAsset?: InventoryAssetReader;
  readDetail?: (sourceId: string) => Promise<Tree | null>;
};

async function verifiedJson(
  base: string,
  file: string,
  expectedHash: string,
  compressed: boolean,
  signal: AbortSignal,
  readAsset: InventoryAssetReader = readVerifiedAsset,
): Promise<unknown> {
  const bytes = await readAsset(new URL(file, base), expectedHash, signal);
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
    position: row[1] === null || row[2] === null ? null : [row[1], row[2]],
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
    (dataset.locatedCount !== undefined &&
      index.rows.filter((row) => row[1] !== null).length !== dataset.locatedCount) ||
    descriptor.details.reduce((sum, asset) => sum + asset.count, 0) !== dataset.count
  )
    throw new Error("Index does not match the catalogue.");
  const rows = new Map<string, IndexRow>();
  const counts = descriptor.details.map(() => 0);
  for (const row of index.rows) {
    if (
      rows.has(row[0]) ||
      (row[1] !== null && row[2] !== null && !contains(dataset.bounds, [row[1], row[2]])) ||
      descriptor.details[row[7]] === undefined
    )
      throw new Error("Invalid or duplicate inventory index record.");
    for (const reference of [row[3], row[4], row[5], row[6]]) dictionary(index, reference);
    counts[row[7]] = (counts[row[7]] ?? 0) + 1;
    rows.set(row[0], row);
  }
  if (descriptor.details.some((asset, i) => asset.count !== counts[i]))
    throw new Error("Detail shard counts do not match the index.");
  const files = [
    descriptor.index.file,
    ...(descriptor.geometry === undefined ? [] : [descriptor.geometry.file]),
    ...descriptor.details.map((asset) => asset.file),
  ];
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
      tree.position?.[0] ?? null,
      tree.position?.[1] ?? null,
      intern(tree.tag),
      intern(tree.scientificName),
      intern(tree.commonName),
      intern(tree.location),
      0,
    ]),
  };
}

const MAX_GRID_WIDTH = 30;
const GRID_CELLS = MAX_GRID_WIDTH * MAX_GRID_WIDTH;
const CELL_PIXELS = 60;
const MAX_MERCATOR_LATITUDE = 85.0511287798066;

type GridLayout = { columns: number; rows: number; cells: number };

function mercatorY(latitude: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const sine = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI);
}

function gridLayout(query: InventoryQuery): GridLayout {
  const [west, south, east, north] = query.viewport;
  const worldPixels = 256 * 2 ** query.zoom;
  const width = ((east - west) / 360) * worldPixels;
  const height = (mercatorY(south) - mercatorY(north)) * worldPixels;
  const columns = Math.max(1, Math.min(MAX_GRID_WIDTH, Math.floor(width / CELL_PIXELS)));
  const rows = Math.max(1, Math.min(MAX_GRID_WIDTH, Math.floor(height / CELL_PIXELS)));
  return { columns, rows, cells: columns * rows };
}

function gridCell(
  viewport: InventoryQuery["viewport"],
  layout: GridLayout,
  lon: number,
  lat: number,
): number {
  const [west, south, east, north] = viewport;
  if (lon < west || lon > east || lat < south || lat > north) return -1;
  // Divide first so valid subnormal viewport spans cannot overflow the scale.
  const x = Math.min(
    layout.columns - 1,
    Math.floor(((lon - west) / (east - west)) * layout.columns),
  );
  const y = Math.min(layout.rows - 1, Math.floor(((lat - south) / (north - south)) * layout.rows));
  return y * layout.columns + x;
}

type QueryEngine = {
  session: InventorySession;
  invalidateGeometry(): void;
};

function engine(
  index: CompactIndex,
  readDetail: (sourceId: string) => Promise<Tree | null>,
  controller: AbortController,
  detach: () => void,
): QueryEngine {
  const normalized = index.strings.map(normalizeText);
  const ids = index.rows.map((row) => normalizeText(row[0]));
  let cachedFilter: string | null = null;
  let filtered = new Uint32Array(index.rows.length);
  let filteredCount = 0;
  let cachedMap: string | null = null;
  let generation = 0;
  let layout: GridLayout = { columns: 1, rows: 1, cells: 1 };
  const counts = new Uint32Array(GRID_CELLS);
  const firstRows = new Uint32Array(GRID_CELLS);
  const longitudes = new Float64Array(GRID_CELLS);
  const latitudes = new Float64Array(GRID_CELLS);
  let locatedTotal = 0;
  let viewportLocatedTotal = 0;

  function open() {
    controller.signal.throwIfAborted();
  }
  function matchingRow(position: number): IndexRow {
    const ordinal = filtered[position];
    const row = ordinal === undefined ? undefined : index.rows[ordinal];
    if (ordinal === undefined || row === undefined) throw new Error("Invalid inventory ordinal.");
    return row;
  }
  function prepare(input: InventoryQuery): InventoryQuery {
    open();
    const query = inventoryQuerySchema.parse(input);
    validateFrozenQueryText(query.q);
    const term = normalizeText(query.q);
    const filterKey = JSON.stringify([term, query.area]);
    if (filterKey !== cachedFilter) {
      filteredCount = 0;
      const area = query.area;
      for (let i = 0; i < index.rows.length; i++) {
        const row = index.rows[i];
        if (row === undefined) throw new Error("Invalid inventory ordinal.");
        const lon = row[1];
        const lat = row[2];
        if (
          area !== null &&
          (lon === null ||
            lat === null ||
            lon < area[0] ||
            lon > area[2] ||
            lat < area[1] ||
            lat > area[3])
        )
          continue;
        if (
          term !== "" &&
          ids[i]?.includes(term) !== true &&
          normalized[row[3]]?.includes(term) !== true &&
          normalized[row[4]]?.includes(term) !== true &&
          normalized[row[5]]?.includes(term) !== true &&
          normalized[row[6]]?.includes(term) !== true
        )
          continue;
        filtered[filteredCount++] = i;
      }
      cachedFilter = filterKey;
      cachedMap = null;
    }
    const mapKey = JSON.stringify([filterKey, query.viewport, query.zoom]);
    if (mapKey !== cachedMap) {
      if (generation >= Math.floor(Number.MAX_SAFE_INTEGER / GRID_CELLS) - 1)
        throw new Error("Reopen this offline city to continue selecting clusters.");
      generation++;
      layout = gridLayout(query);
      counts.fill(0);
      firstRows.fill(0);
      longitudes.fill(0);
      latitudes.fill(0);
      locatedTotal = 0;
      viewportLocatedTotal = 0;
      for (let i = 0; i < filteredCount; i++) {
        const row = matchingRow(i);
        const lon = row[1];
        const lat = row[2];
        if (lon === null || lat === null) continue;
        locatedTotal++;
        const cell = gridCell(query.viewport, layout, lon, lat);
        if (cell < 0) continue;
        viewportLocatedTotal++;
        const count = counts[cell] ?? 0;
        if (count === 0) {
          const ordinal = filtered[i];
          if (ordinal === undefined) throw new Error("Invalid inventory ordinal.");
          firstRows[cell] = ordinal;
        }
        counts[cell] = count + 1;
        longitudes[cell] = (longitudes[cell] ?? 0) + lon;
        latitudes[cell] = (latitudes[cell] ?? 0) + lat;
      }
      cachedMap = mapKey;
    }
    return query;
  }

  const session: InventorySession = {
    query(input) {
      const started = performance.now();
      const query = prepare(input);
      const markers: MapItem[] = [];
      let mapAggregated = false;
      for (let cell = 0; cell < layout.cells; cell++) {
        const count = counts[cell] ?? 0;
        if (count === 0) continue;
        if (count === 1) {
          const ordinal = firstRows[cell];
          const row = ordinal === undefined ? undefined : index.rows[ordinal];
          if (row === undefined) throw new Error("Invalid inventory ordinal.");
          markers.push({ kind: "tree", tree: summary(index, row) });
        } else {
          mapAggregated = true;
          markers.push({
            kind: "cluster",
            id: generation * GRID_CELLS + cell,
            position: [(longitudes[cell] ?? 0) / count, (latitudes[cell] ?? 0) / count],
            count,
            zoom: Math.min(24, Math.floor(query.zoom) + 1),
          });
        }
      }
      const items: Summary[] = [];
      for (let i = query.offset; i < Math.min(filteredCount, query.offset + query.limit); i++)
        items.push(summary(index, matchingRow(i)));
      return {
        total: filteredCount,
        locatedTotal,
        viewportLocatedTotal,
        representedLocatedCount: viewportLocatedTotal,
        items,
        markers,
        mapAggregated,
        elapsedMs: performance.now() - started,
      };
    },
    clusterMembers(input, clusterId) {
      const query = prepare(input);
      const cell = clusterId - generation * GRID_CELLS;
      const total = counts[cell] ?? 0;
      if (!Number.isSafeInteger(clusterId) || cell < 0 || cell >= layout.cells || total < 2)
        throw new Error("This cluster is not part of the requested map.");
      const items: Summary[] = [];
      let visited = 0;
      for (let i = 0; i < filteredCount && items.length < query.limit; i++) {
        const row = matchingRow(i);
        const lon = row[1];
        const lat = row[2];
        if (lon === null || lat === null || gridCell(query.viewport, layout, lon, lat) !== cell)
          continue;
        if (visited++ >= query.offset) items.push(summary(index, row));
      }
      return { total, items };
    },
    suggest(text) {
      open();
      validateFrozenQueryText(text);
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
      filtered = new Uint32Array(0);
      filteredCount = 0;
      cachedFilter = null;
      cachedMap = null;
    },
  };
  return {
    session,
    invalidateGeometry() {
      cachedFilter = null;
      cachedMap = null;
    },
  };
}
/** The worker and conformance tests use this same verified catalogue interface. */
export async function loadInventory(
  base: string,
  dataset: Dataset,
  signal?: AbortSignal,
  options: InventoryLoadOptions = {},
): Promise<InventorySession> {
  const readAsset = options.readAsset ?? readVerifiedAsset;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.throwIfAborted();
  signal?.addEventListener("abort", abort, { once: true });
  const detach = () => signal?.removeEventListener("abort", abort);
  try {
    const raw = await verifiedJson(
      base,
      dataset.file,
      dataset.sha256,
      false,
      controller.signal,
      readAsset,
    );
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
          (tree.position !== null && !contains(dataset.bounds, tree.position))
        )
          throw new Error("Invalid or duplicate inventory record.");
        trees.set(tree.sourceId, tree);
      }
      return engine(
        compactLegacy(release.trees, dataset),
        (id) => Promise.resolve(trees.get(id) ?? null),
        controller,
        detach,
      ).session;
    }
    const descriptor = indexDescriptorSchema.parse(raw);
    if (descriptor.dataset !== dataset.id || descriptor.release !== dataset.release)
      throw new Error("Descriptor does not match the catalogue.");
    const selectedIndex = descriptor.index;
    const split = descriptor.version === 3;
    const stored = await readAsset(
      new URL(selectedIndex.file, base),
      selectedIndex.sha256,
      controller.signal,
    );
    const unpacked = new Uint8Array(
      await new Response(
        new Blob([stored]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
    controller.signal.throwIfAborted();
    const index =
      selectedIndex.encoding === "text-columns-v1"
        ? decodeTextColumns(unpacked)
        : selectedIndex.encoding === "columns-v1"
          ? decodeIndexColumns(unpacked)
          : compactIndexSchema.parse(JSON.parse(new TextDecoder().decode(unpacked)));
    const rows = validateIndex(
      index,
      descriptor,
      split ? { ...dataset, locatedCount: 0 } : dataset,
    );
    if (
      split &&
      (selectedIndex.count !== dataset.count ||
        descriptor.geometry?.count !== dataset.count ||
        index.rows.some((row) => row[1] !== null || row[2] !== null))
    )
      throw new Error("Invalid complete text index.");
    let geometryReady = !split;
    const cache = new Map<number, Map<string, Tree>>();
    const pending = new Map<number, Promise<Map<string, Tree>>>();
    async function readShard(shard: number): Promise<Map<string, Tree>> {
      const asset = descriptor.details[shard];
      if (!asset) throw new Error("Missing detail shard.");
      const release = releaseSchema.parse(
        await verifiedJson(base, asset.file, asset.sha256, true, controller.signal, readAsset),
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
          (geometryReady &&
            (tree.position?.[0] !== expected.position?.[0] ||
              tree.position?.[1] !== expected.position?.[1])) ||
          (tree.position !== null && !contains(dataset.bounds, tree.position)) ||
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
    const readDetail = async (id: string): Promise<Tree | null> => {
      const row = rows.get(id);
      if (!row) return null;
      if (options.readDetail !== undefined) {
        const storedTree = await options.readDetail(id);
        if (storedTree === null) throw new Error("These details were not saved for offline use.");
        const tree = treeSchema.parse(storedTree);
        const expected = summary(index, row);
        if (
          tree.dataset !== dataset.id ||
          tree.sourceId !== id ||
          tree.tag !== expected.tag ||
          tree.scientificName !== expected.scientificName ||
          tree.commonName !== expected.commonName ||
          tree.location !== expected.location ||
          (geometryReady &&
            ((tree.position?.[0] ?? null) !== row[1] || (tree.position?.[1] ?? null) !== row[2]))
        )
          throw new Error("Saved detail does not match its pinned inventory.");
        return tree;
      }
      const shard = row[7];
      const cached = cache.get(shard);
      if (cached) {
        cache.delete(shard);
        cache.set(shard, cached);
        const tree = cached.get(id) ?? null;
        if (
          geometryReady &&
          tree !== null &&
          ((tree.position?.[0] ?? null) !== row[1] || (tree.position?.[1] ?? null) !== row[2])
        )
          throw new Error("Cached detail does not match exact geometry.");
        return tree;
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
    };
    const active = engine(index, readDetail, controller, detach);
    if (!split) return active.session;
    const spatialReady = (async () => {
      const asset = descriptor.geometry;
      if (asset === undefined) throw new Error("Missing geometry asset.");
      const bytes = await readAsset(new URL(asset.file, base), asset.sha256, controller.signal);
      const decoded = new Uint8Array(
        await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).arrayBuffer(),
      );
      controller.signal.throwIfAborted();
      if (decoded.length !== index.rows.length * 16) throw new Error("Invalid geometry length.");
      const value = new DataView(new ArrayBuffer(8));
      const count = index.rows.length;
      const coordinates = new Float64Array(count * 2);
      let located = 0;
      for (let i = 0; i < count; i++) {
        for (let column = 0; column < 2; column++) {
          for (let lane = 0; lane < 8; lane++)
            value.setUint8(lane, decoded[column * count * 8 + lane * count + i] ?? 0);
          const coordinate = value.getFloat64(0, true);
          coordinates[i * 2 + column] = coordinate;
        }
        const lon = coordinates[i * 2];
        const lat = coordinates[i * 2 + 1];
        if (lon === undefined || lat === undefined || Number.isNaN(lon) !== Number.isNaN(lat))
          throw new Error("Invalid geometry coordinates.");
        if (!Number.isNaN(lon)) {
          if (
            !Number.isFinite(lon) ||
            !Number.isFinite(lat) ||
            !contains(dataset.bounds, [lon, lat])
          )
            throw new Error("Geometry lies outside catalogue bounds.");
          located++;
        }
      }
      if (dataset.locatedCount !== undefined && located !== dataset.locatedCount)
        throw new Error("Geometry count does not match catalogue.");
      const earlyDetails = new Map<string, Tree>();
      for (const shard of cache.values())
        for (const [id, tree] of shard) earlyDetails.set(id, tree);
      for (const [i, row] of index.rows.entries()) {
        const tree = earlyDetails.get(row[0]);
        if (tree === undefined) continue;
        const lon = coordinates[i * 2];
        const lat = coordinates[i * 2 + 1];
        if (
          (tree.position?.[0] ?? null) !== (lon === undefined || Number.isNaN(lon) ? null : lon) ||
          (tree.position?.[1] ?? null) !== (lat === undefined || Number.isNaN(lat) ? null : lat)
        )
          throw new Error("Cached detail does not match exact geometry.");
      }
      for (const [i, row] of index.rows.entries()) {
        const lon = coordinates[i * 2];
        const lat = coordinates[i * 2 + 1];
        row[1] = lon === undefined || Number.isNaN(lon) ? null : lon;
        row[2] = lat === undefined || Number.isNaN(lat) ? null : lat;
      }
      geometryReady = true;
      active.invalidateGeometry();
    })();
    // Keep failures observable through the session promise without an unhandled rejection.
    void spatialReady.catch(() => undefined);
    return {
      query(query) {
        if (!geometryReady && query.area !== null)
          throw new Error("Exact area search is still loading.");
        const result = active.session.query(query);
        return {
          ...result,
          items: geometryReady
            ? result.items
            : result.items.map((item) => ({ ...item, positionPending: true as const })),
          spatialReady: geometryReady,
        };
      },
      suggest: (text) => active.session.suggest(text),
      clusterMembers(query, clusterId) {
        if (!geometryReady) throw new Error("Exact cluster membership is still loading.");
        return active.session.clusterMembers(query, clusterId);
      },
      detail: readDetail,
      dispose: () => active.session.dispose(),
      spatialReady,
      hasGeometry: () => geometryReady,
    };
  } catch (error) {
    controller.abort();
    detach();
    throw error;
  }
}
