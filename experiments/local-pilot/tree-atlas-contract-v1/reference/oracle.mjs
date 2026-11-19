// Independent specification interpreter. No Tree Atlas production imports.
import { createHash } from 'node:crypto';

export const fields = ['sourceId', 'tag', 'scientificName', 'commonName', 'location'];
export function assertRuntime() {
  if (process.versions.unicode !== '17.0')
    throw new Error(`Frozen Unicode 17.0 is required; observed ${process.versions.unicode}`);
}
export function normalize(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
export function validateText(text) {
  if (typeof text !== 'string' || text.length > 500 || !text.isWellFormed())
    throw new Error('Invalid scalar text or text limit');
}
export function inside(box, position) {
  return position !== null && position[0] >= box[0] && position[0] <= box[2] &&
    position[1] >= box[1] && position[1] <= box[3];
}
export function validateQuery(query) {
  validateText(query.q);
  if (!Number.isSafeInteger(query.offset) || query.offset < 0 ||
      !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100 ||
      !Number.isFinite(query.zoom) || query.zoom < 0 || query.zoom > 24)
    throw new Error('Invalid query');
  for (const box of [query.area, query.viewport]) {
    if (box === null) continue;
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) ||
        box[0] < -180 || box[2] > 180 || box[1] < -90 || box[3] > 90 ||
        box[0] >= box[2] || box[1] >= box[3]) throw new Error('Invalid bounds');
  }
  if (query.viewport === null) throw new Error('Viewport required');
}
export function queryKey(dataset, release, query) {
  validateQuery(query);
  return sha256(JSON.stringify(['tree-atlas-search-release-v1', dataset, release,
    normalize(query.q), query.area, query.viewport, query.zoom, query.offset, query.limit]));
}
export function matches(row, query, normalizer = normalize) {
  if (query.area !== null && !inside(query.area, row.position)) return false;
  const term = normalizer(query.q);
  return term === '' || fields.some((field) => row[field] !== null &&
    normalizer(row[field]).indexOf(term) !== -1);
}
export function interpret(rows, query, predicate = matches) {
  validateQuery(query);
  const selected = rows.filter((row) => predicate(row, query));
  const visible = selected.filter((row) => inside(query.viewport, row.position));
  return {
    ids: selected.map((row) => row.sourceId), total: selected.length,
    items: selected.slice(query.offset, query.offset + query.limit).map((row) => row.sourceId),
    locatedTotal: selected.filter((row) => row.position !== null).length,
    viewportLocatedTotal: visible.length, viewportIds: visible.map((row) => row.sourceId),
  };
}
export function suggest(dictionary, text) {
  validateText(text);
  const term = normalize(text);
  if (term.length < 2) return [];
  const answers = [];
  for (const original of dictionary) {
    if (!answers.includes(original) && normalize(original).indexOf(term) !== -1)
      answers.push(original);
    if (answers.length === 8) break;
  }
  return answers;
}
export function identityLine(dataset, release, sourceId) {
  return JSON.stringify([dataset, release, sourceId]) + '\n';
}
export function contentLine(ordinal, row) {
  // Fixed tuple order; ignore JSON object insertion order. Null and empty stay distinct.
  return JSON.stringify([ordinal, ...['dataset', 'sourceId', 'idScope', 'position',
    'tag', 'scientificName', 'commonName', 'location', 'height', 'crown',
    'circumference', 'plantingYear', 'plantingEstimated', 'age', 'observedAt',
    'status', 'qualityNotes'].map((field) => canonical(row[field] ?? null))]) + '\n';
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
