import type { Dataset, Tree } from "./domain.ts";
import type { InventoryQuery, InventoryResult, Summary } from "./index-format.ts";
import type { InventoryClient } from "./inventory-client.ts";
import type { InventoryRequest, InventoryResponse } from "./inventory-protocol.ts";
import { inventoryResponseSchema } from "./inventory-protocol.ts";
import { offlineStore } from "./offline-store.ts";

export interface OfflineInventoryClient extends InventoryClient {
  clusterMembers(
    query: InventoryQuery,
    clusterId: string | number,
  ): Promise<{ total: number; items: Summary[] }>;
}
export async function createOfflineInventorySession(
  base: string,
  dataset: Dataset,
  signal?: AbortSignal,
): Promise<OfflineInventoryClient> {
  signal?.throwIfAborted();
  const status = await offlineStore.getStatus(dataset);
  signal?.throwIfAborted();
  if (status.state !== "ready") throw new Error(status.message);
  const worker = new Worker(new URL("./offline.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<
    number,
    { resolve: (response: InventoryResponse) => void; reject: (reason: Error) => void }
  >();
  const listeners = new Set<(error: string | null) => void>();
  let id = 0;
  let disposed = false;
  function dispose(reason: Error = new DOMException("Offline city closed", "AbortError")) {
    if (disposed) return;
    disposed = true;
    worker.terminate();
    signal?.removeEventListener("abort", abort);
    for (const waiter of pending.values()) waiter.reject(reason);
    pending.clear();
    listeners.clear();
  }
  const abort = () => dispose();
  signal?.addEventListener("abort", abort, { once: true });
  worker.addEventListener("error", () => dispose(new Error("The offline city worker failed.")));
  worker.addEventListener("messageerror", () =>
    dispose(new Error("The offline city response could not be read.")),
  );
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const parsed = inventoryResponseSchema.safeParse(event.data);
    if (!parsed.success) {
      dispose(new Error("Invalid offline inventory response."));
      return;
    }
    if (parsed.data.kind === "spatial") {
      for (const listener of listeners) listener(parsed.data.error);
      return;
    }
    const waiter = pending.get(parsed.data.id);
    if (waiter === undefined) return;
    pending.delete(parsed.data.id);
    if (parsed.data.kind === "error") waiter.reject(new Error(parsed.data.message));
    else waiter.resolve(parsed.data);
  });
  function call(request: InventoryRequest): Promise<InventoryResponse> {
    if (disposed) return Promise.reject(new DOMException("Offline city closed", "AbortError"));
    return new Promise((resolve, reject) => {
      pending.set(request.id, { resolve, reject });
      try {
        worker.postMessage(request);
      } catch (error) {
        pending.delete(request.id);
        reject(error);
      }
    });
  }
  try {
    if ((await call({ id: id++, kind: "init", base, dataset })).kind !== "ready")
      throw new Error("The downloaded city did not initialize.");
    return {
      subscribeSpatial(listener) {
        listeners.add(listener);
        listener(null);
        return () => {
          listeners.delete(listener);
        };
      },
      async query(query: InventoryQuery): Promise<InventoryResult> {
        const response = await call({ id: id++, kind: "query", query });
        if (response.kind !== "result") throw new Error("Invalid offline query result.");
        return response.result;
      },
      async suggest(text: string): Promise<string[]> {
        const response = await call({ id: id++, kind: "suggest", text });
        if (response.kind !== "suggestions") throw new Error("Invalid offline suggestions.");
        return response.values;
      },
      async detail(sourceId: string): Promise<Tree | null> {
        const response = await call({ id: id++, kind: "detail", sourceId });
        if (response.kind !== "record") throw new Error("Invalid offline detail response.");
        return response.tree;
      },
      async clusterMembers(query, clusterId) {
        if (typeof clusterId !== "number") throw new Error("Invalid offline cluster identifier.");
        const response = await call({ id: id++, kind: "cluster-members", query, clusterId });
        if (response.kind !== "members") throw new Error("Invalid offline cluster response.");
        return { total: response.total, items: response.items };
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
