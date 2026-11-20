import { z } from "zod";
import { datasetSchema, treeSchema } from "./domain.ts";
import type { Dataset, Tree } from "./domain.ts";

export const OFFLINE_DATABASE = "tree-atlas-local-pinned-v1";
export const OFFLINE_NORMALIZER = "nfd-diacritic-unicode17-default-lower-trim-v1";
export const packAssetSchema = z.object({
  file: z.string().regex(/^releases\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.(json|bin)$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.number().int().positive(),
});
export type PackAsset = z.infer<typeof packAssetSchema>;
export const offlinePackSchema = z.object({
  key: z.string(),
  schemaVersion: z.literal(1),
  normalizer: z.literal(OFFLINE_NORMALIZER),
  dataset: datasetSchema,
  assets: z.array(packAssetSchema).min(2),
  bytes: z.number().int().positive(),
  installedAt: z.string(),
});
export type OfflinePack = z.infer<typeof offlinePackSchema>;
const savedAssetSchema = z.object({
  key: z.string(),
  packKey: z.string(),
  file: z.string(),
  sha256: z.string(),
  bytes: z.instanceof(ArrayBuffer),
});
const savedDetailSchema = z.object({
  key: z.string(),
  packKey: z.string(),
  descriptorSha256: z.string(),
  contentSha256: z.string(),
  tree: treeSchema,
});
export class OfflineDetailUnavailableError extends Error {
  constructor() {
    super("These details were not saved for offline use.");
    this.name = "OfflineDetailUnavailableError";
  }
}
export function packKey(dataset: Dataset): string {
  return `${dataset.id}:${dataset.release}`;
}
export function assetKey(dataset: Dataset, file: string): string {
  return `${packKey(dataset)}|${file}`;
}
export function detailKey(dataset: Dataset, sourceId: string): string {
  return `${packKey(dataset)}|${sourceId}`;
}
export function stableJson(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)]),
      );
    }
    return input;
  }
  return JSON.stringify(canonical(value));
}
export function detailDigest(tree: Tree): Promise<string> {
  return sha256(new TextEncoder().encode(stableJson(tree)).buffer);
}
let database: Promise<IDBDatabase> | null = null;
export function openOfflineDatabase(): Promise<IDBDatabase> {
  if (database !== null) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("packs", { keyPath: "key" });
      const assets = db.createObjectStore("assets", { keyPath: "key" });
      assets.createIndex("packKey", "packKey");
      const details = db.createObjectStore("details", { keyPath: "key" });
      details.createIndex("packKey", "packKey");
    };
    request.onerror = () => {
      database = null;
      reject(request.error ?? new Error("Offline storage is unavailable."));
    };
    request.onblocked = () => {
      blocked = true;
      database = null;
      reject(new Error("Close other local atlas tabs to update offline storage."));
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => {
        request.result.close();
        database = null;
      };
      resolve(request.result);
    };
  });
  return database;
}
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage request failed."));
  });
}
export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException("Offline write was cancelled.", "AbortError"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Offline storage write failed."));
  });
}
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function readPack(dataset: Dataset): Promise<OfflinePack | null> {
  const db = await openOfflineDatabase();
  const value = await requestResult<unknown>(
    db.transaction("packs").objectStore("packs").get(packKey(dataset)),
  );
  if (value === undefined) return null;
  const pack = offlinePackSchema.parse(value);
  if (pack.key !== packKey(dataset) || stableJson(pack.dataset) !== stableJson(dataset))
    throw new Error("The downloaded city belongs to another release.");
  return pack;
}
export async function readSavedAsset(
  dataset: Dataset,
  file: string,
  expectedHash: string,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const db = await openOfflineDatabase();
  const value = await requestResult<unknown>(
    db.transaction("assets").objectStore("assets").get(assetKey(dataset, file)),
  );
  const parsed = savedAssetSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.packKey !== packKey(dataset) ||
    parsed.data.file !== file ||
    parsed.data.sha256 !== expectedHash ||
    (await sha256(parsed.data.bytes)) !== expectedHash
  )
    throw new Error("The downloaded city is incomplete or damaged. Download it again when online.");
  signal.throwIfAborted();
  return parsed.data.bytes;
}
export async function readSavedDetail(dataset: Dataset, sourceId: string): Promise<Tree | null> {
  const db = await openOfflineDatabase();
  const value = await requestResult<unknown>(
    db.transaction("details").objectStore("details").get(detailKey(dataset, sourceId)),
  );
  const parsed = savedDetailSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.packKey !== packKey(dataset) ||
    parsed.data.descriptorSha256 !== dataset.sha256 ||
    parsed.data.tree.dataset !== dataset.id ||
    parsed.data.tree.sourceId !== sourceId ||
    (await detailDigest(parsed.data.tree)) !== parsed.data.contentSha256
  )
    throw new OfflineDetailUnavailableError();
  return parsed.data.tree;
}
