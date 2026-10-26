import { loadInventory } from "./inventory.ts";
import type { InventorySession } from "./inventory.ts";
import { inventoryRequestSchema } from "./inventory-protocol.ts";
import type { InventoryResponse, InventoryRequest } from "./inventory-protocol.ts";

let session: InventorySession | null = null;
let initializing = false;
function reply(response: InventoryResponse) {
  globalThis.postMessage(response);
}
async function dispatch(request: InventoryRequest): Promise<void> {
  try {
    if (request.kind === "init") {
      if (initializing || session !== null)
        throw new Error("Inventory session already initialized.");
      initializing = true;
      session = await loadInventory(request.base, request.dataset);
      reply({ id: request.id, kind: "ready" });
      return;
    }
    if (session === null) throw new Error("Inventory session is not ready.");
    switch (request.kind) {
      case "query":
        reply({ id: request.id, kind: "result", result: session.query(request.query) });
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
      message: error instanceof Error ? error.message : "Inventory request failed.",
    });
  }
}
globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = inventoryRequestSchema.safeParse(event.data);
  if (request.success) {
    void dispatch(request.data);
    return;
  }
  if (
    typeof event.data === "object" &&
    event.data !== null &&
    "id" in event.data &&
    typeof event.data.id === "number" &&
    Number.isSafeInteger(event.data.id) &&
    event.data.id >= 0
  ) {
    reply({ id: event.data.id, kind: "error", message: "Invalid inventory request." });
  }
});
