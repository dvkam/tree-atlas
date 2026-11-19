const CACHE_NAME = "tree-atlas-verified-assets-v1";
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 18;
const MAX_PENDING_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_WRITES = 2;
type CacheWrite = { cache: Cache; key: string; bytes: ArrayBuffer; signal: AbortSignal };
const pendingWrites: CacheWrite[] = [];
let pendingBytes = 0;
let persistence: Promise<void> | null = null;

function enqueueWrite(write: CacheWrite) {
  if (
    write.signal.aborted ||
    write.bytes.byteLength > MAX_ASSET_BYTES ||
    pendingWrites.length >= MAX_PENDING_WRITES ||
    pendingBytes + write.bytes.byteLength > MAX_PENDING_BYTES
  )
    return;
  pendingWrites.push(write);
  pendingBytes += write.bytes.byteLength;
  persistence ??= (async () => {
    try {
      while (pendingWrites.length > 0) {
        const next = pendingWrites.shift();
        if (next === undefined) break;
        pendingBytes -= next.bytes.byteLength;
        await remember(next.cache, next.key, next.bytes, next.signal);
      }
    } finally {
      persistence = null;
    }
  })();
}

/** Tests and explicit storage tasks can wait; display paths must not await persistence. */
export async function waitForAssetCache(): Promise<void> {
  await persistence;
}

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
    // Only newly fetched bytes are written; cache hits never rewrite multi-megabyte assets.
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
  if (cache !== null) enqueueWrite({ cache, key: key.href, bytes, signal });
  signal.throwIfAborted();
  return bytes;
}
