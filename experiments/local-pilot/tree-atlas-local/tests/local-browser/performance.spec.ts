import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Request } from "@playwright/test";
import { blockExternalTiles, chooseCity, city, ready, url } from "./helpers.ts";

type Sample = {
  viewport: string;
  run: number;
  city: string;
  kind: "browser-cold" | "city-switch";
  readyMs: number;
  shellReadyMs: number | null;
  apiRequests: number;
  apiAdvertisedBodyBytes: number;
  inventoryAssetRequests: number;
  totalAdvertisedBodyBytes: number;
  serviceWorkerAdvertisedBodyBytes: number;
  missingLengthResponses: number;
  requests: NetworkRecord[];
  longTasks: number[];
  productionBundle: boolean;
};
type NetworkRecord = {
  path: string;
  owner: "page" | "service-worker";
  advertisedBodyBytes: number | null;
  status: number;
  fromServiceWorker: boolean;
  failed: boolean;
};
const samples: Sample[] = [];
const output = resolve(process.cwd(), "verification/browser-loading.json");
test.beforeAll(async () => {
  await mkdir(resolve(process.cwd(), "verification"), { recursive: true });
  await writeFile(output, JSON.stringify({ passed: false, state: "running", samples }, null, 2));
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900, isMobile: false },
  { name: "emulated-mobile", width: 390, height: 844, isMobile: true },
]) {
  test(`${viewport.name} loading profile uses the API without complete inventory downloads`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    if (baseURL === undefined) throw new Error("A local frontend baseURL is required");
    for (let run = 0; run < 5; run++) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile,
        serviceWorkers: "allow",
      });
      try {
        let network: NetworkRecord[] = [];
        const observed = new WeakMap<Request, NetworkRecord>();
        context.on("request", (request) => {
          const target = new URL(request.url());
          if (target.origin !== new URL(baseURL).origin) return;
          const row: NetworkRecord = {
            path: target.pathname,
            owner: request.serviceWorker() === null ? "page" : "service-worker",
            advertisedBodyBytes: null,
            status: 0,
            fromServiceWorker: false,
            failed: false,
          };
          network.push(row);
          observed.set(request, row);
        });
        context.on("response", (response) => {
          const row = observed.get(response.request());
          if (row === undefined) return;
          row.status = response.status();
          row.fromServiceWorker = response.fromServiceWorker();
          const length = response.headers()["content-length"];
          row.advertisedBodyBytes =
            row.status === 204 || row.status === 304
              ? 0
              : length !== undefined && /^\d+$/u.test(length)
                ? Number(length)
                : null;
        });
        context.on("requestfailed", (request) => {
          const row = observed.get(request);
          if (row !== undefined) row.failed = true;
        });
        await blockExternalTiles(context);
        const page = await context.newPage();
        await page.addInitScript(() => {
          const tasks: number[] = [];
          Object.defineProperty(window, "__atlasLongTasks", { value: tasks });
          if (PerformanceObserver.supportedEntryTypes.includes("longtask"))
            new PerformanceObserver((entries) => {
              for (const entry of entries.getEntries()) tasks.push(entry.duration);
            }).observe({ entryTypes: ["longtask"] });
        });
        for (const [index, id] of ["london", "porto", "geneva", "vienna", "london"].entries()) {
          network = [];
          await page
            .evaluate(() => {
              performance.clearResourceTimings();
              const tasks: unknown = Reflect.get(window, "__atlasLongTasks");
              if (Array.isArray(tasks)) tasks.length = 0;
            })
            .catch(() => undefined);
          const started = performance.now();
          if (index === 0) await page.goto(url(id));
          else await chooseCity(page, id);
          await ready(page, id, city(id).count);
          const readyMs = performance.now() - started;
          let shellReadyMs: number | null = null;
          if (index === 0) {
            await page.evaluate(async () => {
              await navigator.serviceWorker.ready;
            });
            shellReadyMs = performance.now() - started;
          }
          const observation = await page.evaluate(() => {
            const resources = performance
              .getEntriesByType("resource")
              .filter(
                (entry): entry is PerformanceResourceTiming =>
                  entry instanceof PerformanceResourceTiming,
              );
            const tasks: unknown = Reflect.get(window, "__atlasLongTasks");
            return {
              longTasks: Array.isArray(tasks) ? tasks.map(Number) : [],
              productionBundle: resources.some((entry) =>
                /\/assets\/[^/]+\.js(?:\?|$)/u.test(entry.name),
              ),
            };
          });
          const api = network.filter((item) => item.path.startsWith("/api/"));
          const inventory = network.filter((item) =>
            /\/(?:text|index|geometry)\.bin$|\/detail-\d+\.bin$/u.test(item.path),
          );
          samples.push({
            viewport: viewport.name,
            run,
            city: id,
            kind: index === 0 ? "browser-cold" : "city-switch",
            readyMs,
            shellReadyMs,
            apiRequests: api.length,
            apiAdvertisedBodyBytes: api.reduce(
              (sum, item) => sum + (item.advertisedBodyBytes ?? 0),
              0,
            ),
            inventoryAssetRequests: inventory.length,
            totalAdvertisedBodyBytes: network.reduce(
              (sum, item) => sum + (item.advertisedBodyBytes ?? 0),
              0,
            ),
            serviceWorkerAdvertisedBodyBytes: network
              .filter((item) => item.owner === "service-worker")
              .reduce((sum, item) => sum + (item.advertisedBodyBytes ?? 0), 0),
            missingLengthResponses: network.filter(
              (item) => item.status !== 0 && item.advertisedBodyBytes === null,
            ).length,
            requests: network,
            ...observation,
          });
          expect(inventory).toEqual([]);
          await writeFile(
            output,
            JSON.stringify({ passed: false, state: "running", samples }, null, 2),
          );
          console.log(`${viewport.name} run ${run + 1} ${id}: ${readyMs.toFixed(1)} ms`);
          if (index === 0)
            expect(
              observation.productionBundle,
              "Loading measurements require a bundled production preview",
            ).toBe(true);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
          ).toBe(false);
          if (run === 0 && index === 0)
            await page.screenshot({
              path: resolve(process.cwd(), `verification/local-${viewport.name}.png`),
              fullPage: true,
            });
        }
      } finally {
        await context.close();
      }
    }
    const groups = ["desktop", "emulated-mobile"].flatMap((name) =>
      ["browser-cold", "city-switch"].map((kind) => {
        const values = samples
          .filter((item) => item.viewport === name && item.kind === kind)
          .map((item) => item.readyMs)
          .sort((a, b) => a - b);
        return {
          viewport: name,
          kind,
          samples: values.length,
          p50Ms: values[Math.max(0, Math.ceil(values.length * 0.5) - 1)] ?? null,
          p95Ms: values[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? null,
          maxMs: values.at(-1) ?? null,
        };
      }),
    );
    await writeFile(
      output,
      JSON.stringify(
        {
          passed: samples.length === 50,
          state: samples.length === 50 ? "complete" : "partial",
          scope:
            "Actual local Chromium production preview with default service worker enabled; browser-cold contexts and city switches; byte figures are advertised Content-Length sums from context-wide response events, including service worker precache through shell readiness on cold starts, not measured network transfers; emulated viewport, not physical mobile; API/database/OS caches warm or uncontrolled; external basemap imagery blocked; unrelated machine activity uncontrolled",
          percentileMethod: "nearest-rank",
          groups,
          samples,
          notRun: [
            "physical Android/iOS",
            "shaped shared network",
            "cold database/OS",
            "hosted deployment",
            "actual transferred network-byte measurement",
          ],
        },
        null,
        2,
      ),
    );
  });
}
