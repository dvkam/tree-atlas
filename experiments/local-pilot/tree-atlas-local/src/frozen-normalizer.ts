import data from "./frozen-normalizer-data.json";

const decompositions: Readonly<Record<string, string>> = data.nfd;
const lowercase: Readonly<Record<string, string>> = data.lower;
const classes: Readonly<Record<string, number>> = data.ccc;
function member(ranges: readonly (readonly number[])[], code: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (range === undefined || range[0] === undefined || range[1] === undefined)
      throw new Error("Pinned Unicode data is incomplete.");
    if (code < range[0]) high = middle - 1;
    else if (code > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}
function trim(code: number): boolean {
  return (
    code === 9 ||
    code === 10 ||
    code === 11 ||
    code === 12 ||
    code === 13 ||
    code === 32 ||
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12288 ||
    code === 65279
  );
}
/** Frozen Unicode 17 behavior. No browser Unicode tables or locale are consulted. */
export function normalizeFrozenText(text: string): string {
  if (!text.isWellFormed()) throw new Error("Search text contains invalid Unicode.");
  // ASCII mappings have been stable since Unicode 1 and avoid a million table
  // walks for numeric inventory IDs. End trimming still follows the same rule.
  let ascii = true;
  for (let at = 0; at < text.length; at++)
    if (text.charCodeAt(at) > 127) {
      ascii = false;
      break;
    }
  if (ascii)
    return text
      .replace(/[\^`]/gu, "")
      .toLowerCase()
      .replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/gu, "");
  const normalized: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) throw new Error("Invalid scalar text.");
    let parts: string;
    if (code >= 0xac00 && code < 0xac00 + 11172) {
      const index = code - 0xac00;
      const tail = index % 28;
      parts = String.fromCodePoint(
        0x1100 + Math.floor(index / 588),
        0x1161 + Math.floor((index % 588) / 28),
      );
      if (tail !== 0) parts += String.fromCodePoint(0x11a7 + tail);
    } else parts = decompositions[String(code)] ?? char;
    for (const part of parts) {
      const scalar = part.codePointAt(0);
      if (scalar === undefined) throw new Error("Invalid decomposition.");
      const combining = classes[String(scalar)] ?? 0;
      normalized.push(scalar);
      if (combining === 0) continue;
      let at = normalized.length - 1;
      while (at > 0) {
        const before = normalized[at - 1];
        if (before === undefined) throw new Error("Invalid decomposition order.");
        const previous = classes[String(before)] ?? 0;
        if (previous === 0 || previous <= combining) break;
        normalized[at] = before;
        normalized[--at] = scalar;
      }
    }
  }
  const filtered = normalized.filter((code) => !member(data.diacritic, code));
  let output = "";
  for (let index = 0; index < filtered.length; index++) {
    const code = filtered[index];
    if (code === undefined) throw new Error("Invalid normalized text.");
    if (code === 0x03a3) {
      let before = index - 1;
      while (before >= 0 && member(data.ignorable, filtered[before] ?? -1)) before--;
      let after = index + 1;
      while (after < filtered.length && member(data.ignorable, filtered[after] ?? -1)) after++;
      const final =
        before >= 0 &&
        member(data.cased, filtered[before] ?? -1) &&
        !(after < filtered.length && member(data.cased, filtered[after] ?? -1));
      output += final ? "ς" : "σ";
    } else output += lowercase[String(code)] ?? String.fromCodePoint(code);
  }
  let start = 0;
  let end = output.length;
  while (start < end && trim(output.charCodeAt(start))) start++;
  while (end > start && trim(output.charCodeAt(end - 1))) end--;
  return output.slice(start, end);
}

export function validateFrozenQueryText(text: string): void {
  if (text.length > 500 || !text.isWellFormed())
    throw new Error("Use at most 500 UTF-16 units of valid text.");
}
