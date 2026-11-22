import type { Plugin } from "vite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function offlineShell(): Plugin {
  let root = "";
  return {
    name: "local-offline-shell",
    configResolved(config) {
      root = config.root;
    },
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
      const program = await readFile(resolve(root, "scripts/offline-shell.js"), "utf8");
      const version = createHash("sha256")
        .update(program)
        .update(JSON.stringify(files))
        .update(
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
        version.update(await readFile(resolve(root, name)));
      const id = version.digest("hex").slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `const shellCacheName = "tree-atlas-local-shell-${id}";\nconst shellFiles = ${JSON.stringify(files)};\n${program}`,
      });
    },
  };
}
