import { loadInventory } from "./inventory.ts";
import type { InventorySession } from "./inventory.ts";
import { inventoryRequestSchema } from "./inventory-protocol.ts";
import type { InventoryResponse, InventoryRequest } from "./inventory-protocol.ts";
import { readPack, readSavedAsset, readSavedDetail } from "./offline-storage.ts";
let session: InventorySession | null = null;
let initializing = false;
function reply(value: InventoryResponse) {
  globalThis.postMessage(value);
}
async function dispatch(request: InventoryRequest): Promise<void> {
  try {
    if (request.kind === "init") {
      if (initializing || session !== null) throw new Error("The offline city is already open.");
      initializing = true;
      if ((await readPack(request.dataset)) === null)
        throw new Error("Download this pinned city before using it offline.");
      session = await loadInventory(request.base, request.dataset, undefined, {
        readAsset: (url, hash, signal) => {
          const prefix = new URL(request.base);
          if (!url.href.startsWith(prefix.href)) throw new Error("Invalid offline asset path.");
          return readSavedAsset(request.dataset, url.href.slice(prefix.href.length), hash, signal);
        },
        readDetail: (sourceId) => readSavedDetail(request.dataset, sourceId),
      });
      await session.spatialReady;
      if (session.hasGeometry?.() === false)
        throw new Error("The downloaded city is missing exact geometry.");
      reply({ id: request.id, kind: "ready" });
      reply({ id: 0, kind: "spatial", error: null });
      return;
    }
    if (session === null) throw new Error("The downloaded city is not ready.");
    switch (request.kind) {
      case "query":
        reply({ id: request.id, kind: "result", result: session.query(request.query) });
        return;
      case "cluster-members":
        reply({
          id: request.id,
          kind: "members",
          ...session.clusterMembers(request.query, request.clusterId),
        });
        return;
      case "suggest":
        reply({ id: request.id, kind: "suggestions", values: session.suggest(request.text) });
        return;
      case "detail":
        reply({ id: request.id, kind: "record", tree: await session.detail(request.sourceId) });
        return;
    }
  } catch (error) {
    reply({
      id: request.id,
      kind: "error",
      message: error instanceof Error ? error.message : "The downloaded city could not load.",
    });
  }
}
globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  const parsed = inventoryRequestSchema.safeParse(event.data);
  if (parsed.success) void dispatch(parsed.data);
  else if (
    typeof event.data === "object" &&
    event.data !== null &&
    "id" in event.data &&
    typeof event.data.id === "number" &&
    Number.isSafeInteger(event.data.id) &&
    event.data.id >= 0
  )
    reply({ id: event.data.id, kind: "error", message: "Invalid offline inventory request." });
});
