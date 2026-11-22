import { z } from "zod";
import { datasetSchema } from "./domain.ts";
import { loadInventory } from "./inventory.ts";
import { sha256 } from "./offline-storage.ts";
const message = z.object({
  dataset: datasetSchema,
  base: z.url(),
  assets: z.array(
    z.object({ file: z.string(), sha256: z.string(), bytes: z.instanceof(ArrayBuffer) }),
  ),
});
globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  void (async () => {
    try {
      const input = message.parse(event.data);
      const controller = new AbortController();
      const session = await loadInventory(input.base, input.dataset, controller.signal, {
        readAsset: async (url, hash, signal) => {
          signal.throwIfAborted();
          const asset = input.assets.find(
            (value) => new URL(value.file, input.base).href === url.href && value.sha256 === hash,
          );
          if (asset === undefined || (await sha256(asset.bytes)) !== hash)
            throw new Error("The offline asset set is incomplete or corrupt.");
          return asset.bytes;
        },
        readDetail: () =>
          Promise.reject(new Error("Installation does not download full detail shards.")),
      });
      await session.spatialReady;
      if (session.hasGeometry?.() === false)
        throw new Error("The offline city has incomplete geometry.");
      session.dispose();
      globalThis.postMessage(
        { ok: true, assets: input.assets },
        { transfer: input.assets.map((asset) => asset.bytes) },
      );
    } catch (error) {
      globalThis.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : "The offline city could not be checked.",
      });
    }
  })();
});
