const CACHE_NAME = "tree-atlas-verified-assets-v1";
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 18;

async function digest(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

async function openCache(): Promise<Cache | null> {
  try {
    return "caches" in globalThis ? await caches.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
}

async function remember(cache: Cache, key: string, bytes: ArrayBuffer, signal: AbortSignal) {
  if (bytes.byteLength > MAX_ASSET_BYTES) return;
  try {
    signal.throwIfAborted();
    // Replacement moves a hit to the end of CacheStorage's insertion order.
    await cache.delete(key);
    await cache.put(
      key,
      new Response(bytes, { headers: { "Content-Length": String(bytes.byteLength) } }),
    );
    const keys = await cache.keys();
    let retained = 0;
    let count = 0;
    for (const entry of keys.toReversed()) {
      const response = await cache.match(entry);
      const size = Number(response?.headers.get("Content-Length"));
      if (
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        retained + size > MAX_BYTES ||
        count >= MAX_ENTRIES
      ) {
        await cache.delete(entry);
      } else {
        retained += size;
        count++;
      }
    }
  } catch {
    // Storage denial, eviction and quota errors must never prevent an online inventory load.
  }
}

/** Only immutable, hash-addressed bytes are cached; parsed city indexes remain worker-owned. */
export async function readVerifiedAsset(
  url: URL,
  expectedHash: string,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  const cache = await openCache();
  const key = new URL(url);
  key.searchParams.set("verified-sha256", expectedHash);
  if (cache !== null) {
    try {
      const saved = await cache.match(key.href);
      if (saved !== undefined) {
        const bytes = await saved.arrayBuffer();
        signal.throwIfAborted();
        if ((await digest(bytes)) === expectedHash) {
          await remember(cache, key.href, bytes, signal);
          signal.throwIfAborted();
          return bytes;
        }
        await cache.delete(key.href);
      }
    } catch {
      signal.throwIfAborted();
    }
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Inventory asset unavailable (${response.status}). Try again.`);
  const bytes = await response.arrayBuffer();
  if ((await digest(bytes)) !== expectedHash)
    throw new Error("Inventory asset failed its integrity check.");
  signal.throwIfAborted();
  if (cache !== null) await remember(cache, key.href, bytes, signal);
  signal.throwIfAborted();
  return bytes;
}
