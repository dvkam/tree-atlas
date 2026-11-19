/** Diagnostic worker profiling only. Do not use these traced runs as benchmarks. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { browserMemory } from "../tests/local-browser/browser-memory.ts";
import { blockExternalTiles, city, ready, reference, url } from "../tests/local-browser/helpers.ts";

const label = process.argv[2] ?? "diagnostic";
if (!/^[a-zA-Z0-9-]+$/u.test(label)) throw new Error("Use a plain diagnostic label.");
const directory = resolve(process.cwd(), "verification");
await mkdir(directory, { recursive: true });
const reportFile = resolve(directory, `profile-offline-${label}.json`);
const report = {
  passed: false,
  executionStartedAt: new Date().toISOString(),
  scope:
    "Diagnostic production-browser worker allocation/CPU profile. Tracing and explicit GC affect execution. These are not benchmark timings or device-memory acceptance.",
  label,
  city: "london",
  records: city("london").count,
  pageErrors: [],
  profilerErrors: [],
};
await writeFile(reportFile, JSON.stringify(report, null, 2));
const server = await chromium.launchServer();
let browser = null;
let context = null;
let memory = null;
let cdp = null;
let commandId = 0;
let selectedSession = null;
const sessions = new Map();
const waiting = new Map();
const setup = [];

async function workerCommand(sessionId, method, params = {}) {
  if (cdp === null) throw new Error("No page CDP session.");
  const id = ++commandId;
  const answer = new Promise((accept, reject) => {
    const timeout = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`Worker diagnostic timed out: ${method}`));
    }, 30_000);
    waiting.set(id, { accept, reject, timeout });
  });
  try {
    await cdp.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id, method, params }),
    });
  } catch (error) {
    const waiter = waiting.get(id);
    if (waiter !== undefined) {
      clearTimeout(waiter.timeout);
      waiting.delete(id);
      waiter.reject(error);
    }
  }
  return answer;
}

function allocationSummary(node, stack = [], rows = []) {
  const frame = node.callFrame;
  const next = [...stack, frame.functionName || "anonymous"];
  if (node.selfSize > 0)
    rows.push({
      sampledBytes: node.selfSize,
      function: frame.functionName || "anonymous",
      file: frame.url === "" ? null : basename(new URL(frame.url).pathname),
      line: frame.lineNumber,
      column: frame.columnNumber,
      stack: next.slice(-6),
    });
  for (const child of node.children) allocationSummary(child, next, rows);
  return rows.sort((a, b) => b.sampledBytes - a.sampledBytes);
}

try {
  const pid = server.process().pid;
  assert.ok(pid !== undefined);
  memory = await browserMemory(pid);
  browser = await chromium.connect(server.wsEndpoint());
  context = await browser.newContext({
    baseURL: process.env["TREE_ATLAS_LOCAL_URL"] ?? "http://127.0.0.1:4199",
    serviceWorkers: "allow",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await blockExternalTiles(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  cdp = await context.newCDPSession(page);
  cdp.on("Target.receivedMessageFromTarget", ({ message }) => {
    const value = JSON.parse(message);
    const waiter = waiting.get(value.id);
    if (waiter === undefined) return;
    clearTimeout(waiter.timeout);
    waiting.delete(value.id);
    if (value.error !== undefined) waiter.reject(new Error(value.error.message));
    else waiter.accept(value.result);
  });
  cdp.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
    const task = (async () => {
      sessions.set(sessionId, targetInfo.url);
      if (targetInfo.type === "worker" && /\/offline\.worker-[^/]+\.js$/u.test(targetInfo.url)) {
        selectedSession = sessionId;
        await workerCommand(sessionId, "HeapProfiler.startSampling", {
          samplingInterval: 32768,
          includeObjectsCollectedByMajorGC: true,
          includeObjectsCollectedByMinorGC: true,
        });
        await workerCommand(sessionId, "Profiler.enable");
        await workerCommand(sessionId, "Profiler.start");
      }
      await workerCommand(sessionId, "Runtime.runIfWaitingForDebugger");
    })().catch((error) => {
      report.profilerErrors.push(error instanceof Error ? error.message : String(error));
    });
    setup.push(task);
  });
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: false,
  });
  memory.phase("online-open");
  await page.goto(url("london"));
  await ready(page, "london", city("london").count, 90_000);
  memory.phase("download-and-validate");
  await page.getByRole("button", { name: "Download city for offline use", exact: true }).click();
  await expect(page.getByText(/^Offline pack ready/u).first()).toBeVisible({ timeout: 240_000 });
  memory.phase("profiled-offline-init-and-first-query");
  await page.getByRole("button", { name: "Use downloaded city", exact: true }).click();
  await ready(page, "london", city("london").count, 180_000);
  await Promise.all(setup);
  assert.ok(selectedSession !== null, "The actual offline worker was not profiled.");
  assert.deepEqual(report.profilerErrors, []);
  const expected = reference("london", "all").pages.find((entry) => entry.kind === "first")?.ids;
  assert.ok(expected !== undefined);
  const actual = await page
    .getByRole("list", { name: "Tree records" })
    .getByRole("button")
    .evaluateAll((buttons) => buttons.map((button) => button.id.slice("record-london:".length)));
  assert.deepEqual(actual.slice(0, expected.length), expected);
  report.workerFile = basename(new URL(sessions.get(selectedSession)).pathname);
  report.heapBeforeExplicitGC = await workerCommand(selectedSession, "Runtime.getHeapUsage");
  const allocations = await workerCommand(selectedSession, "HeapProfiler.stopSampling");
  const cpu = await workerCommand(selectedSession, "Profiler.stop");
  await writeFile(
    resolve(directory, `profile-offline-${label}-allocations.json`),
    JSON.stringify(allocations),
  );
  await writeFile(resolve(directory, `profile-offline-${label}-cpu.json`), JSON.stringify(cpu));
  const sampled = allocationSummary(allocations.profile.head);
  report.allocationSampledBytes = sampled.reduce((sum, row) => sum + row.sampledBytes, 0);
  report.allocationTop = sampled.slice(0, 25);
  report.cpuTop = cpu.profile.nodes
    .map((node) => ({
      function: node.callFrame.functionName || "anonymous",
      hits: node.hitCount ?? 0,
    }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 20);
  memory.phase("diagnostic-explicit-gc");
  await workerCommand(selectedSession, "HeapProfiler.collectGarbage");
  report.heapAfterExplicitGC = await workerCommand(selectedSession, "Runtime.getHeapUsage");
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try {
    if (memory !== null) report.memory = await memory.finish();
  } finally {
    for (const waiter of waiting.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("Diagnostic worker closed."));
    }
    waiting.clear();
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
  report.ownedBrowserExited =
    server.process().exitCode !== null || server.process().signalCode !== null;
  report.passed &&=
    report.ownedBrowserExited &&
    report.pageErrors.length === 0 &&
    report.profilerErrors.length === 0;
  await writeFile(reportFile, JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify({
    passed: report.passed,
    label,
    error: report.error ?? null,
    allocationSampledBytes: report.allocationSampledBytes ?? null,
  }),
);
