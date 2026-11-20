import { z } from "zod";
import { contains, datasetIdSchema, positionSchema, treeSchema } from "./domain.ts";
import type { Dataset, Tree } from "./domain.ts";
import type { InventoryClient } from "./inventory-client.ts";
import type { InventoryQuery, InventoryResult, Summary } from "./index-format.ts";
import { inventoryQuerySchema } from "./inventory-protocol.ts";

const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
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
  .extend({ positionPending: z.never().optional() });
const markerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tree"), tree: summarySchema }),
  z.object({
    kind: z.literal("cluster"),
    id: z.string().min(1),
    position: positionSchema,
    count: countSchema.min(2),
    zoom: z.number().finite().min(0).max(24),
  }),
]);
const envelopeSchema = z.object({
  contractVersion: z.literal("1.0.0"),
  dataset: datasetIdSchema,
  release: z.string().min(1),
  releaseFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  queryKey: z.string().regex(/^[a-f0-9]{64}$/u),
  requestKey: z.string().min(1),
});
const resultSchema = envelopeSchema.extend({
  total: countSchema,
  locatedTotal: countSchema,
  viewportLocatedTotal: countSchema,
  representedLocatedCount: countSchema,
  items: z.array(summarySchema).max(100),
  markers: z.array(markerSchema).max(1000),
  mapAggregated: z.boolean(),
  spatialReady: z.literal(true),
});
const pageSchema = envelopeSchema.extend({
  total: countSchema,
  items: z.array(summarySchema).max(100),
});
const suggestionsSchema = envelopeSchema.extend({ values: z.array(z.string()).max(8) });
const detailSchema = envelopeSchema.extend({ tree: treeSchema.nullable() });
const reservationSchema = z.object({ id: z.string().regex(/^[a-f0-9]{32}-[a-f0-9]{16}$/u) });
const errorSchema = z.object({ error: z.string() });

export interface RemotePage {
  total: number;
  items: Summary[];
}
export interface RemoteInventoryClient extends InventoryClient {
  viewportPage(query: InventoryQuery): Promise<RemotePage>;
  clusterMembers(query: InventoryQuery, clusterId: string | number): Promise<RemotePage>;
}
export interface RemoteInventoryOptions {
  base: string;
  dataset: Dataset;
  releaseFingerprint: string;
  /** The frozen Unicode 17 implementation, not the browser's locale normalizer. */
  normalizeText: (text: string) => string;
}

type Lane = "query" | "suggest" | "detail" | "viewport" | "members";
type Operation = {
  controller: AbortController;
  requestKey: string;
  token: string | null;
  cancelSent: boolean;
  timedOut: boolean;
};
function aborted(): DOMException {
  return new DOMException("This inventory request was replaced or cancelled.", "AbortError");
}
function validateText(value: string): void {
  if (typeof value !== "string" || value.length > 500 || !value.isWellFormed())
    throw new Error("Search text must contain at most 500 valid UTF-16 units.");
}
function validatedQuery(input: InventoryQuery): InventoryQuery {
  const query = inventoryQuerySchema.parse(input);
  validateText(query.q);
  if (!Number.isSafeInteger(query.offset)) throw new Error("Invalid page offset.");
  return query;
}
async function keyFor(
  dataset: Dataset,
  query: InventoryQuery,
  normalize: (text: string) => string,
) {
  const tuple = [
    "tree-atlas-search-release-v1",
    dataset.id,
    dataset.release,
    normalize(query.q),
    query.area,
    query.viewport,
    query.zoom,
    query.offset,
    query.limit,
  ];
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(tuple)),
  );
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function defaultQuery(q = ""): InventoryQuery {
  return { q, area: null, viewport: [-180, -90, 180, 90], zoom: 0, offset: 0, limit: 100 };
}
function pageLength(total: number, query: InventoryQuery): number {
  return Math.min(query.limit, Math.max(0, total - query.offset));
}
function checkItems(items: Summary[], dataset: Dataset): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (
      item.dataset !== dataset.id ||
      ids.has(item.sourceId) ||
      (item.position !== null && !contains(dataset.bounds, item.position))
    )
      throw new Error(
        "The inventory response contains inconsistent record identities or positions.",
      );
    ids.add(item.sourceId);
  }
}
function remoteError(status: number, value: unknown): Error {
  const parsed = errorSchema.safeParse(value);
  const error = parsed.success ? parsed.data.error : "invalid_response";
  if (status === 404 && error === "release_unavailable")
    return new Error(
      "This pinned release is unavailable in the local API. No newer release was substituted.",
    );
  if (status === 503)
    return new Error("The local API is busy or unavailable. Try this query again.");
  if (status === 504)
    return new Error("The local query reached its time limit. Narrow the search and retry.");
  if (status === 409 && error === "cancelled") return aborted();
  return new Error(`The local API rejected this request (${status}: ${error}).`);
}
function waitUnlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    if (signal.aborted) reject(aborted());
    else signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) reject(aborted());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", cancel);
        reject(signal.aborted ? aborted() : error);
      },
    );
  });
}

