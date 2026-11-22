/** Untraced end-to-end comparison. Allocation/CPU profiles run separately. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { availableParallelism, loadavg } from "node:os";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { browserMemory } from "../tests/local-browser/browser-memory.ts";
import { blockExternalTiles, city, ready, reference, url } from "../tests/local-browser/helpers.ts";

const baseline = process.argv[2];
const candidate = process.argv[3];
for (const value of [baseline, candidate]) {
  const parsed = new URL(value);
  assert.equal(parsed.hostname, "127.0.0.1", "Use only the two owned loopback previews.");
  assert.equal(parsed.protocol, "http:");
}
const output = resolve(process.cwd(), "verification/offline-memory-comparison.json");
await mkdir(resolve(process.cwd(), "verification"), { recursive: true });
const report = {
  passed: false,
  executionStartedAt: new Date().toISOString(),
  scope:
    "Five alternating fresh-browser runs per build. Local desktop Chromium mobile emulation, same complete London pack, no profiler or explicit GC, external tiles blocked, warm/uncontrolled OS caches. Sampled owned process-tree RSS double-counts shared pages; PSS requires readable samples. Not a physical-device or hard-budget acceptance.",
  cores: availableParallelism(),
  loadBefore: loadavg(),
  backgroundWorkNote: process.env["TREE_ATLAS_BENCHMARK_NOTE"] ?? null,
  runs: [],
};
async function persist() {
  await writeFile(output, JSON.stringify(report, null, 2));
}
await persist();

async function checkIds(page, name) {
  const expected = reference("london", name).pages.find((entry) => entry.kind === "first")?.ids;
  assert.ok(expected !== undefined);
  const actual = await page
    .getByRole("list", { name: "Tree records" })
    .getByRole("button")
    .evaluateAll((buttons) => buttons.map((button) => button.id.slice("record-london:".length)));
  assert.deepEqual(actual.slice(0, expected.length), expected);
}
async function cameraAction(page, action) {
  await page.evaluate(() => {
    const map = document.querySelector('[aria-label="Tree map"]');
    if (map === null || map.getAttribute("aria-busy") !== "false")
      throw new Error("The camera measurement must begin with a ready map.");
    window.treeAtlasCameraMeasurement = new Promise((accept, reject) => {
      let sawBusy = false;
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error("No completed camera query was observed."));
      }, 30_000);
      const observer = new MutationObserver((changes) => {
        sawBusy ||=
          map.getAttribute("aria-busy") === "true" ||
          changes.some((change) => change.oldValue === "true");
        if (!sawBusy || map.getAttribute("aria-busy") !== "false") return;
        observer.disconnect();
        clearTimeout(timeout);
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            accept({
              busyTransitionObserved: sawBusy,
              markerCount: Number(map.getAttribute("data-marker-count")),
              renderedClusterNodes: map.querySelectorAll(".inventory-cluster").length,
            }),
          ),
        );
      });
      observer.observe(map, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["aria-busy"],
      });
    });
  });
  const started = performance.now();
  await action();
  const value = await page.evaluate(async () => window.treeAtlasCameraMeasurement);
  assert.equal(value.busyTransitionObserved, true);
  assert.ok(value.markerCount > 0 && value.markerCount <= 1000);
  assert.ok(value.renderedClusterNodes > 0 && value.renderedClusterNodes <= value.markerCount);
  return { ...value, elapsedMs: performance.now() - started };
}
async function run(side, baseURL, iteration) {
  const server = await chromium.launchServer();
  let browser = null;
  let context = null;
  let memory = null;
  const row = {
    side,
    iteration,
    passed: false,
    timings: {},
    pageErrors: [],
    offlineApiRequests: [],
    workerFiles: [],
  };
  let checkingOffline = false;
  try {
    const pid = server.process().pid;
    assert.ok(pid !== undefined);
    memory = await browserMemory(pid);
    browser = await chromium.connect(server.wsEndpoint());
    row.chromiumVersion = browser.version();
    context = await browser.newContext({
      baseURL,
      serviceWorkers: "allow",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await blockExternalTiles(context);
    context.on("request", (request) => {
      if (checkingOffline && new URL(request.url()).pathname.startsWith("/api/"))
        row.offlineApiRequests.push(new URL(request.url()).pathname);
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => row.pageErrors.push(error.message));
    page.on("worker", (worker) =>
      row.workerFiles.push(new URL(worker.url()).pathname.split("/").at(-1)),
    );
    memory.phase("online-open");
    await page.goto(url("london"));
    await ready(page, "london", city("london").count, 90_000);
    await checkIds(page, "all");
    await page.evaluate(async () => navigator.serviceWorker.ready.then(() => undefined));
    memory.phase("download-and-validate");
    let started = performance.now();
    await page.getByRole("button", { name: "Download city for offline use", exact: true }).click();
    await expect(page.getByText(/^Offline pack ready/u).first()).toBeVisible({ timeout: 240_000 });
    row.timings.downloadValidateCommitMs = performance.now() - started;
    memory.phase("offline-initialize");
    started = performance.now();
    await page.getByRole("button", { name: "Use downloaded city", exact: true }).click();
    await ready(page, "london", city("london").count, 180_000);
    row.timings.offlineInitializeMs = performance.now() - started;
    await checkIds(page, "all");
    checkingOffline = true;
    await context.setOffline(true);
    memory.phase("offline-refresh");
    started = performance.now();
    await page.reload();
    await ready(page, "london", city("london").count, 180_000);
    row.timings.offlineRefreshMs = performance.now() - started;
    await checkIds(page, "all");
    for (const name of ["common-genus", "all"]) {
      const expected = reference("london", name);
      memory.phase(`offline-query-${name}`);
      started = performance.now();
      const search = page.getByRole("combobox", { name: "Find a tree or place" });
      await search.fill(expected.q);
      await search.press("Enter");
      await ready(page, "london", expected.total, 120_000);
      row.timings[`${name}Ms`] = performance.now() - started;
      await checkIds(page, name);
    }
    memory.phase("offline-map-zoom");
    row.cameraZoom = await cameraAction(page, () =>
      page.locator(".leaflet-control-zoom-in").click(),
    );
    await ready(page, "london", city("london").count, 90_000);
    memory.phase("offline-map-pan");
    await page.locator(".leaflet-container").focus();
    row.cameraPan = await cameraAction(page, () => page.keyboard.press("ArrowRight"));
    await ready(page, "london", city("london").count, 90_000);
    await checkIds(page, "all");
    assert.deepEqual(row.pageErrors, []);
    assert.deepEqual(row.offlineApiRequests, []);
    row.records = city("london").count;
    row.passed = true;
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try {
      if (memory !== null) row.memory = await memory.finish();
    } finally {
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
    row.ownedBrowserExited =
      server.process().exitCode !== null || server.process().signalCode !== null;
    row.passed &&=
      row.ownedBrowserExited &&
      row.pageErrors.length === 0 &&
      row.offlineApiRequests.length === 0 &&
      row.memory?.errors.length === 0;
    report.runs.push(row);
    await persist();
    console.log(
      JSON.stringify({
        side,
        iteration,
        passed: row.passed,
        pssKiB: row.memory?.sampledPeakPssKiB ?? null,
        timings: row.timings,
      }),
    );
  }
  assert.equal(row.passed, true);
}
try {
  for (let iteration = 1; iteration <= 5; iteration++) {
    await run("baseline", baseline, iteration);
    await run("candidate", candidate, iteration);
  }
  const summarize = (values) => {
    assert.equal(values.length, 5);
    const sorted = [...values].sort((a, b) => a - b);
    return { median: sorted[2], min: sorted[0], max: sorted[4] };
  };
  report.summary = ["baseline", "candidate"].map((side) => {
    const rows = report.runs.filter((row) => row.side === side);
    const pss = rows.map((row) => row.memory.sampledPeakPssKiB);
    assert.ok(
      pss.every((value) => value !== null),
      "Incomplete PSS coverage prevents a complete comparison.",
    );
    return {
      side,
      runs: rows.length,
      sampledPeakPssKiB: summarize(pss),
      sampledPeakRssKiB: summarize(rows.map((row) => row.memory.sampledPeakRssKiB)),
      offlineInitializeMs: summarize(rows.map((row) => row.timings.offlineInitializeMs)),
      offlineRefreshMs: summarize(rows.map((row) => row.timings.offlineRefreshMs)),
      downloadValidateCommitMs: summarize(rows.map((row) => row.timings.downloadValidateCommitMs)),
      cameraZoomMs: summarize(rows.map((row) => row.cameraZoom.elapsedMs)),
      cameraPanMs: summarize(rows.map((row) => row.cameraPan.elapsedMs)),
    };
  });
  report.passed = report.runs.length === 10 && report.runs.every((row) => row.passed);
} finally {
  report.loadAfter = loadavg();
  report.executionCompletedAt = new Date().toISOString();
  await persist();
}
assert.equal(report.passed, true);
