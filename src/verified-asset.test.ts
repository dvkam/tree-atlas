import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readVerifiedAsset } from "./verified-asset.ts";

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
afterEach(() => vi.unstubAllGlobals());
describe("verified immutable asset storage", () => {
  it("reuses bytes across sessions and separates changed expected hashes", async () => {
    storage();
    const fetcher = vi.fn<() => Promise<Response>>(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    expect(new Uint8Array(await readVerifiedAsset(url, hash, signal()))).toEqual(bytes);
    expect(new Uint8Array(await readVerifiedAsset(url, hash, signal()))).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(readVerifiedAsset(url, "0".repeat(64), signal())).rejects.toThrow("integrity");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("repairs corrupted cached bytes through a verified network request", async () => {
    const saved = storage();
    const fetcher = vi.fn<() => Promise<Response>>(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetcher);
    await readVerifiedAsset(url, hash, signal());
    for (const key of saved.keys()) saved.set(key, new Response("corrupted"));
    expect(new Uint8Array(await readVerifiedAsset(url, hash, signal()))).toEqual(bytes);
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
    const saved = storage();
    await expect(readVerifiedAsset(url, "0".repeat(64), signal())).rejects.toThrow("integrity");
    expect(saved.size).toBe(0);
  });
  it("bounds retained bytes and entries while retaining the most recently used assets", async () => {
    const saved = storage();
    const large = new Uint8Array(7 * 1024 * 1024);
    const largeHash = createHash("sha256").update(large).digest("hex");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(large)),
    );
    for (let i = 0; i < 6; i++)
      await readVerifiedAsset(new URL(`${url.href}?asset=${i}`), largeHash, signal());
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
    for (let i = 0; i < 20; i++)
      await readVerifiedAsset(new URL(`${url.href}?small=${i}`), hash, signal());
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
