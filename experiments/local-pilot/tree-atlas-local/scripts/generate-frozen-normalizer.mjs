// Build-time only. Ship pinned Unicode 17 tables, never host-browser properties.
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
assert.equal(process.versions.unicode, "17.0");
const icu = resolve(root, "../tree-atlas-carbon-inventory-api/unicode/tools/icu/usr/local");
const build = resolve(root, ".local-tools");
mkdirSync(build, { recursive: true });
const command = [
  "-O2",
  "-I" + resolve(icu, "include"),
  resolve(root, "scripts/frozen-unicode-ccc.c"),
  "-L" + resolve(icu, "lib"),
  "-licuuc",
  "-licudata",
  "-o",
  resolve(build, "ccc"),
];
let result = spawnSync("gcc", command, { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
result = spawnSync(resolve(build, "ccc"), [], {
  encoding: "utf8",
  env: { ...process.env, LD_LIBRARY_PATH: resolve(icu, "lib") },
});
assert.equal(result.status, 0, result.stderr);
const ccc = JSON.parse(result.stdout);
const nfd = {},
  lower = {};
const properties = {
  diacritic: /\p{Diacritic}/u,
  cased: /\p{Cased}/u,
  ignorable: /\p{Case_Ignorable}/u,
};
const ranges = { diacritic: [], cased: [], ignorable: [] };
const starts = { diacritic: null, cased: null, ignorable: null };
for (let cp = 0; cp <= 0x110000; cp++) {
  const valid = cp < 0x110000 && (cp < 0xd800 || cp > 0xdfff);
  const char = valid ? String.fromCodePoint(cp) : "";
  if (valid) {
    const decomposition = char.normalize("NFD");
    if (decomposition !== char && !(cp >= 0xac00 && cp < 0xac00 + 11172)) nfd[cp] = decomposition;
    const lowered = char.toLowerCase();
    if (lowered !== char) lower[cp] = lowered;
  }
  for (const name of Object.keys(properties)) {
    const yes = valid && properties[name].test(char);
    if (yes && starts[name] === null) starts[name] = cp;
    if (!yes && starts[name] !== null) {
      ranges[name].push([starts[name], cp - 1]);
      starts[name] = null;
    }
  }
}
const data = { version: "Unicode 17.0 / ICU 78.3", nfd, lower, ccc, ...ranges };
writeFileSync(resolve(root, "src/frozen-normalizer-data.json"), JSON.stringify(data) + "\n");
console.log(
  JSON.stringify({
    unicode: "17.0",
    nfd: Object.keys(nfd).length,
    lower: Object.keys(lower).length,
    ccc: Object.keys(ccc).length,
    bytes: Buffer.byteLength(JSON.stringify(data)),
  }),
);
