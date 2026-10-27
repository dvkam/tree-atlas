import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const root = resolve(process.env.MOBILE_BENCH_ROOT ?? "dist");
const output = resolve(process.env.MOBILE_BENCH_OUTPUT ?? ".tmp/mobile-performance.json");
const repeats = Number(process.env.MOBILE_BENCH_RUNS ?? 3);
if (!Number.isSafeInteger(repeats) || repeats < 1)
  throw new Error("MOBILE_BENCH_RUNS must be a positive integer.");
const rate = 500_000;
const latency = 100;
const manifest = JSON.parse(await readFile(resolve(root, "data/manifest.json"), "utf8"));
const cities = (process.env.MOBILE_BENCH_CITIES ?? "vienna,geneva,porto").split(",");
const selected = cities.map((id) => {
  const dataset = manifest.datasets.find((item) => item.id === id);
  if (!dataset) throw new Error(`Unknown benchmark inventory: ${id}`);
  return dataset;
});
const sequence = [...selected, selected[0]];
let served = [];
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".bin": "application/octet-stream",
};
async function serve(request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const bytes = await readFile(file);
    await delay(latency);
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Content-Length": bytes.length,
      "Cache-Control": pathname === "/" ? "no-cache" : "public, max-age=600",
    });
    const record = { path: pathname, bytes: 0 };
    served.push(record);
    const chunk = 25_000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      if (response.destroyed) return;
      const part = bytes.subarray(offset, offset + chunk);
      response.write(part);
      record.bytes += part.length;
      await delay((part.length / rate) * 1000);
    }
    response.end();
  } catch {
    response.writeHead(404).end();
  }
}
const server = createServer((request, response) => {
  void serve(request, response);
});
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Missing benchmark server port");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const runs = [];
try {
  for (let run = 1; run <= repeats; run++) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setBlockedURLs", {
      urls: ["*://tile.openstreetmap.org/*", "*://mapserver.dataspace.copernicus.eu/*"],
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      window.mobileBenchmarkTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          window.mobileBenchmarkTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const steps = [];
    for (const [step, dataset] of sequence.entries()) {
      const city = dataset.id;
      served = [];
      const started = performance.now();
      const browserStart = step === 0 ? 0 : await page.evaluate(() => performance.now());
      if (step === 0) await page.goto(`${base}/?city=${city}`, { waitUntil: "domcontentloaded" });
      else {
        const picker = page.getByRole("combobox", { name: "Inventory location", exact: true });
        if (await picker.count()) await picker.selectOption(city);
        else
          await page
            .getByRole("button", { name: `${dataset.city} ${dataset.country}`, exact: true })
            .click();
      }
      await page.waitForFunction(
        (cityId) => {
          const map = document.querySelector(".map-panel");
          return (
            map?.getAttribute("data-city") === cityId &&
            Number(map.getAttribute("data-marker-count")) > 0 &&
            map.getAttribute("aria-busy") !== "true"
          );
        },
        city,
        { timeout: 120_000 },
      );
      const firstMapMs = performance.now() - started;
      const firstMapServerBytes = served.reduce((sum, record) => sum + record.bytes, 0);
      await page
        .getByRole("heading", {
          name: `${dataset.count.toLocaleString("en")} records`,
          exact: true,
        })
        .waitFor({ timeout: 120_000 });
      await page.waitForFunction(
        () => {
          const map = document.querySelector(".map-panel");
          return (
            Number(map?.getAttribute("data-marker-count")) > 0 &&
            map?.getAttribute("aria-busy") !== "true"
          );
        },
        null,
        { timeout: 120_000 },
      );
      const readyMs = performance.now() - started;
      await page.waitForFunction(
        () => document.querySelector(".map-panel")?.getAttribute("data-filter-ready") === "true",
        null,
        { timeout: 120_000 },
      );
      const exactMapMs = performance.now() - started;
      const observed = await page.evaluate((since) => {
        const tasks = window.mobileBenchmarkTasks.filter((task) => task.start >= since);
        return {
          markers: Number(document.querySelector(".map-panel")?.getAttribute("data-marker-count")),
          results: document.querySelectorAll(".tree-list button").length,
          longTasks: tasks.length,
          longestTaskMs: Math.max(0, ...tasks.map((task) => task.duration)),
          totalLongTaskMs: tasks.reduce((sum, task) => sum + task.duration, 0),
          pageHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        };
      }, browserStart);
      if (observed.markers > 1000 || observed.results !== 30)
        throw new Error(`Display invariant failed: ${city}`);
      steps.push({
        city,
        kind:
          step === 0 ? "cold-app" : step === sequence.length - 1 ? "return" : "first-city-switch",
        readyMs: Math.round(readyMs),
        exactMapMs: Math.round(exactMapMs),
        firstMapMs: Math.round(firstMapMs),
        firstMapServerBytes,
        ...observed,
        serverBytes: served.reduce((sum, record) => sum + record.bytes, 0),
        inventoryBytes: served
          .filter((record) => record.path.startsWith("/data/releases/"))
          .reduce((sum, record) => sum + record.bytes, 0),
        inventoryRequests: served
          .filter((record) => record.path.startsWith("/data/releases/"))
          .map((record) => record.path),
      });
      process.stdout.write(`Run ${run} ${city} ${Math.round(readyMs)} ms\n`);
    }
    if (errors.length) throw new Error(errors.join("\n"));
    runs.push({ run, steps });
    await context.close();
  }
  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    root,
    method: {
      viewport: "390x844",
      deviceScaleFactor: 2,
      touch: true,
      pageCpuSlowdown: 4,
      workerCpuSlowdown:
        "Not applied: page CDP CPU throttling does not establish worker throttling",
      serverBytesPerSecondPerResponse: rate,
      serverLatencyMs: latency,
      serverCacheSeconds: 600,
      externalTiles: "blocked via CDP; HTTP cache remains enabled",
      repetitions: repeats,
      limitations:
        "Desktop Chromium mobile emulation, not physical phone. Per-response bandwidth is not a shared radio budget. Page heap excludes worker heap. JS/CSS are served without HTTP compression; inventory assets are already compressed. Existing browser HTTP cache is allowed; each repetition starts a fresh context. Initial Vienna includes app load, others measure city changes.",
    },
    runs,
  };
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${output}\n`);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
