/* global shellCacheName, shellFiles */
// The build injects the release-specific shellCacheName and shellFiles before this program.
const shellPaths = new Set(shellFiles);

async function installShell() {
  const alreadyPresent = await caches.has(shellCacheName);
  const cache = await caches.open(shellCacheName);
  try {
    // addAll commits atomically. Bypass the HTTP cache when staging a new release.
    await cache.addAll(shellFiles.map((path) => new Request(path, { cache: "reload" })));
  } catch (error) {
    if (!alreadyPresent) await caches.delete(shellCacheName);
    throw error;
  }
}

async function activateShell() {
  // Keep the standard waiting phase so tabs on the previous release retain their assets.
  for (const name of await caches.keys()) {
    if (name.startsWith("tree-atlas-local-shell-") && name !== shellCacheName)
      await caches.delete(name);
  }
  await self.clients.claim();
}

async function readShell(path, request) {
  const cache = await caches.open(shellCacheName);
  return (await cache.match(path)) ?? fetch(request);
}

self.addEventListener("install", (event) => event.waitUntil(installShell()));
self.addEventListener("activate", (event) => event.waitUntil(activateShell()));
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(readShell("/index.html", request));
  } else if (shellPaths.has(url.pathname)) {
    event.respondWith(readShell(url.pathname, request));
  }
});
