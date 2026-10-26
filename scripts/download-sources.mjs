import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Whole-inventory acquisition. No study-window filters are applied.
// Only a fully validated acquisition replaces the last-good raw manifest.
const root = fileURLToPath(new URL("../data/raw/", import.meta.url));
const requestLog = [];
async function get(url, mode = "json") {
  let failure;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      const body = await response.text();
      const parsed = mode === "text" ? body : JSON.parse(body);
      if (parsed?.error) throw new Error(`Source error: ${JSON.stringify(parsed.error)}`);
      requestLog.push({
        url: String(url),
        retrievedAt: new Date().toISOString(),
        sha256: createHash("sha256").update(body).digest("hex"),
      });
      return parsed;
    } catch (error) {
      failure = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw failure;
}
function endpoint(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.href;
}
function assert(value, message) {
  if (!value) throw new Error(message);
}
function unique(features, key) {
  const seen = new Set();
  for (const feature of features) {
    const value = key(feature);
    assert(value !== undefined && value !== null, "Missing source ID");
    const id = String(value);
    assert(!seen.has(id), `Duplicate source row ID: ${id}`);
    seen.add(id);
  }
}
function geometryAudit(features, dataset) {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  const audit = { valid: 0, missing: 0, invalid: 0, examples: [] };
  for (const feature of features) {
    const geometry = feature.geometry;
    const id =
      dataset === "geneva"
        ? feature.attributes?.OBJECTID
        : feature.properties?.[dataset === "porto" ? "objectid" : "OBJECTID"];
    const coordinates =
      dataset === "geneva" ? (geometry ? [geometry.x, geometry.y] : null) : geometry?.coordinates;
    let reason = null;
    if (!geometry) {
      audit.missing += 1;
      reason = "missing geometry";
    } else if (
      (dataset !== "geneva" && geometry.type !== "Point") ||
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1]) ||
      Math.abs(coordinates[0]) > 180 ||
      Math.abs(coordinates[1]) > 90
    ) {
      audit.invalid += 1;
      reason = "invalid WGS84 point";
    } else {
      const [x, y] = coordinates;
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
      audit.valid += 1;
    }
    if (reason && audit.examples.length < 20) audit.examples.push({ sourceRowId: id, reason });
  }
  assert(
    audit.valid > 0 && west < east && south < north,
    `${dataset}: no usable geographic extent`,
  );
  return { bbox: [west, south, east, north], geometryAudit: audit };
}
async function vienna() {
  const base = "https://data.wien.gv.at/daten/geo";
  const params = {
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: "ogdwien:BAUMKATOGD",
    srsName: "EPSG:4326",
  };
  async function count() {
    const hits = await get(endpoint(base, { ...params, resultType: "hits" }), "text");
    const match = /numberOfFeatures="(\d+)"/u.exec(hits);
    assert(match !== null, "Vienna did not return a WFS count");
    return Number(match[1]);
  }
  const expected = await count();
  assert(expected > 0, "Vienna unexpectedly empty");
  const features = [];
  let last = -1;
  while (true) {
    const page = await get(
      endpoint(base, {
        ...params,
        outputFormat: "json",
        maxFeatures: 10_000,
        sortBy: "OBJECTID A",
        CQL_FILTER: `OBJECTID>${last}`,
      }),
    );
    assert(
      page.type === "FeatureCollection" && Array.isArray(page.features),
      "Vienna returned invalid GeoJSON",
    );
    if (page.features.length === 0) break;
    for (const feature of page.features) {
      const id = feature.properties?.OBJECTID;
      assert(Number.isSafeInteger(id) && id > last, "Vienna keyset order invalid or repeated row");
      last = id;
      features.push(feature);
    }
    assert(features.length <= expected, "Vienna grew during acquisition");
    console.log(`Vienna ${features.length}/${expected}`);
  }
  assert(
    features.length === expected && (await count()) === expected,
    "Vienna count changed or acquisition incomplete",
  );
  return {
    body: { type: "FeatureCollection", features },
    count: features.length,
    upstreamCount: expected,
    ...geometryAudit(features, "vienna"),
    completeness:
      "All WFS rows fetched by strictly increasing OBJECTID keyset; final empty tail and before/after counts verified. The source does not offer a transaction snapshot, so concurrent updates with unchanged count cannot be excluded.",
  };
}
async function geneva() {
  const base =
    "https://vector.sitg.ge.ch/arcgis/rest/services/SIPV_ICA_ARBRE_ISOLE/FeatureServer/0/query";
  const query = { f: "json", where: "1=1", returnIdsOnly: true };
  const ids = await get(endpoint(base, query));
  assert(
    Array.isArray(ids.objectIds) && ids.objectIds.length > 0 && !ids.exceededTransferLimit,
    "Geneva ID query failed or truncated",
  );
  const expected = new Set(ids.objectIds);
  assert(expected.size === ids.objectIds.length, "Geneva duplicate object IDs");
  const countBefore = await get(endpoint(base, { f: "json", where: "1=1", returnCountOnly: true }));
  assert(countBefore.count === expected.size, "Geneva count and ID query disagree");
  const outFields =
    "OBJECTID,ID_ARBRE,NO_INVENTAIRE,NOM_COMPLET,HAUTEUR_TOTALE,DIAMETRE_COURONNE,CIRCONFERENCE_1M,DATE_PLANTATION,DATE_PLANTATION_ESTIMEE,DATE_OBSERVATION,SOUCHE,STATUT,SITUATION";
  const batches = [];
  for (let offset = 0; offset < ids.objectIds.length; offset += 300)
    batches.push(ids.objectIds.slice(offset, offset + 300));
  const pages = new Array(batches.length);
  let next = 0,
    completed = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < batches.length) {
        const index = next++;
        const batch = batches[index];
        const page = await get(
          endpoint(base, {
            f: "json",
            objectIds: batch.join(","),
            outFields,
            returnGeometry: true,
            outSR: 4326,
          }),
        );
        assert(
          Array.isArray(page.features) && !page.exceededTransferLimit,
          "Geneva returned an error or truncated page",
        );
        const received = new Set(page.features.map((f) => f.attributes.OBJECTID));
        assert(
          page.features.length === batch.length &&
            received.size === batch.length &&
            batch.every((id) => received.has(id)),
          "Geneva incomplete batch or duplicate record",
        );
        pages[index] = page.features;
        completed += 1;
        if (completed % 30 === 0 || completed === batches.length)
          console.log(`Geneva ${completed}/${batches.length} batches`);
      }
    }),
  );
  const features = pages.flat();
  unique(features, (f) => f.attributes.OBJECTID);
  const stableCounts = new Map();
  let missingStableIds = 0;
  for (const feature of features) {
    const id = feature.attributes.ID_ARBRE;
    if (id === null || id === undefined) {
      missingStableIds += 1;
      continue;
    }
    stableCounts.set(String(id), (stableCounts.get(String(id)) ?? 0) + 1);
  }
  const identityConflicts = [...stableCounts]
    .filter(([, count]) => count > 1)
    .map(([sourceKey, count]) => ({ sourceKey, count }));
  const finalIds = await get(endpoint(base, query));
  assert(
    Array.isArray(finalIds.objectIds) &&
      !finalIds.exceededTransferLimit &&
      finalIds.objectIds.length === expected.size &&
      new Set(finalIds.objectIds).size === expected.size &&
      finalIds.objectIds.every((id) => expected.has(id)),
    "Geneva membership changed during acquisition",
  );
  return {
    body: { spatialReference: { wkid: 4326 }, features },
    count: features.length,
    upstreamCount: expected.size,
    identityConflicts,
    missingStableIds,
    ...geometryAudit(features, "geneva"),
    completeness:
      "All canton-wide source object IDs fetched in validated batches of 300 with six concurrent requests; initial count and final membership verified. Not a transactionally consistent upstream snapshot.",
  };
}
async function porto() {
  const metadata = await get(
    "https://dadosabertos.cm-porto.pt/api/3/action/package_show?id=identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto",
  );
  assert(
    metadata.success && metadata.result.license_id === "cc-zero",
    "Review changed Porto metadata/licence before import",
  );
  const url =
    "https://dadosabertos.cm-porto.pt/dataset/7177befc-9e19-11f1-84ed-6abdb6d5cf34/resource/d0a25fb0-b28d-44d3-b0a6-a77fa63c4264/download/identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto_geojson.geojson";
  const body = await get(url);
  assert(
    body.type === "FeatureCollection" && Array.isArray(body.features) && body.features.length > 0,
    "Porto download is not a non-empty FeatureCollection",
  );
  unique(body.features, (f) => f.properties.objectid);
  return {
    body,
    count: body.features.length,
    upstreamCount: body.features.length,
    ...geometryAudit(body.features, "porto"),
    completeness:
      "The complete published GeoJSON resource was downloaded without geographic filtering. No independent upstream total is published.",
    sourceUpdatedAt: metadata.result.metadata_modified,
  };
}
const sources = {
  vienna: {
    acquire: vienna,
    title: "Stadt Wien — Baumkataster",
    url: "https://www.data.gv.at/datasets/c91a4635-8b7d-43fe-9b27-d95dec8392a7",
    licence: "CC BY 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Datenquelle: Stadt Wien — data.wien.gv.at",
    identity: "OBJECTID; release-scoped (permanent stability not established)",
    coverage:
      "Complete available Vienna public-tree source inventory. This does not include every physical tree, private trees or all forest trees.",
  },
  geneva: {
    acquire: geneva,
    title: "SITG — Inventaire cantonal des arbres isolés",
    url: "https://sitg.ge.ch/donnees/sipv-ica-arbre-isole",
    licence: "SITG A — Accès libre",
    licenceUrl: "https://sitg.ge.ch/ressources/conditions-utilisation-donnees",
    attribution: "Données SITG / Ville de Genève",
    identity:
      "ID_ARBRE is documented stable but duplicate or missing IDs require release-scoped object-qualified identity. OBJECTID is not permanent.",
    coverage:
      "Complete available canton-wide inventory of isolated trees outside forests. Historical positions may be inaccurate by about 25 m; recent surveys about 1 m.",
  },
  porto: {
    acquire: porto,
    title: "Município do Porto — Identificação e caracterização do arvoredo",
    url: "https://dadosabertos.cm-porto.pt/dataset/identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto",
    licence: "CC0 1.0",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attribution: "Município do Porto",
    identity: "objectid; release-scoped (permanent stability not established)",
    coverage:
      "Complete published public-domain municipal tree inventory. The age field is an interval, not a planting year; private trees are not covered.",
  },
};
await mkdir(root, { recursive: true });
const prepared = [];
for (const [id, { acquire, ...metadata }] of Object.entries(sources)) {
  const start = requestLog.length;
  const { body, ...result } = await acquire();
  const text = JSON.stringify(body);
  const sha256 = createHash("sha256").update(text).digest("hex");
  const file = `${id}-${sha256.slice(0, 16)}.json`;
  await writeFile(join(root, file), text);
  prepared.push({
    id,
    scope: "full",
    file,
    sha256,
    ...metadata,
    ...result,
    coordinateReferenceSystem: "EPSG:4326",
    retrievedAt: new Date().toISOString(),
    requests: requestLog.slice(start),
    processing:
      "No geographic filtering. Source records retained, including geometry problems reported separately; Geneva observer identities omitted. No proximity deduplication.",
  });
  console.log(
    `${id}: ${result.count} records (${file}); geometry ${JSON.stringify(result.geometryAudit)}`,
  );
}
const temporary = join(root, `provenance-${process.pid}.tmp`);
await writeFile(
  temporary,
  `${JSON.stringify({ schemaVersion: 1, acquiredAt: new Date().toISOString(), sources: prepared }, null, 2)}\n`,
);
await rename(temporary, join(root, "original-provenance.json"));
