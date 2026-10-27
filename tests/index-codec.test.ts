import { describe, expect, it } from "vitest";
import {
  encodeIndexColumns,
  decodeIndexColumns,
  encodeTextColumns,
  decodeTextColumns,
} from "../src/index-codec.ts";
import type { CompactIndex } from "../src/index-format.ts";

const index: CompactIndex = {
  version: 2,
  dataset: "vienna",
  release: "codec-test",
  strings: ["Acer", "Straße 🌳", "00012"],
  rows: [
    ["000001", 16.39416123456789, 48.20717123456789, 2, 0, -1, 1, 0],
    ["900719925474099312345", -180, -90, -1, 0, 0, -1, 1],
    ["null-position", null, null, -1, -1, -1, -1, 1],
    ["edge", 180, 90, 0, 1, 2, -1, 1],
    ["zero", -0, Number.MIN_VALUE, -1, -1, -1, -1, 1],
  ],
};
function mutateCoordinate(bytes: Uint8Array, column: number, row: number, replacement: number) {
  const copy = bytes.slice();
  const length = new DataView(copy.buffer).getUint32(0, true);
  const start = 4 + length + column * index.rows.length * 8;
  const value = new DataView(new ArrayBuffer(8));
  value.setFloat64(0, replacement, true);
  for (let lane = 0; lane < 8; lane += 1)
    copy[start + lane * index.rows.length + row] = value.getUint8(lane);
  return copy;
}

describe("lossless inventory columns", () => {
  it("preserves precise coordinates, opaque IDs, Unicode and absent positions", () => {
    expect(decodeIndexColumns(encodeIndexColumns(index))).toEqual(index);
  });
  it("accepts a view with a nonzero byte offset", () => {
    const encoded = encodeIndexColumns(index);
    const outer = new Uint8Array(encoded.length + 13);
    outer.set(encoded, 7);
    expect(decodeIndexColumns(outer.subarray(7, 7 + encoded.length))).toEqual(index);
  });
  it("rejects truncated headers, oversized headers, short payloads and trailing bytes", () => {
    const bytes = encodeIndexColumns(index);
    expect(() => decodeIndexColumns(bytes.subarray(0, 3))).toThrow(
      "Truncated inventory column header",
    );
    const badHeader = bytes.slice();
    new DataView(badHeader.buffer).setUint32(0, 0xffffffff, true);
    expect(() => decodeIndexColumns(badHeader)).toThrow("header exceeds");
    expect(() => decodeIndexColumns(bytes.subarray(0, bytes.length - 1))).toThrow("payload length");
    const extra = new Uint8Array(bytes.length + 1);
    extra.set(bytes);
    expect(() => decodeIndexColumns(extra)).toThrow("payload length");
  });
  it("rejects infinity, out-of-range coordinates and half-missing positions", () => {
    const bytes = encodeIndexColumns(index);
    for (const value of [Infinity, -Infinity, 181, NaN])
      expect(() => decodeIndexColumns(mutateCoordinate(bytes, 0, 0, value))).toThrow(
        /Invalid|Too big|Both coordinates/u,
      );
  });
  it("rejects integer overflow before encoding rather than silently wrapping", () => {
    const overflow: CompactIndex = {
      ...index,
      rows: [["overflow", 1, 1, 2_147_483_648, -1, -1, -1, 0]],
    };
    expect(() => encodeIndexColumns(overflow)).toThrow("integer storage range");
  });
});

describe("complete text columns", () => {
  const text: CompactIndex = {
    ...index,
    rows: index.rows.map((row) => [row[0], null, null, row[3], row[4], row[5], row[6], row[7]]),
  };
  it("preserves all text references and opaque identities without coordinate planes", () => {
    expect(decodeTextColumns(encodeTextColumns(text))).toEqual(text);
    expect(encodeIndexColumns(text).length - encodeTextColumns(text).length).toBe(
      text.rows.length * 16,
    );
    expect(() => encodeTextColumns(index)).toThrow("cannot contain coordinates");
    expect(() => decodeTextColumns(encodeIndexColumns(text))).toThrow("Unexpected");
    expect(() => decodeIndexColumns(encodeTextColumns(text))).toThrow("Unexpected");
  });
  it("rejects invalid references and payload lengths without a cloning schema pass", () => {
    const bytes = encodeTextColumns(text);
    const start = new DataView(bytes.buffer).getUint32(0, true) + 4;
    const corrupt = bytes.slice();
    for (let lane = 0; lane < 4; lane++)
      corrupt[start + lane * text.rows.length] = lane === 0 ? 254 : 255;
    expect(() => decodeTextColumns(corrupt)).toThrow("Invalid text column reference");
    expect(() => decodeTextColumns(bytes.subarray(0, bytes.length - 1))).toThrow("payload length");
  });
});
