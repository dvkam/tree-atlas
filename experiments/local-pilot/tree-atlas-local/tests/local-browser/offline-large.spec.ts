import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import type { Browser, BrowserContext, BrowserServer, Page } from "@playwright/test";
import { browserMemory } from "./browser-memory.ts";
import { blockExternalTiles, city, ready, reference, url } from "./helpers.ts";

const output = resolve(process.cwd(), "verification/offline-cities.json");
const reports: unknown[] = [];
const completed = new Set<string>();
const cities = ["london", "vienna", "geneva"];
const scope =
  "Real local bundled Chromium, complete pinned city packs and offline refresh; owned Linux browser process-tree RSS includes renderer/dedicated-worker native memory but double-counts shared pages; PSS only where all process samples are readable; 250 ms sampled peaks can miss transients; no physical-phone, shaped-network, cold-OS, hard-memory-budget or basemap claim.";
async function persist() {
  await mkdir(resolve(process.cwd(), "verification"), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        passed: completed.size === cities.length,
        state: completed.size === cities.length ? "complete" : "partial",
        scope,
        cities: reports,
      },
      null,
      2,
    ),
  );
}

async function checkFirstIds(page: Page, id: string, name: string) {
  const expected = reference(id, name).pages.find((entry) => entry.kind === "first")?.ids;
  if (expected === undefined) throw new Error(`Missing independent first page ${id}/${name}`);
  const ids = await page
    .getByRole("list", { name: "Tree records" })
    .getByRole("button")
    .evaluateAll(
      (buttons, prefix) => buttons.map((button) => button.id.slice(prefix.length)),
      `record-${id}:`,
    );
  expect(ids.slice(0, expected.length)).toEqual(expected);
}

