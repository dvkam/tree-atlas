import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { importInventory } from "../src/import.ts";
import type { DatasetId, Tree } from "../src/domain.ts";

/** Parse our downloaded FeatureCollection envelope without retaining its complete JSON text. */
export async function* streamFeatures(chunks: AsyncIterable<string>): AsyncGenerator {
  let prefix = "";
  let state: "prefix" | "first" | "next" | "object" | "separator" | "suffix" = "prefix";
  let object = "";
  let suffix = "";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for await (const chunk of chunks) {
    for (const character of chunk) {
      if (state === "prefix") {
        prefix += character;
        if (prefix.length > 4096) throw new Error("Invalid FeatureCollection envelope.");
        if (character === "[") {
          if (!/^\s*\{\s*"type"\s*:\s*"FeatureCollection"\s*,\s*"features"\s*:\s*\[$/u.test(prefix))
            throw new Error("Invalid FeatureCollection envelope.");
          state = "first";
        }
      } else if (state === "suffix") {
        suffix += character;
        if (suffix.length > 4096) throw new Error("Invalid FeatureCollection suffix.");
      } else if (state === "object") {
        object += character;
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (character === "{" || character === "[") depth++;
        else if (character === "}" || character === "]") {
          depth--;
          if (depth === 0) {
            yield JSON.parse(object);
            object = "";
            state = "separator";
          }
        }
      } else if (!/\s/u.test(character)) {
        if (character === "]" && state !== "next") state = "suffix";
        else if (character === "," && state === "separator") state = "next";
        else if (character === "{" && (state === "first" || state === "next")) {
          object = "{";
          depth = 1;
          state = "object";
        } else throw new Error("Invalid FeatureCollection separator.");
      }
    }
  }
  if (state !== "suffix" || !/^\s*\}\s*$/u.test(suffix))
    throw new Error("Truncated or invalid FeatureCollection.");
}

export async function loadSourceTrees(
  dataset: DatasetId,
  path: string,
  expectedHash: string,
): Promise<Tree[]> {
  if (dataset !== "london") {
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
      throw new Error(`Raw checksum mismatch: ${dataset}`);
    return importInventory(dataset, JSON.parse(bytes.toString("utf8")));
  }
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  if (digest.digest("hex") !== expectedHash) throw new Error("Raw checksum mismatch: london");
  const trees: Tree[] = [];
  const ids = new Set<string>();
  let batch: unknown[] = [];
  function flush() {
    const imported = importInventory(dataset, { type: "FeatureCollection", features: batch });
    for (const tree of imported) {
      if (ids.has(tree.sourceId)) throw new Error(`Repeated source identity: ${tree.sourceId}`);
      ids.add(tree.sourceId);
      trees.push(tree);
    }
    batch = [];
  }
  const stream = createReadStream(path, { encoding: "utf8" });
  for await (const feature of streamFeatures(stream)) {
    batch.push(feature);
    if (batch.length === 1024) flush();
  }
  if (batch.length > 0) flush();
  return trees;
}
