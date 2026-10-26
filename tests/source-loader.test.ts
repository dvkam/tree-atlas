import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSourceTrees, streamFeatures } from "../scripts/source-loader.ts";

async function* chunks(text: string, size: number) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}
async function parse(text: string, size = 7) {
  const features: unknown[] = [];
  for await (const feature of streamFeatures(chunks(text, size))) features.push(feature);
  return features;
}
it("parses arbitrary chunk boundaries and quoted braces without losing features", async () => {
  const features = [
    { type: "Feature", properties: { text: 'a } [ \\ " 🌳' }, geometry: { coordinates: [1, 2] } },
    { type: "Feature", properties: {} },
  ];
  const text = JSON.stringify({ type: "FeatureCollection", features });
  for (const size of [1, 3, 27, 1024]) expect(await parse(text, size)).toEqual(features);
});
it("accepts an empty collection", async () => {
  expect(await parse('{"type":"FeatureCollection","features":[]}')).toEqual([]);
});
it.each([
  '{"type":"FeatureCollection","features":[{}',
  '{"type":"FeatureCollection","features":[{},]}',
  '{"type":"FeatureCollection","features":[{} {}]}',
  '{"type":"FeatureCollection","features":[]} trailing',
  '{"type":"FeatureCollection","features":[{"x":]}]}',
  '{"type":"Wrong","features":[]}',
])("rejects malformed or truncated collection %s", async (text) => {
  await expect(parse(text)).rejects.toThrow(/./u);
});

it("checks streaming source hashes and detects identities repeated across batches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tree-stream-"));
  const path = join(directory, "source.json");
  const features = Array.from({ length: 1025 }, (_, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [-0.1, 51.5] },
    properties: { uniqueid: String(index) },
  }));
  async function save() {
    const text = JSON.stringify({ type: "FeatureCollection", features });
    await writeFile(path, text);
    return createHash("sha256").update(text).digest("hex");
  }
  try {
    const hash = await save();
    await expect(loadSourceTrees("london", path, "0".repeat(64))).rejects.toThrow("checksum");
    expect(await loadSourceTrees("london", path, hash)).toHaveLength(1025);
    const last = features[1024];
    if (last === undefined) throw new Error("Missing fixture");
    last.properties.uniqueid = "0";
    await expect(loadSourceTrees("london", path, await save())).rejects.toThrow(
      "Repeated source identity",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