/** Read-only HTTP adapter; creating it downloads no inventory or geometry index. */
export async function createRemoteInventorySession(
  options: RemoteInventoryOptions,
  signal?: AbortSignal,
): Promise<RemoteInventoryClient> {
  signal?.throwIfAborted();
  const { dataset, releaseFingerprint, normalizeText } = options;
  if (!/^[a-f0-9]{64}$/u.test(releaseFingerprint))
    throw new Error("Missing pinned release fingerprint.");
  const base = new URL(
    options.base.endsWith("/") ? options.base : `${options.base}/`,
    globalThis.location?.href ?? "http://127.0.0.1/",
  );
  const pending = new Set<Operation>();
  const lanes = new Map<Lane, Operation>();
  const latestKeys = new Map<Lane, string>();
  const listeners = new Set<(error: string | null) => void>();
  let disposed = false;
  const endpoint = (path: string) => new URL(path, base);
  async function cancelToken(operation: Operation) {
    if (operation.token === null || operation.cancelSent) return;
    operation.cancelSent = true;
    try {
      await fetch(endpoint("cancel"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: operation.token }),
        signal: AbortSignal.timeout(1500),
        keepalive: true,
      });
    } catch {
      // Explicit cancellation is best effort; the server also bounds abandoned work.
    }
  }
  function cancel(operation: Operation) {
    operation.controller.abort();
    void cancelToken(operation);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", dispose);
    for (const operation of pending) cancel(operation);
    pending.clear();
    lanes.clear();
    latestKeys.clear();
    listeners.clear();
  }
  signal?.addEventListener("abort", dispose, { once: true });
  async function run(
    lane: Lane,
    path: string,
    data: Record<string, unknown>,
    query: InventoryQuery,
  ): Promise<unknown> {
    if (disposed) throw aborted();
    const old = lanes.get(lane);
    if (old) cancel(old);
    if (lane === "query")
      for (const sibling of ["viewport", "members"] as const) {
        const dependent = lanes.get(sibling);
        if (dependent) cancel(dependent);
        latestKeys.delete(sibling);
      }
    const operation: Operation = {
      controller: new AbortController(),
      requestKey: crypto.randomUUID(),
      token: null,
      cancelSent: false,
      timedOut: false,
    };
    lanes.set(lane, operation);
    latestKeys.set(lane, operation.requestKey);
    pending.add(operation);
    const timeout = setTimeout(() => {
      operation.timedOut = true;
      cancel(operation);
    }, 4500);
    try {
      const expectedKey = await keyFor(dataset, query, normalizeText);
      operation.controller.signal.throwIfAborted();
      // Let an issued reservation finish even after supersession, then consume it.
      // A separate timeout prevents a lost reservation response from hanging forever.
      const reservation = fetch(endpoint("attempt"), {
        method: "POST",
        signal: AbortSignal.timeout(4500),
      }).then(async (response) => {
        const value: unknown = await response.json();
        if (!response.ok) throw remoteError(response.status, value);
        operation.token = reservationSchema.parse(value).id;
        if (operation.controller.signal.aborted || disposed) void cancelToken(operation);
        return operation.token;
      });
      const token = await waitUnlessAborted(reservation, operation.controller.signal);
      operation.controller.signal.throwIfAborted();
      const response = await fetch(endpoint(path), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": token },
        body: JSON.stringify({
          ...data,
          contractVersion: "1.0.0",
          dataset: dataset.id,
          release: dataset.release,
          requestKey: operation.requestKey,
        }),
        signal: operation.controller.signal,
      });
      const raw: unknown = await response.json();
      if (!response.ok) throw remoteError(response.status, raw);
      const envelope = envelopeSchema.parse(raw);
      if (
        envelope.dataset !== dataset.id ||
        envelope.release !== dataset.release ||
        envelope.releaseFingerprint !== releaseFingerprint ||
        envelope.queryKey !== expectedKey ||
        envelope.requestKey !== operation.requestKey
      )
        throw new Error("The local API response does not match the pinned release or request.");
      if (disposed || operation.controller.signal.aborted || lanes.get(lane) !== operation)
        throw aborted();
      return raw;
    } catch (error) {
      if (operation.timedOut)
        throw new Error(
          "The local API did not respond within 4.5 seconds. Retry or open a complete offline pack.",
          { cause: error },
        );
      if (operation.controller.signal.aborted || disposed) throw aborted();
      throw error;
    } finally {
      clearTimeout(timeout);
      pending.delete(operation);
      if (lanes.get(lane) === operation) lanes.delete(lane);
    }
  }
  function current(lane: Lane, requestKey: string) {
    if (disposed || latestKeys.get(lane) !== requestKey) throw aborted();
  }
  async function readPage(
    lane: "viewport" | "members",
    path: string,
    input: InventoryQuery,
    extra: Record<string, unknown> = {},
  ): Promise<RemotePage> {
    const query = validatedQuery(input);
    const raw = await run(lane, path, { ...query, ...extra }, query);
    const result = pageSchema.parse(raw);
    current(lane, result.requestKey);
    checkItems(result.items, dataset);
    if (result.items.length !== pageLength(result.total, query))
      throw new Error("The local API returned an incomplete page.");
    return { total: result.total, items: result.items };
  }
  return {
    async query(input) {
      const started = performance.now();
      const query = validatedQuery(input);
      const raw = await run("query", "v1/query", { ...query }, query);
      const result = resultSchema.parse(raw);
      current("query", result.requestKey);
      checkItems(result.items, dataset);
      if (
        result.total > dataset.count ||
        result.locatedTotal > result.total ||
        result.viewportLocatedTotal > result.locatedTotal ||
        result.representedLocatedCount !== result.viewportLocatedTotal ||
        result.items.length !== pageLength(result.total, query)
      )
        throw new Error("The local API returned inconsistent exact counts or an incomplete page.");
      let represented = 0;
      const markers = new Set<string>();
      for (const marker of result.markers) {
        if (marker.kind === "tree") {
          checkItems([marker.tree], dataset);
          if (marker.tree.position === null || !contains(query.viewport, marker.tree.position))
            throw new Error("The local API returned a tree outside the map viewport.");
          const key = `tree:${marker.tree.sourceId}`;
          if (markers.has(key)) throw new Error("Duplicate map identity.");
          markers.add(key);
          represented++;
        } else {
          const [lon, lat] = marker.position;
          if (
            lon < query.viewport[0] - 1e-9 ||
            lon > query.viewport[2] + 1e-9 ||
            lat < query.viewport[1] - 1e-9 ||
            lat > query.viewport[3] + 1e-9
          )
            throw new Error("The local API returned a cluster outside the map viewport.");
          const key = `cluster:${marker.id}`;
          if (markers.has(key)) throw new Error("Duplicate cluster handle.");
          markers.add(key);
          represented += marker.count;
        }
      }
      if (represented !== result.representedLocatedCount)
        throw new Error("The map counts do not reconcile.");
      const value: InventoryResult = {
        total: result.total,
        items: result.items,
        markers: result.markers,
        mapAggregated: result.mapAggregated,
        spatialReady: true,
        elapsedMs: performance.now() - started,
        locatedTotal: result.locatedTotal,
        viewportLocatedTotal: result.viewportLocatedTotal,
        representedLocatedCount: result.representedLocatedCount,
        releaseFingerprint,
        queryKey: result.queryKey,
      };
      return value;
    },
    async suggest(text) {
      validateText(text);
      const result = suggestionsSchema.parse(
        await run("suggest", "v1/suggest", { q: text }, defaultQuery(text)),
      );
      current("suggest", result.requestKey);
      if (new Set(result.values).size !== result.values.length)
        throw new Error("Duplicate suggestions.");
      return result.values;
    },
    async detail(sourceId): Promise<Tree | null> {
      if (typeof sourceId !== "string" || !sourceId.isWellFormed())
        throw new Error("Invalid source identity.");
      const result = detailSchema.parse(
        await run("detail", "v1/detail", { sourceId }, defaultQuery()),
      );
      current("detail", result.requestKey);
      if (
        result.tree !== null &&
        (result.tree.dataset !== dataset.id || result.tree.sourceId !== sourceId)
      )
        throw new Error("The detail response does not match this tree.");
      return result.tree;
    },
    viewportPage: (query) => readPage("viewport", "v1/viewport-page", query),
    clusterMembers: (query, clusterId) => {
      if (typeof clusterId !== "string")
        return Promise.reject(new Error("Invalid API cluster identity."));
      return readPage("members", "v1/cluster-members", query, { clusterId });
    },
    dispose,
    subscribeSpatial(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(null);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
