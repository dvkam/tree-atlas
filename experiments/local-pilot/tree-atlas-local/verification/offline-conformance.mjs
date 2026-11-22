/** Independent frozen-output checks through the actual InventorySession interface. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { datasetSchema } from "../src/domain.ts";
import { loadInventory } from "../src/inventory.ts";

const root = process.cwd();
const frozen = resolve(root, "../tree-atlas-contract-v1");
const data = resolve(root, "../tree-atlas/public/data");
const output = resolve(root, "verification/offline-conformance.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identityLine = (dataset, release, id) => JSON.stringify([dataset, release, id]) + "\n";
const inside = (bounds, position) =>
  position !== null &&
  position[0] >= bounds[0] &&
  position[0] <= bounds[2] &&
  position[1] >= bounds[1] &&
  position[1] <= bounds[3];
const report = {
  passed: false,
  executionStartedAt: new Date().toISOString(),
  scope:
    "Actual offline inventory session over hash-verified local pinned assets. Complete identity enumeration and frozen query/dictionary results; no HTTP, IndexedDB, browser memory, municipal completeness or hosted performance claim.",
  datasets: [],
};
await mkdir(resolve(root, "verification"), { recursive: true });
async function save() {
  await writeFile(output, JSON.stringify(report, null, 2));
}
await save();
const sealBytes = await readFile(resolve(frozen, "freeze-v1.json"));
const seal = JSON.parse(sealBytes);
for (const entry of seal.files) {
  const path = resolve(frozen, entry.file);
  assert.ok(path.startsWith(frozen + sep));
  const bytes = await readFile(path);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256);
}
report.freezeSha256 = hash(sealBytes);
const lockBytes = await readFile(resolve(frozen, "baseline.lock.json"));
const lock = JSON.parse(lockBytes);
const referenceBytes = await readFile(resolve(frozen, "reference/reference-results.json"));
const reference = JSON.parse(referenceBytes);
assert.equal(reference.baselineLockSha256, hash(lockBytes));
assert.equal(process.version, lock.referenceRuntime.node);
assert.equal(process.versions.unicode, lock.referenceRuntime.unicode);
report.referenceSha256 = hash(referenceBytes);

for (const expected of reference.datasets) {
  const started = performance.now();
  const dataset = datasetSchema.parse(lock.datasets.find((entry) => entry.id === expected.dataset));
  const row = {
    dataset: dataset.id,
    release: dataset.release,
    passed: false,
    queries: [],
    suggestions: 0,
    completeRecords: 0,
    selectedPages: 0,
    smallMarkerUnions: [],
  };
  report.datasets.push(row);
  const base = "https://offline-conformance.invalid/data/";
  const session = await loadInventory(base, dataset, undefined, {
    async readAsset(url, expectedHash, signal) {
      signal.throwIfAborted();
      assert.ok(url.href.startsWith(base));
      const path = resolve(data, url.href.slice(base.length));
      assert.ok(path.startsWith(data + sep));
      const bytes = await readFile(path);
      assert.equal(hash(bytes), expectedHash, "The actual asset must pass its pinned checksum.");
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    readDetail: async () => null,
  });
  try {
    await session.spatialReady;
    assert.notEqual(session.hasGeometry?.(), false);
    for (const expectedQuery of expected.queries) {
      const input = {
        q: expectedQuery.q,
        area: expectedQuery.area,
        viewport: expectedQuery.viewport,
        zoom: expectedQuery.zoom,
        offset: 0,
        limit: 100,
      };
      const complete = createHash("sha256");
      const viewport = createHash("sha256");
      let count = 0;
      let located = 0;
      let visible = 0;
      const smallRows = [];
      let firstResult = null;
      const offsets =
        expectedQuery.total === 0
          ? [0]
          : Array.from({ length: Math.ceil(expectedQuery.total / 100) }, (_, i) => i * 100);
      for (const offset of offsets) {
        const result = session.query({ ...input, offset });
        firstResult ??= result;
        assert.equal(
          result.total,
          expectedQuery.total,
          `${dataset.id}/${expectedQuery.name} total`,
        );
        assert.equal(result.locatedTotal, expectedQuery.locatedTotal);
        assert.equal(result.viewportLocatedTotal, expectedQuery.viewportLocatedTotal);
        assert.ok(result.markers.length <= 1000);
        assert.equal(result.items.length, Math.min(100, Math.max(0, expectedQuery.total - offset)));
        const represented = result.markers.reduce(
          (sum, marker) => sum + (marker.kind === "cluster" ? marker.count : 1),
          0,
        );
        assert.equal(represented, result.representedLocatedCount);
        assert.ok(represented <= expectedQuery.locatedTotal);
        for (const item of result.items) {
          assert.equal(item.dataset, dataset.id);
          complete.update(identityLine(dataset.id, dataset.release, item.sourceId));
          count++;
          if (item.position !== null) located++;
          if (inside(input.viewport, item.position)) {
            visible++;
            viewport.update(identityLine(dataset.id, dataset.release, item.sourceId));
          }
          if (expectedQuery.total <= 2000) smallRows.push(item);
        }
      }
      assert.equal(count, expectedQuery.total);
      assert.equal(located, expectedQuery.locatedTotal);
      assert.equal(visible, expectedQuery.viewportLocatedTotal);
      const digest = complete.digest("hex");
      assert.equal(
        digest,
        expectedQuery.orderedIdentitySha256,
        `${dataset.id}/${expectedQuery.name} complete ordered identities`,
      );
      assert.equal(viewport.digest("hex"), expectedQuery.viewportIdentitySha256);
      for (const page of expectedQuery.pages) {
        const result = session.query({ ...input, offset: page.offset, limit: page.limit });
        assert.deepEqual(
          result.items.map((item) => item.sourceId),
          page.ids,
        );
        row.selectedPages++;
      }
      if (expectedQuery.name === "all") {
        row.completeRecords = count;
        row.completeIdentitySha256 = digest;
      }
      if (
        expectedQuery.total > 0 &&
        expectedQuery.total <= 2000 &&
        row.smallMarkerUnions.length === 0
      ) {
        assert.ok(firstResult !== null);
        const matches = new Map(smallRows.map((item) => [item.sourceId, item]));
        const represented = new Set();
        let markerPages = 0;
        for (const marker of firstResult.markers) {
          const members = [];
          if (marker.kind === "tree") members.push(marker.tree);
          else {
            for (let offset = 0; offset < marker.count; offset += 100) {
              const result = session.clusterMembers({ ...input, offset }, marker.id);
              assert.equal(result.total, marker.count);
              assert.equal(result.items.length, Math.min(100, marker.count - offset));
              members.push(...result.items);
              markerPages++;
            }
          }
          assert.equal(members.length, marker.kind === "tree" ? 1 : marker.count);
          for (const member of members) {
            assert.deepEqual(member, matches.get(member.sourceId));
            assert.ok(member.position !== null);
            assert.equal(
              represented.has(member.sourceId),
              false,
              "No marker can represent a tree twice.",
            );
            represented.add(member.sourceId);
          }
        }
        assert.equal(represented.size, firstResult.representedLocatedCount);
        for (const item of smallRows.filter((candidateRow) =>
          inside(input.viewport, candidateRow.position),
        ))
          assert.ok(
            represented.has(item.sourceId),
            "Each exact visible match remains reachable in the grid.",
          );
        row.smallMarkerUnions.push({
          case: expectedQuery.name,
          represented: represented.size,
          memberPages: markerPages,
        });
      }
      row.queries.push({
        name: expectedQuery.name,
        records: count,
        located,
        visible,
        identitySha256: digest,
      });
    }
    for (const suggestion of expected.suggestions.cases) {
      assert.deepEqual(session.suggest(suggestion.q), suggestion.values);
      row.suggestions++;
    }
    row.passed = true;
  } finally {
    session.dispose();
    row.elapsedMs = performance.now() - started;
    await save();
  }
  console.log(
    JSON.stringify({
      dataset: row.dataset,
      passed: row.passed,
      completeRecords: row.completeRecords,
      queries: row.queries.length,
      elapsedMs: row.elapsedMs,
    }),
  );
}
report.passed = report.datasets.length === 4 && report.datasets.every((row) => row.passed);
report.completeRecords = report.datasets.reduce((sum, row) => sum + row.completeRecords, 0);
assert.equal(report.completeRecords, lock.totalRecords);
report.executionCompletedAt = new Date().toISOString();
await save();
assert.equal(report.passed, true);
