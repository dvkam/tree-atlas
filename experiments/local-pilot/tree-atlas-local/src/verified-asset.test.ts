import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readVerifiedAsset, waitForAssetCache } from "./verified-asset.ts";

const url = new URL("https://assets.test/releases/example/index.bin");
const bytes = new TextEncoder().encode("immutable source index");
const hash = createHash("sha256").update(bytes).digest("hex");
const signal = () => new AbortController().signal;
function storage() {
  const saved = new Map<string, Response>();
  const cache = {
    match: async (key: string | Request) =>
      saved.get(typeof key === "string" ? key : key.url)?.clone(),
    delete: async (key: string | Request) => saved.delete(typeof key === "string" ? key : key.url),
    put: async (key: string, value: Response) => {
      saved.set(key, value.clone());
    },
    keys: async () => [...saved.keys()].map((key) => new Request(key)),
  };
  vi.stubGlobal("caches", { open: async () => cache });
  return saved;
}
afterEach(async () => {
  await waitForAssetCache();
  vi.unstubAllGlobals();
});
describe("verified immutable asset storage", () => {
  it("reuses bytes across sessions and separates changed expected hashes", async () => {
    const saved = storage();
    const writes = vi.spyOn(saved, "set");
    const fetcher = vi.fn<() => Promise<Response>>(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    expect(new Uint8Array(await readVerifiedAsset(url, hash, signal()))).toEqual(bytes);
    await waitForAssetCache();
    expect(new Uint8Array(await readVerifiedAsset(url, hash, signal()))).toEqual(bytes);
    await waitForAssetCache();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledTimes(1);
    await expect(readVerifiedAsset(url, "0".repeat(64), signal())).rejects.toThrow("integrity");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("repairs corrupted cached bytes through a verified network request", async () => {
    const saved = storage();
    const fetcher = vi.fn<() => Promise<Response>>(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    await readVerifiedAsset(url, hash, signal());
    await waitForAssetCache();
    for (const key of saved.keys()) saved.set(key, new Response("corrupted"));
    expect(new Uint8Array(await readVerifiedAsset(url, hash, signal()))).toEqual(bytes);
    await waitForAssetCache();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("continues online when storage is denied and never caches invalid downloads", async () => {
    vi.stubGlobal("caches", {
      open: async () => {
        throw new Error("storage denied");
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<() => Promise<Response>>(async () => new Response(bytes)),
    );
    expect(new Uint8Array(await readVerifiedAsset(url, hash, signal()))).toEqual(bytes);
    await waitForAssetCache();
    const saved = storage();
    await expect(readVerifiedAsset(url, "0".repeat(64), signal())).rejects.toThrow("integrity");
    expect(saved.size).toBe(0);
  });
  it("bounds retained bytes and entries while retaining the newest fetched assets", async () => {
    const saved = storage();
    const large = new Uint8Array(7 * 1024 * 1024);
    const largeHash = createHash("sha256").update(large).digest("hex");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(large)),
    );
    for (let i = 0; i < 6; i++) {
      await readVerifiedAsset(new URL(`${url.href}?asset=${i}`), largeHash, signal());
      await waitForAssetCache();
    }
    expect(saved.size).toBe(4);
    expect([...saved.keys()].some((key) => key.includes("asset=0"))).toBe(false);
    expect(
      [...saved.values()].reduce(
        (sum, entry) => sum + Number(entry.headers.get("Content-Length")),
        0,
      ),
    ).toBeLessThanOrEqual(32 * 1024 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn<() => Promise<Response>>(async () => new Response(bytes)),
    );
    for (let i = 0; i < 20; i++) {
      await readVerifiedAsset(new URL(`${url.href}?small=${i}`), hash, signal());
      await waitForAssetCache();
    }
    expect(saved.size).toBe(18);
  });
  it("does not start a request after a city switch has cancelled loading", async () => {
    storage();
    const fetcher = vi.fn<() => Promise<Response>>();
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(readVerifiedAsset(url, hash, controller.signal)).rejects.toThrow(/abort/iu);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("returns verified bytes before slow storage and bounds queued writes", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const put = vi.fn<() => Promise<void>>(async () => {
    await gate;
  });
  vi.stubGlobal("caches", {
    open: async () => ({
      match: async () => undefined,
      delete: async () => false,
      put,
      keys: async () => [],
    }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
  try {
    for (let i = 0; i < 8; i++) {
      const loaded = await readVerifiedAsset(new URL(`${url.href}?queued=${i}`), hash, signal());
      expect(new Uint8Array(loaded)).toEqual(bytes);
    }
    expect(put).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await waitForAssetCache();
  }
  expect(put).toHaveBeenCalledTimes(3);
});

it("limits pending buffer bytes and drops cancelled queued writes", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const put = vi.fn<() => Promise<void>>(async () => {
    await gate;
  });
  vi.stubGlobal("caches", {
    open: async () => ({
      match: async () => undefined,
      delete: async () => false,
      put,
      keys: async () => [],
    }),
  });
  const large = new Uint8Array(7 * 1024 * 1024);
  const largeHash = createHash("sha256").update(large).digest("hex");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(large)),
  );
  const controller = new AbortController();
  try {
    await readVerifiedAsset(new URL(`${url.href}?large=1`), largeHash, signal());
    await readVerifiedAsset(new URL(`${url.href}?large=2`), largeHash, controller.signal);
    await readVerifiedAsset(new URL(`${url.href}?large=3`), largeHash, signal());
    controller.abort();
    expect(put).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await waitForAssetCache();
  }
  // The third buffer exceeded the pending-byte budget; the second was cancelled.
  expect(put).toHaveBeenCalledTimes(1);
});
