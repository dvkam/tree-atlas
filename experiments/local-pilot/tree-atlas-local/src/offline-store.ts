import { z } from "zod";
import plansData from "./offline-pack-plans.json";
import type { Dataset, Tree } from "./domain.ts";
import { treeSchema } from "./domain.ts";
import {
  OFFLINE_NORMALIZER,
  assetKey,
  detailDigest,
  detailKey,
  offlinePackSchema,
  openOfflineDatabase,
  packAssetSchema,
  packKey,
  readPack,
  readSavedAsset,
  readSavedDetail,
  requestResult,
  sha256,
  transactionDone,
} from "./offline-storage.ts";
import type { OfflinePack, PackAsset } from "./offline-storage.ts";

const plans = z
  .array(
    z.object({
      dataset: z.string(),
      release: z.string(),
      descriptorSha256: z.string(),
      bytes: z.number().int().positive(),
      assets: z.array(packAssetSchema).min(2),
    }),
  )
  .parse(plansData);
export type OfflinePackPlan = { bytes: number; assets: PackAsset[] };
export type OfflinePackStatus = {
  state: "absent" | "ready" | "incomplete";
  bytes: number;
  message: string;
  pack?: OfflinePack;
};
export type OfflineProgress = {
  stage: "downloading" | "checking" | "saving";
  bytes: number;
  total: number;
};
type Downloaded = { file: string; sha256: string; bytes: ArrayBuffer };
function dataBase(): string {
  return new URL(
    "data/",
    typeof document === "undefined" ? new URL("/", globalThis.location.href) : document.baseURI,
  ).href;
}
export function offlinePlan(dataset: Dataset): OfflinePackPlan {
  const plan = plans.find(
    (item) =>
      item.dataset === dataset.id &&
      item.release === dataset.release &&
      item.descriptorSha256 === dataset.sha256,
  );
  if (plan === undefined)
    throw new Error("No complete offline package is available for this pinned release.");
  if (
    plan.bytes !== plan.assets.reduce((sum, asset) => sum + asset.bytes, 0) ||
    plan.assets[0]?.file !== dataset.file ||
    plan.assets[0].sha256 !== dataset.sha256
  )
    throw new Error("Offline package metadata is inconsistent.");
  return { bytes: plan.bytes, assets: plan.assets };
}
async function validateDownloaded(
  dataset: Dataset,
  base: string,
  assets: Downloaded[],
  signal: AbortSignal,
): Promise<Downloaded[]> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./offline-validation.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    function finish() {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    }
    function abort() {
      finish();
      reject(signal.reason ?? new DOMException("Offline download cancelled.", "AbortError"));
    }
    signal.addEventListener("abort", abort, { once: true });
    worker.addEventListener("error", () => {
      finish();
      reject(new Error("The complete offline index could not be checked."));
    });
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const parsed = z
        .discriminatedUnion("ok", [
          z.object({
            ok: z.literal(true),
            assets: z.array(
              z.object({ file: z.string(), sha256: z.string(), bytes: z.instanceof(ArrayBuffer) }),
            ),
          }),
          z.object({ ok: z.literal(false), error: z.string() }),
        ])
        .safeParse(event.data);
      finish();
      if (!parsed.success) reject(new Error("Invalid offline index validation response."));
      else if (!parsed.data.ok) reject(new Error(parsed.data.error));
      else resolve(parsed.data.assets);
    });
    try {
      worker.postMessage(
        { dataset, base, assets },
        assets.map((asset) => asset.bytes),
      );
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
export class OfflinePackStore {
  plan(dataset: Dataset): OfflinePackPlan {
    return offlinePlan(dataset);
  }
  async install(
    dataset: Dataset,
    signal = new AbortController().signal,
    progress?: (value: OfflineProgress) => void,
    base = dataBase(),
  ): Promise<OfflinePack> {
    signal.throwIfAborted();
    const plan = offlinePlan(dataset);
    // The frozen plan is authoritative. A damaged local copy must remain repairable;
    // its replacement still becomes visible only after the complete atomic commit.
    const estimate = await navigator.storage?.estimate();
    if (
      estimate?.quota !== undefined &&
      estimate.usage !== undefined &&
      estimate.quota - estimate.usage < plan.bytes
    )
      throw new DOMException(
        "There is not enough space for the complete city. No partial package was activated.",
        "QuotaExceededError",
      );
    const downloaded: Downloaded[] = [];
    let done = 0;
    for (const asset of plan.assets) {
      signal.throwIfAborted();
      const response = await fetch(new URL(asset.file, base), { signal, cache: "no-store" });
      if (!response.ok)
        throw new Error(`The offline package download failed (${response.status}).`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== asset.bytes || (await sha256(bytes)) !== asset.sha256)
        throw new Error(
          "Offline package integrity check failed. The previous package was retained.",
        );
      downloaded.push({ file: asset.file, sha256: asset.sha256, bytes });
      done += bytes.byteLength;
      progress?.({ stage: "downloading", bytes: done, total: plan.bytes });
    }
    progress?.({ stage: "checking", bytes: done, total: plan.bytes });
    const verified = await validateDownloaded(dataset, base, downloaded, signal);
    signal.throwIfAborted();
    if (verified.length !== plan.assets.length)
      throw new Error("The complete offline asset set was not returned.");
    for (const [index, value] of verified.entries()) {
      const expected = plan.assets[index];
      if (
        expected === undefined ||
        value.file !== expected.file ||
        value.sha256 !== expected.sha256 ||
        value.bytes.byteLength !== expected.bytes ||
        (await sha256(value.bytes)) !== expected.sha256
      )
        throw new Error("Checked offline bytes do not match the package plan.");
    }
    const pack = offlinePackSchema.parse({
      key: packKey(dataset),
      schemaVersion: 1,
      normalizer: OFFLINE_NORMALIZER,
      dataset,
      assets: plan.assets,
      bytes: plan.bytes,
      installedAt: new Date().toISOString(),
    });
    const db = await openOfflineDatabase();
    signal.throwIfAborted();
    progress?.({ stage: "saving", bytes: done, total: plan.bytes });
    signal.throwIfAborted();
    const transaction = db.transaction(["packs", "assets"], "readwrite");
    const committed = transactionDone(transaction);
    const abort = () => {
      try {
        transaction.abort();
      } catch {
        /* The atomic commit may already have completed. */
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) {
        abort();
        await committed;
        signal.throwIfAborted();
      }
      for (const asset of verified)
        transaction
          .objectStore("assets")
          .put({ ...asset, key: assetKey(dataset, asset.file), packKey: packKey(dataset) });
      transaction.objectStore("packs").put(pack);
      await committed;
    } catch (error) {
      abort();
      await committed.catch(() => undefined);
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
    return pack;
  }
  async getStatus(dataset: Dataset): Promise<OfflinePackStatus> {
    try {
      const pack = await readPack(dataset);
      if (pack === null)
        return {
          state: "absent",
          bytes: offlinePlan(dataset).bytes,
          message: "This city has not been downloaded.",
        };
      const plan = offlinePlan(dataset);
      if (JSON.stringify(pack.assets) !== JSON.stringify(plan.assets) || pack.bytes !== plan.bytes)
        throw new Error("The downloaded city does not match its complete package plan.");
      for (const asset of plan.assets) {
        const bytes = await readSavedAsset(
          dataset,
          asset.file,
          asset.sha256,
          new AbortController().signal,
        );
        if (bytes.byteLength !== asset.bytes)
          throw new Error("A required offline asset is incomplete.");
      }
      return { state: "ready", bytes: pack.bytes, message: "Offline pack ready", pack };
    } catch (error) {
      return {
        state: "incomplete",
        bytes: 0,
        message: error instanceof Error ? error.message : "Offline package storage is unavailable.",
      };
    }
  }
  async list(): Promise<OfflinePack[]> {
    const db = await openOfflineDatabase();
    const values = await requestResult<unknown[]>(
      db.transaction("packs").objectStore("packs").getAll(),
    );
    return values.map((value) => offlinePackSchema.parse(value));
  }
  async remove(dataset: Dataset): Promise<void> {
    const db = await openOfflineDatabase();
    const transaction = db.transaction(["packs", "assets"], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore("packs").delete(packKey(dataset));
    const cursor = transaction
      .objectStore("assets")
      .index("packKey")
      .openCursor(IDBKeyRange.only(packKey(dataset)));
    cursor.onsuccess = () => {
      const value = cursor.result;
      if (value !== null) {
        value.delete();
        value.continue();
      }
    };
    await done;
  }
  openAsset(
    dataset: Dataset,
    url: URL,
    expectedHash: string,
    signal: AbortSignal,
    base = dataBase(),
  ): Promise<ArrayBuffer> {
    const asset = offlinePlan(dataset).assets.find(
      (item) => new URL(item.file, base).href === url.href && item.sha256 === expectedHash,
    );
    if (asset === undefined)
      return Promise.reject(new Error("This asset is not part of the pinned offline city."));
    return readSavedAsset(dataset, asset.file, expectedHash, signal);
  }
  async saveDetail(dataset: Dataset, input: Tree): Promise<void> {
    const tree = treeSchema.parse(input);
    if (tree.dataset !== dataset.id) throw new Error("The detail belongs to another city.");
    const contentSha256 = await detailDigest(tree);
    const db = await openOfflineDatabase();
    const transaction = db.transaction("details", "readwrite");
    const done = transactionDone(transaction);
    const key = detailKey(dataset, tree.sourceId);
    const details = transaction.objectStore("details");
    const previous = await requestResult<unknown>(details.get(key));
    if (previous !== undefined) {
      const parsed = z
        .object({ contentSha256: z.string(), descriptorSha256: z.string() })
        .safeParse(previous);
      if (
        parsed.success &&
        (parsed.data.contentSha256 !== contentSha256 ||
          parsed.data.descriptorSha256 !== dataset.sha256)
      ) {
        transaction.abort();
        await done.catch(() => undefined);
        throw new Error("Saved details conflict with this immutable release.");
      }
    }
    details.put({
      key,
      packKey: packKey(dataset),
      descriptorSha256: dataset.sha256,
      contentSha256,
      tree,
    });
    await done;
  }
  getDetail(dataset: Dataset, sourceId: string): Promise<Tree | null> {
    return readSavedDetail(dataset, sourceId);
  }
}
export const offlineStore = new OfflinePackStore();
