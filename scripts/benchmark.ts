import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { manifestSchema } from "../src/domain.ts";
import type { Bounds, Dataset } from "../src/domain.ts";
import { indexDescriptorSchema } from "../src/index-format.ts";
import type { InventoryQuery, InventoryResult } from "../src/index-format.ts";
import { loadInventory } from "../src/inventory.ts";

const root = resolve("public/data");
const base = "https://tree-atlas-benchmark.test/data/";
const manifest = manifestSchema.parse(
  JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")),
);
let transferredBytes = 0;
let requests = 0;
const server = setupServer(
  http.get(`${base}*`, async ({ request }) => {
    const file = resolve(root, decodeURIComponent(new URL(request.url).pathname.slice(6)));
    if (!file.startsWith(`${root}${sep}`))
      throw new Error("Asset outside benchmark data directory");
    const bytes = await readFile(file);
    transferredBytes += bytes.length;
    requests += 1;
    return new HttpResponse(new Uint8Array(bytes));
  }),
);
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
function checkMarkers(result: InventoryResult) {
  check(result.markers.length <= 1000, "Map marker budget exceeded");
}
function representedTrees(result: InventoryResult): number {
  return result.markers.reduce(
    (sum, marker) => sum + (marker.kind === "tree" ? 1 : marker.count),
    0,
  );
}

async function benchmark(dataset: Dataset) {
  const descriptor = indexDescriptorSchema.parse(
    JSON.parse(await readFile(resolve(root, dataset.file), "utf8")),
  );
  const assets = [descriptor.index, ...descriptor.details];
  let compressedBytes = 0;
  let largestAssetBytes = 0;
  for (const asset of assets) {
    const bytes = (await stat(resolve(root, asset.file))).size;
    compressedBytes += bytes;
    largestAssetBytes = Math.max(largestAssetBytes, bytes);
    check(bytes < 100 * 1024 * 1024, "An inventory asset exceeds GitHub's 100 MiB file limit");
  }
  transferredBytes = 0;
  requests = 0;
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const session = await loadInventory(base, dataset);
  const loadMs = performance.now() - started;
  try {
    const whole: InventoryQuery = {
      q: "",
      area: null,
      viewport: [-180, -90, 180, 90],
      zoom: 10,
      offset: 0,
      limit: 30,
    };
    const first = session.query(whole);
    check(first.total === dataset.count, "Full query does not return the complete inventory count");
    checkMarkers(first);
    check(
      representedTrees(first) === (dataset.locatedCount ?? dataset.count),
      "World clusters lose or duplicate inventory records",
    );
    const cachedTimes: number[] = [];
    for (let repeat = 0; repeat < 5; repeat += 1) {
      const cached = session.query(whole);
      check(cached.total === dataset.count, "Cached query count changed");
      checkMarkers(cached);
      check(
        representedTrees(cached) === (dataset.locatedCount ?? dataset.count),
        "Cached world clusters lose or duplicate records",
      );
      cachedTimes.push(cached.elapsedMs);
    }
    cachedTimes.sort((a, b) => a - b);
    const median = cachedTimes[2];
    check(median !== undefined, "No cached samples collected");
    const [lon, lat] = dataset.center;
    const area: Bounds = [lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01];
    const near = session.query({ ...whole, area, viewport: area, zoom: 15 });
    checkMarkers(near);
    check(near.total <= dataset.count, "Nearby query exceeds the complete inventory count");
    const firstTree = first.items[0];
    check(firstTree !== undefined, "Full inventory has no first result");
    const detailStart = performance.now();
    const detail = await session.detail(firstTree.sourceId);
    const detailMs = performance.now() - detailStart;
    check(
      detail?.sourceId === firstTree.sourceId,
      "Detail lookup does not match its indexed record",
    );
    return {
      dataset: dataset.id,
      release: dataset.release,
      count: dataset.count,
      indexBytes: (await stat(resolve(root, descriptor.index.file))).size,
      detailShards: descriptor.details.length,
      compressedBytes,
      largestAssetBytes,
      loadMs: round(loadMs),
      firstFullQueryMs: round(first.elapsedMs),
      cachedQueryMedianMs: round(median),
      cachedSamples: cachedTimes.map(round),
      nearQueryMs: round(near.elapsedMs),
      nearBounds: area,
      nearCount: near.total,
      worldMarkers: first.markers.length,
      nearMarkers: near.markers.length,
      detailMs: round(detailMs),
      requests,
      transferredBytes,
      heapBeforeMiB: round(heapBefore / 1024 / 1024),
      heapChangeMiB: round((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024),
      invariantsPassed: true,
    };
  } finally {
    session.dispose();
  }
}

server.listen({ onUnhandledFrame: "error" });
try {
  const results = [];
  for (const dataset of manifest.datasets) results.push(await benchmark(dataset));
  process.stdout.write(
    `${JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        explicitGcAvailable: typeof globalThis.gc === "function",
        method:
          "Actual inventory engine; MSW reads local published assets. No network, browser rendering or worker startup is measured. Heap change is an observation, not peak or retained memory.",
        results,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  server.close();
}
