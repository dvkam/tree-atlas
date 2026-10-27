import type { Dataset, Tree } from "./domain.ts";
import type { InventoryQuery, InventoryResult } from "./index-format.ts";
import { inventoryResponseSchema } from "./inventory-protocol.ts";
import type { InventoryRequest, InventoryResponse } from "./inventory-protocol.ts";

export interface InventoryClient {
  query(query: InventoryQuery): Promise<InventoryResult>;
  suggest(text: string): Promise<string[]>;
  detail(sourceId: string): Promise<Tree | null>;
  dispose(): void;
  subscribeSpatial(listener: (error: string | null) => void): () => void;
}

/** Each active city owns one worker; disposing it releases the index and cancels pending requests. */
export async function createInventorySession(
  base: string,
  dataset: Dataset,
  signal?: AbortSignal,
): Promise<InventoryClient> {
  signal?.throwIfAborted();
  const worker = new Worker(new URL("./inventory.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<
    number,
    { resolve: (response: InventoryResponse) => void; reject: (reason: Error) => void }
  >();
  let nextId = 0;
  let disposed = false;
  const spatialListeners = new Set<(error: string | null) => void>();
  let spatialStatus: { error: string | null } | undefined;
  function dispose(reason: Error = new DOMException("Inventory session disposed", "AbortError")) {
    if (disposed) return;
    disposed = true;
    worker.terminate();
    signal?.removeEventListener("abort", abort);
    for (const waiter of pending.values()) waiter.reject(reason);
    pending.clear();
    spatialListeners.clear();
  }
  const abort = () => dispose();
  signal?.addEventListener("abort", abort, { once: true });
  worker.addEventListener("error", () =>
    dispose(new Error("Inventory worker failed. Reload this city to try again.")),
  );
  worker.addEventListener("messageerror", () =>
    dispose(new Error("Inventory worker response could not be read.")),
  );
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const parsed = inventoryResponseSchema.safeParse(event.data);
    if (!parsed.success) {
      dispose(new Error("Invalid inventory worker response."));
      return;
    }
    const response = parsed.data;
    if (response.kind === "spatial") {
      spatialStatus = { error: response.error };
      for (const listener of spatialListeners) listener(response.error);
      return;
    }
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.kind === "error") waiter.reject(new Error(response.message));
    else waiter.resolve(response);
  });
  function call(request: InventoryRequest): Promise<InventoryResponse> {
    if (disposed)
      return Promise.reject(new DOMException("Inventory session disposed", "AbortError"));
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
    const ready = await call({ id: nextId++, kind: "init", base, dataset });
    if (ready.kind !== "ready") throw new Error("Inventory worker did not initialize.");
    return {
      subscribeSpatial(listener) {
        spatialListeners.add(listener);
        if (spatialStatus !== undefined) listener(spatialStatus.error);
        return () => {
          spatialListeners.delete(listener);
        };
      },
      async query(query) {
        const response = await call({ id: nextId++, kind: "query", query });
        if (response.kind !== "result") throw new Error("Unexpected inventory result.");
        return response.result;
      },
      async suggest(text) {
        const response = await call({ id: nextId++, kind: "suggest", text });
        if (response.kind !== "suggestions") throw new Error("Unexpected suggestions result.");
        return response.values;
      },
      async detail(sourceId) {
        const response = await call({ id: nextId++, kind: "detail", sourceId });
        if (response.kind !== "record") throw new Error("Unexpected detail result.");
        return response.tree;
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
