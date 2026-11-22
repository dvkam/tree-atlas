import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";
import { offlineShell } from "../scripts/offline-shell-plugin.ts";

it("changing only the worker gives the next build a private shell cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "tree-atlas-shell-"));
  async function buildCacheName() {
    await build({ root, configFile: false, logLevel: "silent", plugins: [offlineShell()] });
    const output = await readFile(join(root, "dist/sw.js"), "utf8");
    const cacheName = output.match(/tree-atlas-local-shell-[a-f0-9]+/u)?.[0];
    if (!cacheName) throw new Error("Missing app shell cache identifier");
    return cacheName;
  }
  try {
    await mkdir(join(root, "public/data"), { recursive: true });
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "index.html"), "<title>Offline build fixture</title>");
    await writeFile(join(root, "public/data/manifest.json"), "{}");
    await writeFile(join(root, "public/data/local-config.json"), "{}");
    const runtime = await readFile(new URL("../scripts/offline-shell.js", import.meta.url), "utf8");
    const worker = join(root, "scripts/offline-shell.js");
    await writeFile(worker, runtime);
    const first = await buildCacheName();
    expect(await buildCacheName()).toBe(first);
    await writeFile(worker, runtime + "\n// Worker-only revision\n");
    expect(await buildCacheName()).not.toBe(first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
