import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { offlineShell } from "./scripts/offline-shell-plugin.ts";
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
