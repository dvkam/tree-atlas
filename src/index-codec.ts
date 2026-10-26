import { z } from "zod";
import { datasetIdSchema } from "./domain.ts";
import { compactIndexSchema } from "./index-format.ts";
import type { CompactIndex, IndexRow } from "./index-format.ts";

const headerSchema = z.object({
  version: z.literal(3),
  dataset: datasetIdSchema,
  release: z.string(),
  strings: z.array(z.string()),
  ids: z.array(z.string().min(1)).min(1),
});
const BYTES_PER_ROW = 36;
const MAX_INT32 = 2_147_483_647;

/** Byte planes group equal-significance bytes without rounding coordinates or numeric IDs. */
export function encodeIndexColumns(input: CompactIndex): Uint8Array {
  const index = compactIndexSchema.parse(input);
  const header = new TextEncoder().encode(
    JSON.stringify({
      version: 3,
      dataset: index.dataset,
      release: index.release,
      strings: index.strings,
      ids: index.rows.map((row) => row[0]),
    }),
  );
  const count = index.rows.length;
  const bytes = new Uint8Array(4 + header.length + count * BYTES_PER_ROW);
  new DataView(bytes.buffer).setUint32(0, header.length, true);
  bytes.set(header, 4);
  const value = new DataView(new ArrayBuffer(8));
  let offset = 4 + header.length;
  for (let column = 1; column < 8; column += 1) {
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
  if (bytes.byteLength !== 4 + headerLength + count * BYTES_PER_ROW)
    throw new Error("Inventory column payload length does not match its record count.");
  const rows: IndexRow[] = header.ids.map((id) => [id, null, null, -1, -1, -1, -1, 0]);
  const value = new DataView(new ArrayBuffer(8));
  let offset = 4 + headerLength;
  for (let column = 1; column < 8; column += 1) {
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
  return compactIndexSchema.parse({
    version: 2,
    dataset: header.dataset,
    release: header.release,
    strings: header.strings,
    rows,
  });
}