async function closeOwnedBrowser(
  server: BrowserServer,
  browser: Browser | null,
  context: BrowserContext | null,
) {
  try {
    await context?.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
}

async function openOwnedBrowser(baseURL: string) {
  const server = await chromium.launchServer();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  // Ownership begins immediately after launch, before connection, page or sampler setup.
  try {
    const processId = server.process().pid;
    if (processId === undefined) throw new Error("The owned Chromium PID is unavailable");
    browser = await chromium.connect(server.wsEndpoint());
    context = await browser.newContext({
      baseURL,
      serviceWorkers: "allow",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const memory = await browserMemory(processId);
    return { server, browser, context, page, memory };
  } catch (error) {
    try {
      await closeOwnedBrowser(server, browser, context);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Owned browser startup and cleanup failed.", {
        cause: cleanupError,
      });
    }
    throw error;
  }
}

test.beforeAll(async () => persist());

for (const id of cities) {
  test(`${id} complete offline pack, offline refresh, queries and process memory`, async ({
    baseURL,
  }) => {
    test.setTimeout(600_000);
    if (baseURL === undefined) throw new Error("A local production preview URL is required");
    const { server, browser, context, page, memory } = await openOwnedBrowser(baseURL);
    const timings: Record<string, number> = {};
    const workerKinds = new Set<string>();
    const pageErrors: string[] = [];
    const offlineApiRequests: string[] = [];
    let checkingOffline = false;
    let passed = false;
    let errorText: string | null = null;
    let storage: unknown = null;
    let workerCountAtOfflineReady = 0;
    let contentBytes = 0;
    let memoryResult: Awaited<ReturnType<typeof memory.finish>> | null = null;
    page.on("worker", (worker) =>
      workerKinds.add(new URL(worker.url()).pathname.replace(/-[a-zA-Z0-9_-]+\.js$/u, ".js")),
    );
    page.on("pageerror", (error) => pageErrors.push(error.message));
    context.on("request", (request) => {
      if (checkingOffline && new URL(request.url()).pathname.startsWith("/api/"))
        offlineApiRequests.push(new URL(request.url()).pathname);
    });
    try {
      await blockExternalTiles(context);
      memory.phase("online-open");
      await page.goto(url(id));
      await ready(page, id, city(id).count, 90_000);
      await checkFirstIds(page, id, "all");
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });

      memory.phase("download-and-validate");
      let started = performance.now();
      await page
        .getByRole("button", { name: "Download city for offline use", exact: true })
        .click();
      await expect(page.getByText(/^Offline pack ready/u).first()).toBeVisible({
        timeout: 240_000,
      });
      timings["downloadValidateCommitMs"] = performance.now() - started;
      storage = await page.evaluate(async () => navigator.storage.estimate());
      const packLabel = await page
        .getByText(/^Offline pack ready/u)
        .first()
        .innerText();
      contentBytes = Number(packLabel.match(/ready · ([\d,]+) bytes/u)?.[1]?.replace(/,/gu, ""));
      expect(Number.isSafeInteger(contentBytes) && contentBytes > 0).toBe(true);

      const all = reference(id, "all").pages.find((entry) => entry.kind === "first")?.ids;
      const savedId = all?.[0];
      const unsavedId = all?.[1];
      if (savedId === undefined || unsavedId === undefined)
        throw new Error("Two independent detail identities are required");
      await page.getByRole("list", { name: "Tree records" }).getByRole("button").first().click();
      await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Selected tree details" })).toContainText(
        `Source ID ${savedId} ·`,
      );
      expect(new URL(page.url()).searchParams.get("tree")).toBe(`${id}:${savedId}`);
      await page.getByRole("button", { name: "Save details for offline use", exact: true }).click();
      await expect(page.getByText("Details saved for offline use.", { exact: true })).toBeVisible();

      memory.phase("offline-worker-initialization");
      started = performance.now();
      await page.getByRole("button", { name: "Use downloaded city", exact: true }).click();
      await ready(page, id, city(id).count, 120_000);
      timings["offlineModeInitializeMs"] = performance.now() - started;
      checkingOffline = true;
      await context.setOffline(true);
      memory.phase("offline-refresh");
      started = performance.now();
      await page.reload();
      await ready(page, id, city(id).count, 120_000);
      timings["offlineRefreshReadyMs"] = performance.now() - started;
      workerCountAtOfflineReady = page.workers().length;
      expect(workerCountAtOfflineReady).toBeGreaterThan(0);
      await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Selected tree details" })).toContainText(
        `Source ID ${savedId} ·`,
      );
      await page.getByRole("button", { name: "Close tree details" }).click();
      await checkFirstIds(page, id, "all");

      for (const queryName of ["common-genus", "leading-zeros"]) {
        const expected = reference(id, queryName);
        memory.phase(`offline-${queryName}`);
        started = performance.now();
        const search = page.getByRole("searchbox", { name: "Find a tree or place" });
        await search.fill(expected.q);
        await search.press("Enter");
        await ready(page, id, expected.total, 90_000);
        timings[`${queryName}Ms`] = performance.now() - started;
        await checkFirstIds(page, id, queryName);
      }
      const central = reference(id, "central-area");
      if (central.area === null) throw new Error("Independent area bounds are required");
      memory.phase("offline-area-reload");
      started = performance.now();
      await page.goto(url(id, { area: central.area.join(",") }));
      await ready(page, id, central.total, 120_000);
      timings["areaReloadReadyMs"] = performance.now() - started;
      await checkFirstIds(page, id, "central-area");

      memory.phase("offline-details");
      await page.goto(url(id, { tree: `${id}:${unsavedId}` }));
      await ready(page, id, city(id).count, 120_000);
      await expect(
        page.getByText("These details were not saved for offline use.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Record not found in this release" }),
      ).toHaveCount(0);
      await page.goto(url(id, { tree: `${id}:${savedId}` }));
      await ready(page, id, city(id).count, 120_000);
      await expect(page.getByRole("region", { name: "Selected tree details" })).toBeVisible();
      expect(offlineApiRequests).toEqual([]);
      expect(pageErrors).toEqual([]);

      memory.phase("offline-eviction");
      const session = await context.newCDPSession(page);
      try {
        await session.send("Storage.clearDataForOrigin", {
          origin: new URL(page.url()).origin,
          storageTypes: "indexeddb",
        });
      } finally {
        await session.detach();
      }
      await page.reload();
      await expect(
        page
          .getByRole("heading", { name: /could not load|not ready|unavailable|incomplete/iu })
          .first(),
      ).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole("list", { name: "Tree records" })).toHaveCount(0);
      await expect(page.locator(".results-heading h2")).not.toHaveText("0 records");
      expect(offlineApiRequests).toEqual([]);
      expect(pageErrors).toEqual([]);
      passed = true;
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
      await page
        .screenshot({ path: test.info().outputPath(`offline-${id}-failure.png`), fullPage: true })
        .catch(() => undefined);
      throw error;
    } finally {
      try {
        memoryResult = await memory.finish();
      } finally {
        await closeOwnedBrowser(server, browser, context);
      }
      const measured =
        memoryResult.errors.length === 0 &&
        memoryResult.samples.some((sample) => sample.roles["renderer"] !== undefined);
      const browserExited =
        server.process().exitCode !== null || server.process().signalCode !== null;
      passed &&= measured && browserExited && pageErrors.length === 0;
      if (passed) completed.add(id);
      const report = {
        recordedAt: new Date().toISOString(),
        city: id,
        release: city(id).release,
        records: city(id).count,
        passed,
        error: errorText,
        chromiumVersion: browser.version(),
        ownedBrowserExited: browserExited,
        viewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
        timings,
        packContentBytes: contentBytes,
        storageEstimate: storage,
        workerKinds: [...workerKinds],
        workerCountAtOfflineReady,
        offlineApiRequests,
        pageErrors,
        memory: memoryResult,
      };
      reports.push(report);
      await writeFile(
        resolve(process.cwd(), `verification/offline-city-${id}.json`),
        JSON.stringify(report, null, 2),
      );
      await persist();
    }
    expect(memoryResult.errors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(server.process().exitCode !== null || server.process().signalCode !== null).toBe(true);
    expect(memoryResult.samples.some((sample) => sample.roles["renderer"] !== undefined)).toBe(
      true,
    );
  });
}
