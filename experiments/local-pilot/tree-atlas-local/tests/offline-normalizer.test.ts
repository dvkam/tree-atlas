import { describe, expect, it } from "vitest";
import { normalizeFrozenText, validateFrozenQueryText } from "../src/frozen-normalizer.ts";

describe("pinned Unicode 17 browser search", () => {
  it("uses literal multilingual answers independently of browser locale", () => {
    for (const [input, expected] of [
      [" İstanbul ", "istanbul"],
      ["Straße", "straße"],
      ["Łódź", "łodz"],
      ["A  B", "a  b"],
      ["ΟΣ", "ος"],
      ["AΣA", "aσa"],
      ["AΣ'", "aς'"],
      ["AΣ'A", "aσ'a"],
      ["A️", "a️"],
      ["Aʰ", "a"],
      ["각", "각"],
    ])
      expect(normalizeFrozenText(input ?? "")).toBe(expected);
  });
  it("keeps NUL and literal punctuation and applies the exact trim set", () => {
    expect(normalizeFrozenText("\ufeff%_\\\0\u00a0")).toBe("%_\\\0");
    expect(normalizeFrozenText("\u0085A\u0085")).toBe("\u0085a\u0085");
  });
  it("rejects malformed scalars and counts UTF-16 query units", () => {
    expect(() => normalizeFrozenText("\ud800")).toThrow("invalid Unicode");
    expect(() => validateFrozenQueryText("🌳".repeat(250))).not.toThrow();
    expect(() => validateFrozenQueryText("🌳".repeat(251))).toThrow("500 UTF-16");
  });
});
