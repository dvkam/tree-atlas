// Compare every published map leaf against the canonical details without using the app decoder.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

function check(condition, message) {
  if (!condition) throw Error(message);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
}

function readAsset(base, ref) {
  const file = realpathSync(path.resolve(base, ref.file));
  check(inside(base, file), "Asset outside the catalogue");
  const bytes = readFileSync(file);
  check(digest(bytes) === ref.sha256, "SHA-256 mismatch in " + ref.file);
  return JSON.parse((file.endsWith(".bin") ? gunzipSync(bytes) : bytes).toString("utf8"));
}

function checkPin(envelope, city, versions) {
  check(
    envelope.dataset === city.id &&
      envelope.release === city.release &&
      versions.includes(envelope.version),
    "Dataset, release or version mismatch",
  );
}

function validPosition(pos) {
  return (
    Array.isArray(pos) &&
    pos.length === 2 &&
    pos.every(Number.isFinite) &&
    Math.abs(pos[0]) <= 180 &&
    Math.abs(pos[1]) <= 90
  );
}

function inspectCity(base, city) {
  const descriptor = readAsset(base, city);
  const catalog = readAsset(base, city.map);
  checkPin(descriptor, city, [2, 3]);
  checkPin(catalog, city, [1]);
  const byId = new Map();
  let records = 0;
  let located = 0;
  let mapLeaves = 0;
  let leafRows = 0;
  for (const ref of descriptor.details) {
    const shard = readAsset(base, ref);
    checkPin(shard, city, [1]);
    check(shard.trees.length === ref.count, "Detail shard count mismatch");
    for (const item of shard.trees) {
      records++;
      check(
        item.dataset === city.id &&
          typeof item.sourceId === "string" &&
          item.sourceId.length > 0 &&
          !byId.has(item.sourceId),
        "Wrong detail dataset, missing or duplicate ID",
      );
      byId.set(item.sourceId, item.position);
      if (item.position !== null) {
        check(validPosition(item.position), "Invalid detail coordinate");
        located++;
      }
    }
  }
  check(
    records === city.count && located === city.locatedCount && located === catalog.locatedCount,
    "Manifest or catalogue count mismatch",
  );
  const visited = new Set();
  function visit(i, parentBounds) {
    check(
      Number.isInteger(i) && i >= 0 && i < catalog.nodes.length && !visited.has(i),
      "Map catalogue repeats a node or points outside its node array",
    );
    visited.add(i);
    const node = catalog.nodes[i];
    check(Number.isInteger(node.count) && node.count > 0, "Invalid node count");
    const bounds = node.bounds;
    check(
      Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite),
      "Invalid node bounds",
    );
    const [w, s, e, n] = bounds;
    check(w <= e && s <= n && w >= -180 && e <= 180 && s >= -90 && n <= 90, "Invalid node bounds");
    check(
      validPosition(node.position) &&
        w <= node.position[0] &&
        node.position[0] <= e &&
        s <= node.position[1] &&
        node.position[1] <= n,
      "Node marker outside its bounds",
    );
    if (parentBounds) {
      const [west, south, east, north] = parentBounds;
      check(west <= w && south <= s && e <= east && n <= north, "Child outside parent bounds");
    }
    check(
      Object.hasOwn(node, "children") !== Object.hasOwn(node, "asset"),
      "Expected either children or a leaf asset",
    );
    if ("children" in node) {
      let count = 0;
      for (const child of node.children) count += visit(child, bounds);
      check(count === node.count, "Map child counts differ from parent");
      return count;
    }
    const leaf = readAsset(base, node.asset);
    checkPin(leaf, city, [1]);
    check(
      leaf.trees.length === node.count && node.asset.count === node.count,
      "Map leaf count mismatch",
    );
    mapLeaves++;
    for (const row of leaf.trees) {
      const expected = byId.get(row.sourceId);
      check(
        row.dataset === city.id && validPosition(row.position) && Array.isArray(expected),
        "Wrong dataset, extra, unlocated or repeated map ID",
      );
      const [lon, lat] = row.position;
      check(expected[0] === lon && expected[1] === lat, "Coordinate differs from canonical detail");
      check(lon >= w && lon <= e && lat >= s && lat <= n, "Coordinate outside the leaf bounds");
      byId.delete(row.sourceId);
      leafRows++;
    }
    return node.count;
  }
  check((catalog.nodes.length === 0 ? 0 : visit(0, null)) === located, "Map root count mismatch");
  check(visited.size === catalog.nodes.length, "Unreachable catalogue node");
  check(leafRows === located && byId.size === records - located, "Map is missing located records");
  return { dataset: city.id, release: city.release, records, located, mapLeaves, leafRows };
}

function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      output: { type: "string" },
      city: { type: "string", multiple: true },
    },
  });
  check(values.repo && values.output, "Supply --repo CHECKOUT --output NEW_DIRECTORY [--city ID]");
  const repo = realpathSync(values.repo);
  const base = realpathSync(path.join(repo, "public/data"));
  // Resolve the existing parent first so a symlink cannot redirect output into the checkout.
  const absolute = path.resolve(values.output);
  const output = path.join(realpathSync(path.dirname(absolute)), path.basename(absolute));
  check(!inside(repo, output), "Output must be outside the input checkout");
  const raw = readFileSync(path.join(base, "manifest.json"));
  const manifest = JSON.parse(raw.toString("utf8"));
  check(manifest.version === 1, "Unknown manifest version");
  const ids = manifest.datasets.map((city) => city.id);
  check(
    ids.length > 0 && new Set(ids).size === ids.length,
    "Empty manifest or duplicate dataset IDs",
  );
  const selected = values.city ?? ids;
  check(
    new Set(selected).size === selected.length && selected.every((id) => ids.includes(id)),
    "Unknown or repeated --city",
  );
  mkdirSync(output);
  const start = performance.now();
  const report = {
    manifestSha256: digest(raw),
    selected,
    finished: false,
    checkedAt: new Date().toISOString(),
    inventories: [],
  };
  const save = () => {
    const temporary = path.join(output, "map.tmp");
    writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n");
    renameSync(temporary, path.join(output, "map.json"));
  };
  save();
  for (const city of manifest.datasets) {
    if (!selected.includes(city.id)) continue;
    try {
      const result = inspectCity(base, city);
      report.inventories.push(result);
      save();
      console.log(`${city.id}: ${result.leafRows} map rows in ${result.mapLeaves} leaves`);
    } catch (error) {
      report.failure = { dataset: city.id, release: city.release, error: String(error) };
      save();
      throw Error(`${city.id}: ${error}`, { cause: error });
    }
  }
  report.finished = true;
  report.elapsedSeconds = (performance.now() - start) / 1000;
  save();
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
