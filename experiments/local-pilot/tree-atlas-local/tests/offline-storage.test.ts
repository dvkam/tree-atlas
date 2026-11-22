import { indexedDB, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { datasetSchema, treeSchema } from "../src/domain.ts";
import { OfflinePackStore, offlinePlan } from "../src/offline-store.ts";
import {
  assetKey,
  detailKey,
  openOfflineDatabase,
  packKey,
  requestResult,
  transactionDone,
} from "../src/offline-storage.ts";

const datasets = z
  .object({ datasets: z.array(datasetSchema) })
  .parse(
    JSON.parse(
      readFileSync(
        new URL("../../tree-atlas-contract-v1/baseline.lock.json", import.meta.url),
        "utf8",
      ),
    ),
  ).datasets;
const porto = datasets.find((dataset) => dataset.id === "porto");
if (porto === undefined) throw new Error("Missing frozen Porto release");
const dataset = porto;
const base = "http://localhost/data/";
const store = new OfflinePackStore();
const tree = treeSchema.parse({
  dataset: "porto",
  sourceId: "saved-null-fields",
  idScope: "stable",
  position: null,
  tag: null,
  scientificName: null,
  commonName: null,
  location: null,
  height: { kind: "unknown" },
  crown: { kind: "unknown" },
  circumference: { kind: "unknown" },
  plantingYear: null,
  plantingEstimated: false,
  age: null,
  observedAt: null,
  status: "unknown",
});

// The actual parser worker is covered by the browser checks. Storage tests substitute
// only its transfer boundary; IndexedDB transactions and rollback use fake-indexeddb.
class ValidationWorker extends EventTarget {
  postMessage(message: { assets: unknown[] }) {
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent("message", { data: { ok: true, assets: message.assets } }),
      ),
    );
  }
  terminate() {
    /* No operating-system worker exists in this storage test. */
  }
}
async function clearStorage() {
  const db = await openOfflineDatabase();
  const transaction = db.transaction(["packs", "assets", "details"], "readwrite");
  const done = transactionDone(transaction);
  for (const name of ["packs", "assets", "details"]) transaction.objectStore(name).clear();
  await done;
}
async function mutate(storeName: string, key: string, update: (value: unknown) => unknown) {
  const db = await openOfflineDatabase();
  const transaction = db.transaction(storeName, "readwrite");
  const done = transactionDone(transaction);
  const objectStore = transaction.objectStore(storeName);
  const value = await requestResult<unknown>(objectStore.get(key));
  const updated = update(value);
  if (updated === undefined) objectStore.delete(key);
  else objectStore.put(updated);
  await done;
}
beforeEach(async () => {
  vi.stubGlobal("indexedDB", indexedDB);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("Worker", ValidationWorker);
  vi.stubGlobal("navigator", {
    storage: { estimate: () => Promise.resolve({ quota: 100_000_000, usage: 0 }) },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: URL) => {
      const relative = input.href.slice(base.length);
      const bytes = readFileSync(
        new URL(`../../tree-atlas/public/data/${relative}`, import.meta.url),
      );
      return Promise.resolve(new Response(bytes));
    }),
  );
  await clearStorage();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("atomic offline packages and saved details", () => {
  it("activates only a complete pack and detects evicted required bytes", async () => {
    await store.install(dataset, undefined, undefined, base);
    expect((await store.getStatus(dataset)).state).toBe("ready");
    const asset = offlinePlan(dataset).assets[1];
    if (asset === undefined) throw new Error("Missing index asset");
    await mutate("assets", assetKey(dataset, asset.file), () => undefined);
    expect((await store.getStatus(dataset)).state).toBe("incomplete");
  });
  it("honours cancellation from the last saving callback without replacing the prior pack", async () => {
    const original = await store.install(dataset, undefined, undefined, base);
    const controller = new AbortController();
    await expect(
      store.install(
        dataset,
        controller.signal,
        (progress) => {
          if (progress.stage === "saving") controller.abort();
        },
        base,
      ),
    ).rejects.toThrow("aborted");
    expect((await store.getStatus(dataset)).pack?.installedAt).toBe(original.installedAt);
  });
  it("rolls back queued asset writes when quota fails during the write transaction", async () => {
    const original = await store.install(dataset, undefined, undefined, base);
    // oxlint-disable-next-line typescript/unbound-method -- Deliberately retain the original method and call it with each transaction's object store below.
    const originalPut = IDBObjectStore.prototype.put;
    let writes = 0;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "assets" && ++writes === 2)
        throw new DOMException("Injected quota exhaustion", "QuotaExceededError");
      return originalPut.call(this, value, key);
    });
    await expect(store.install(dataset, undefined, undefined, base)).rejects.toThrow(
      "quota exhaustion",
    );
    expect((await store.getStatus(dataset)).pack?.installedAt).toBe(original.installedAt);
    expect((await store.getStatus(dataset)).state).toBe("ready");
  });
  it("does not publish metadata when the first pack transaction fails", async () => {
    // oxlint-disable-next-line typescript/unbound-method -- Deliberately retain the original method and call it with each transaction's object store below.
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "packs")
        throw new DOMException("Injected quota exhaustion", "QuotaExceededError");
      return originalPut.call(this, value, key);
    });
    await expect(store.install(dataset, undefined, undefined, base)).rejects.toThrow(
      "quota exhaustion",
    );
    expect((await store.getStatus(dataset)).state).toBe("absent");
    const db = await openOfflineDatabase();
    expect(await requestResult(db.transaction("assets").objectStore("assets").count())).toBe(0);
  });
  it("rejects mixed release metadata and changed asset bytes", async () => {
    await store.install(dataset, undefined, undefined, base);
    await mutate("packs", packKey(dataset), (value) => ({
      ...z.record(z.string(), z.unknown()).parse(value),
      dataset: { ...dataset, release: "other-release" },
    }));
    expect((await store.getStatus(dataset)).state).toBe("incomplete");
    await store.install(dataset, undefined, undefined, base);
    expect((await store.getStatus(dataset)).state).toBe("ready");
    const asset = offlinePlan(dataset).assets[1];
    if (asset === undefined) throw new Error("Missing index asset");
    await mutate("assets", assetKey(dataset, asset.file), (value) => ({
      ...z.record(z.string(), z.unknown()).parse(value),
      bytes: new ArrayBuffer(asset.bytes),
    }));
    expect((await store.getStatus(dataset)).state).toBe("incomplete");
    await store.install(dataset, undefined, undefined, base);
    expect((await store.getStatus(dataset)).state).toBe("ready");
  });
  it("keeps null source fields, isolates saved details by release, and detects corruption", async () => {
    await expect(store.getDetail(dataset, "unsaved")).rejects.toThrow("not saved for offline");
    await store.saveDetail(dataset, tree);
    expect(await store.getDetail(dataset, tree.sourceId)).toEqual(tree);
    await expect(
      store.getDetail({ ...dataset, release: "other-release" }, tree.sourceId),
    ).rejects.toThrow("not saved for offline");
    await expect(store.saveDetail(dataset, { ...tree, location: "changed" })).rejects.toThrow(
      "immutable release",
    );
    await mutate("details", detailKey(dataset, tree.sourceId), (value) => ({
      ...z.record(z.string(), z.unknown()).parse(value),
      tree: { ...tree, location: "tampered" },
    }));
    await expect(store.getDetail(dataset, tree.sourceId)).rejects.toThrow("not saved for offline");
  });
  it("removes a city package without deleting explicitly saved details", async () => {
    await store.install(dataset, undefined, undefined, base);
    await store.saveDetail(dataset, tree);
    await store.remove(dataset);
    expect((await store.getStatus(dataset)).state).toBe("absent");
    expect(await store.getDetail(dataset, tree.sourceId)).toEqual(tree);
  });
});
