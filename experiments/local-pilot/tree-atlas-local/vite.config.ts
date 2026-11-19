import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import manifest from "./public/data/manifest.json" with { type: "json" };

const sourceRoot = fileURLToPath(new URL("../tree-atlas/public/data", import.meta.url));
const releases = new Set(manifest.datasets.map((dataset) => dataset.release));
function staticSources(): Plugin {
  function serve(request: IncomingMessage, response: ServerResponse, next: () => void) {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (!path.startsWith("/data/releases/")) {
      next();
      return;
    }
    let relative: string;
    try {
      relative = decodeURIComponent(path.slice("/data/".length));
    } catch {
      response.statusCode = 400;
      response.end("Invalid asset path");
      return;
    }
    const parts = relative.split("/");
    const target = resolve(sourceRoot, relative);
    if (
      request.method !== "GET" ||
      !releases.has(parts[1] ?? "") ||
      parts.length !== 3 ||
      !/^[a-zA-Z0-9-]+\.(?:json|bin)$/u.test(parts[2] ?? "") ||
      !target.startsWith(sourceRoot + sep)
    ) {
      response.statusCode = 404;
      response.end("Unavailable frozen asset");
      return;
    }
    void stat(target)
      .then((info) => {
        response.setHeader("Content-Length", info.size);
        response.setHeader(
          "Content-Type",
          relative.endsWith(".json") ? "application/json" : "application/octet-stream",
        );
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        createReadStream(target)
          .on("error", () => {
            response.destroy();
          })
          .pipe(response);
      })
      .catch(() => {
        response.statusCode = 404;
        response.end("Frozen asset unavailable");
      });
  }
  return {
    name: "local-frozen-sources",
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
  };
}
function offlineShell(): Plugin {
  return {
    name: "local-offline-shell",
    async generateBundle(_options, bundle) {
      const files = [
        "/",
        "/index.html",
        "/data/manifest.json",
        "/data/local-config.json",
        ...Object.keys(bundle)
          .filter((name) => /\.(?:js|css|json|woff2|png|svg)$/u.test(name))
          .map((name) => `/${name}`),
      ];
      const version = createHash("sha256").update(
        JSON.stringify(
          Object.values(bundle).map((item) =>
            item.type === "chunk" ? item.code : String(item.source),
          ),
        ),
      );
      for (const name of [
        "index.html",
        "public/data/manifest.json",
        "public/data/local-config.json",
      ])
        version.update(await readFile(fileURLToPath(new URL(name, import.meta.url))));
      const id = version.digest("hex").slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `
const CACHE='tree-atlas-local-shell-${id}';const FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);try{await cache.addAll(FILES);}catch(error){await caches.delete(CACHE);throw error;}})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{await self.clients.claim();for(const name of await caches.keys())if(name.startsWith('tree-atlas-local-shell-')&&name!==CACHE)await caches.delete(name);})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
if(event.request.mode==='navigate'){event.respondWith((async()=>{const cache=await caches.open(CACHE);return(await cache.match('/index.html'))||fetch(event.request);})());return;}
if(FILES.includes(url.pathname))event.respondWith((async()=>{const cache=await caches.open(CACHE);return(await cache.match(url.pathname))||fetch(event.request);})());});
`,
      });
    },
  };
}
const port = Number(process.env["TREE_ATLAS_API_PORT"] ?? 0);
const proxy =
  port > 0 && port < 65536
    ? {
        "/api": {
          target: `http://127.0.0.1:${port}`,
          rewrite: (path: string) => path.replace(/^\/api/u, ""),
        },
      }
    : {};
export default defineConfig({
  base: "/",
  plugins: [react({ compiler: true }), staticSources(), offlineShell()],
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
});
