import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { packMap } from "./map-pack.ts";
import { encodeTextColumns } from "../src/index-codec.ts";
import { releaseSchema } from "../src/domain.ts";
import type { DatasetId, Tree } from "../src/domain.ts";
import { compactIndexSchema, indexDescriptorSchema } from "../src/index-format.ts";
import type { IndexRow } from "../src/index-format.ts";

export const DETAIL_PAGE_SIZE = 512;
export function packInventory(dataset: DatasetId, release: string, trees: Tree[]) {
  const files: { name: string; bytes: Buffer }[] = [];
  function store(name: string, bytes: Buffer, count: number) {
    files.push({ name, bytes });
    return {
      file: `releases/${release}/${name}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      count,
    };
  }
  function asset(name: string, value: unknown, count: number) {
    return store(name, gzipSync(JSON.stringify(value), { level: 9 }), count);
  }
  const strings: string[] = [];
  const dictionary = new Map<string, number>();
  function code(text: string | null): number {
    if (text === null) return -1;
    const existing = dictionary.get(text);
    if (existing !== undefined) return existing;
    const index = strings.length;
    dictionary.set(text, index);
    strings.push(text);
    return index;
  }
  const rows: IndexRow[] = trees.map((tree, i) => [
    tree.sourceId,
    tree.position?.[0] ?? null,
    tree.position?.[1] ?? null,
    code(tree.tag),
    code(tree.scientificName),
    code(tree.commonName),
    code(tree.location),
    Math.floor(i / DETAIL_PAGE_SIZE),
  ]);
  const compact = compactIndexSchema.parse({ version: 2, dataset, release, strings, rows });
  // Opaque filenames prevent hosts from treating the stored gzip bytes as HTTP Content-Encoding.
  // The browser verifies these exact bytes, then explicitly decompresses them in the worker.
  const details = [];
  for (let offset = 0; offset < trees.length; offset += DETAIL_PAGE_SIZE) {
    const slice = trees.slice(offset, offset + DETAIL_PAGE_SIZE);
    const shard = releaseSchema.parse({ version: 1, dataset, release, trees: slice });
    details.push(asset(`detail-${Math.floor(offset / DETAIL_PAGE_SIZE)}.bin`, shard, slice.length));
  }
  const textRows: IndexRow[] = rows.map((row) => [
    row[0],
    null,
    null,
    row[3],
    row[4],
    row[5],
    row[6],
    row[7],
  ]);
  const textIndex = {
    ...store(
      "text.bin",
      gzipSync(encodeTextColumns({ ...compact, rows: textRows }), { level: 9 }),
      trees.length,
    ),
    encoding: "text-columns-v1" as const,
  };
  // Exact float64 coordinates keep row order; the descriptor binds both assets to one release.
  const geometryBytes = Buffer.alloc(rows.length * 16);
  const value = Buffer.alloc(8);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) throw new Error("Missing geometry row.");
    for (let column = 0; column < 2; column++) {
      value.writeDoubleLE((column === 0 ? row[1] : row[2]) ?? Number.NaN);
      for (let lane = 0; lane < 8; lane++)
        geometryBytes[column * rows.length * 8 + lane * rows.length + i] = value[lane] ?? 0;
    }
  }
  const geometry = store("geometry.bin", gzipSync(geometryBytes, { level: 9 }), trees.length);
  const descriptor = indexDescriptorSchema.parse({
    version: 3,
    dataset,
    release,
    index: textIndex,
    geometry,
    details,
  });
  const bytes = JSON.stringify(descriptor);
  const map = packMap(dataset, release, trees);
  files.push(...map.files);
  return { bytes, files, descriptor, map: map.asset };
}
