import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { encodeIndexColumns } from "../src/index-codec.ts";
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
  const jsonBytes = gzipSync(JSON.stringify(compact), { level: 9 });
  const columnBytes = gzipSync(encodeIndexColumns(compact), { level: 9 });
  const useColumns = columnBytes.length < jsonBytes.length;
  const index = {
    ...store("index.bin", useColumns ? columnBytes : jsonBytes, trees.length),
    ...(useColumns ? { encoding: "columns-v1" } : {}),
  };
  const details = [];
  for (let offset = 0; offset < trees.length; offset += DETAIL_PAGE_SIZE) {
    const slice = trees.slice(offset, offset + DETAIL_PAGE_SIZE);
    const shard = releaseSchema.parse({ version: 1, dataset, release, trees: slice });
    details.push(asset(`detail-${Math.floor(offset / DETAIL_PAGE_SIZE)}.bin`, shard, slice.length));
  }
  const descriptor = indexDescriptorSchema.parse({ version: 2, dataset, release, index, details });
  const bytes = JSON.stringify(descriptor);
  return { bytes, files, descriptor };
}
