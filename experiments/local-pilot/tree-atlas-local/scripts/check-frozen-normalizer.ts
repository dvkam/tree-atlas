import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { normalizeFrozenText, validateFrozenQueryText } from "../src/frozen-normalizer.ts";
assert.equal(process.versions["unicode"], "17.0");
const started = performance.now();
let cases = 0;
function check(value: string): void {
  const expected = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
  assert.equal(normalizeFrozenText(value), expected, `Unicode parity ${JSON.stringify(value)}`);
  cases++;
}
for (let code = 0; code < 0x110000; code++) {
  if (code >= 0xd800 && code <= 0xdfff) continue;
  check(String.fromCodePoint(code));
}
const contexts = [
  "AΣ",
  "AΣA",
  "Σ",
  "ΟΣ",
  "A'Σ",
  "AΣ'",
  "AΣ'A",
  "AΣ\u0345",
  "A\u0345Σ",
  "AΣ\u200dA",
  "AΣ\u200d",
  "AΣ\u0300B",
  "\ufeff  İstanbul \u00a0",
  "A\u0315\u0300",
  "A\u{1d16d}\u{1d166}",
  "\u{1d16d}\u{1d166}",
  "A️",
  "Aʰ",
  "가각각",
  "\0A",
  "Straße",
  "Łódź",
];
for (const value of contexts) check(value);
let seed = 0x19890321;
function random(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}
const alphabet = [
  "A",
  "Σ",
  "σ",
  "ς",
  "'",
  "\u0345",
  "\u0300",
  "\u0315",
  "\u200d",
  "\u{1d166}",
  "\u{1d16d}",
  "가",
  "İ",
  "\ufeff",
  "\0",
];
for (let index = 0; index < 20000; index++) {
  let value = "";
  for (let at = 0; at < 12; at++) {
    if (random() % 3 === 0) {
      let code = random() % 0x110000;
      if (code >= 0xd800 && code <= 0xdfff) code = 0x41;
      value += String.fromCodePoint(code);
    } else value += alphabet[random() % alphabet.length] ?? "A";
  }
  check(value);
}
assert.throws(() => normalizeFrozenText("\ud800"));
assert.throws(() => validateFrozenQueryText("🌳".repeat(251)));
validateFrozenQueryText("🌳".repeat(250));
const report = {
  passed: true,
  node: process.version,
  unicode: process.versions["unicode"],
  cases,
  allScalarCases: 1112064,
  randomContexts: 20000,
  explicitContexts: contexts.length,
  elapsedMs: Math.round(performance.now() - started),
  tableSource:
    "Pinned Node Unicode 17 mappings/properties and official ICU 78.3 canonical combining classes; runtime uses generated tables, not browser Unicode",
};
mkdirSync(new URL("../evidence/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../evidence/browser-normalizer-parity.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
