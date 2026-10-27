import { z } from "zod";
import { datasetIdSchema } from "./domain.ts";
import { compactIndexSchema } from "./index-format.ts";
import type { CompactIndex, IndexRow } from "./index-format.ts";

const headerSchema = z.object({
  version: z.union([z.literal(3), z.literal(4)]),
  dataset: datasetIdSchema,
  release: z.string(),
  strings: z.array(z.string()),
  ids: z.array(z.string().min(1)).min(1),
});
const BYTES_PER_ROW = 36;
const MAX_INT32 = 2_147_483_647;

/** Byte planes group equal-significance bytes without rounding coordinates or numeric IDs. */
export function encodeIndexColumns(input: CompactIndex): Uint8Array {
  return encodeColumns(input, false);
}
export function encodeTextColumns(input: CompactIndex): Uint8Array {
  if (input.rows.some((row) => row[1] !== null || row[2] !== null))
    throw new Error("Text columns cannot contain coordinates.");
  return encodeColumns(input, true);
}
function encodeColumns(input: CompactIndex, textOnly: boolean): Uint8Array {
  const index = compactIndexSchema.parse(input);
  const header = new TextEncoder().encode(
    JSON.stringify({
      version: textOnly ? 4 : 3,
      dataset: index.dataset,
      release: index.release,
      strings: index.strings,
      ids: index.rows.map((row) => row[0]),
    }),
  );
  const count = index.rows.length;
  const bytes = new Uint8Array(4 + header.length + count * (textOnly ? 20 : BYTES_PER_ROW));
  new DataView(bytes.buffer).setUint32(0, header.length, true);
  bytes.set(header, 4);
  const value = new DataView(new ArrayBuffer(8));
  let offset = 4 + header.length;
  for (let column = textOnly ? 3 : 1; column < 8; column += 1) {
    const width = column < 3 ? 8 : 4;
    for (let i = 0; i < count; i += 1) {
      const row = index.rows[i];
      const number = row?.[column];
      if (number === undefined || typeof number === "string")
        throw new Error("Missing inventory column value.");
      if (column < 3) value.setFloat64(0, number === null ? Number.NaN : number, true);
      else {
        if (number === null || number > MAX_INT32)
          throw new Error("Inventory column exceeds its integer storage range.");
        value.setInt32(0, number, true);
      }
      for (let lane = 0; lane < width; lane += 1)
        bytes[offset + lane * count + i] = value.getUint8(lane);
    }
    offset += width * count;
  }
  return bytes;
}

export function decodeIndexColumns(bytes: Uint8Array): CompactIndex {
  return decodeColumns(bytes, false);
}
export function decodeTextColumns(bytes: Uint8Array): CompactIndex {
  return decodeColumns(bytes, true);
}
function decodeColumns(bytes: Uint8Array, textOnly: boolean): CompactIndex {
  if (bytes.byteLength < 4) throw new Error("Truncated inventory column header.");
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  if (headerLength > bytes.byteLength - 4)
    throw new Error("Inventory column header exceeds the asset length.");
  const header = headerSchema.parse(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + headerLength)),
    ),
  );
  const count = header.ids.length;
  if (header.version !== (textOnly ? 4 : 3))
    throw new Error("Unexpected inventory column encoding.");
  if (bytes.byteLength !== 4 + headerLength + count * (textOnly ? 20 : BYTES_PER_ROW))
    throw new Error("Inventory column payload length does not match its record count.");
  const rows: IndexRow[] = header.ids.map((id) => [id, null, null, -1, -1, -1, -1, 0]);
  const value = new DataView(new ArrayBuffer(8));
  let offset = 4 + headerLength;
  for (let column = textOnly ? 3 : 1; column < 8; column += 1) {
    const width = column < 3 ? 8 : 4;
    for (let i = 0; i < count; i += 1) {
      const row = rows[i];
      if (row === undefined) throw new Error("Missing inventory column row.");
      for (let lane = 0; lane < width; lane += 1) {
        const byte = bytes[offset + lane * count + i];
        if (byte === undefined) throw new Error("Truncated inventory column value.");
        value.setUint8(lane, byte);
      }
      const number = column < 3 ? value.getFloat64(0, true) : value.getInt32(0, true);
      if (textOnly && number < (column === 7 ? 0 : -1))
        throw new Error("Invalid text column reference.");
      const coordinate = Number.isNaN(number) ? null : number;
      switch (column) {
        case 1:
          row[1] = coordinate;
          break;
        case 2:
          row[2] = coordinate;
          break;
        case 3:
          row[3] = number;
          break;
        case 4:
          row[4] = number;
          break;
        case 5:
          row[5] = number;
          break;
        case 6:
          row[6] = number;
          break;
        case 7:
          row[7] = number;
          break;
      }
    }
    offset += width * count;
  }
  const decoded: CompactIndex = {
    version: 2,
    dataset: header.dataset,
    release: header.release,
    strings: header.strings,
    rows,
  };
  // Text rows are valid by construction: IDs and strings were checked above, coordinates
  // are absent, and every integer was range checked while reading. Identity, dictionary
  // and shard references are checked by the public inventory loader.
  return textOnly ? decoded : compactIndexSchema.parse(decoded);
}
