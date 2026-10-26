import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Acquisition is deliberately separate from normalization. Run with Node >=24.
// A failed count/schema check leaves the published app release untouched.
const root = fileURLToPath(new URL("../data/raw/", import.meta.url));
const bounds = {
  vienna: [16.383, 48.202, 16.405, 48.213],
  geneva: [6.135, 46.195, 6.155, 46.212],
  porto: [-8.622, 41.141, -8.599, 41.156],
};
const requestLog = [];
async function get(url, mode = "json") {
  let failure;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
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
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
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
  const ids = features.map(key);
  assert(
    ids.every((id) => id !== undefined && id !== null),
    "Missing source ID",
  );
  assert(
    new Set(ids.map(String)).size === ids.length,
    `Duplicate source IDs: ${ids
      .filter((id, index) => ids.indexOf(id) !== index)
      .slice(0, 5)
      .join(",")}`,
  );
}

async function vienna() {
  const base = "https://data.wien.gv.at/daten/geo";
  const params = {
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: "ogdwien:BAUMKATOGD",
    srsName: "EPSG:4326",
    CQL_FILTER: `BBOX(SHAPE,${bounds.vienna.join(",")},'EPSG:4326')`,
  };
  const hits = await get(endpoint(base, { ...params, resultType: "hits" }), "text");
  const match = /numberOfFeatures="(\d+)"/u.exec(hits);
  assert(match !== null, "Vienna did not return a WFS count");
  const count = Number(match[1]);
  assert(count > 0 && count < 10_000, "Vienna window exceeds pilot limit or is unexpectedly empty");
  const body = await get(
    endpoint(base, { ...params, outputFormat: "json", maxFeatures: count + 1 }),
  );
  assert(
    body.type === "FeatureCollection" &&
      Array.isArray(body.features) &&
      body.features.length === count,
    "Vienna count drift or truncated response",
  );
  unique(body.features, (f) => f.properties.OBJECTID);
  return {
    body,
    count,
    upstreamCount: count,
    completeness: "WFS hit count equals returned records inside the declared window.",
  };
}

async function geneva() {
  const base =
    "https://vector.sitg.ge.ch/arcgis/rest/services/SIPV_ICA_ARBRE_ISOLE/FeatureServer/0/query";
  const query = {
    f: "json",
    where: "1=1",
    geometry: bounds.geneva.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    returnIdsOnly: true,
  };
  const ids = await get(endpoint(base, query));
  assert(
    !ids.error &&
      Array.isArray(ids.objectIds) &&
      ids.objectIds.length > 0 &&
      ids.objectIds.length < 20_000 &&
      !ids.exceededTransferLimit,
    "Geneva ID query failed or exceeded pilot budget",
  );
  assert(new Set(ids.objectIds).size === ids.objectIds.length, "Geneva duplicate object IDs");
  const features = [];
  // Explicit fields avoid importing observer identities and avoid relying on unstable OBJECTID for record identity.
  const outFields =
    "OBJECTID,ID_ARBRE,NO_INVENTAIRE,NOM_COMPLET,HAUTEUR_TOTALE,DIAMETRE_COURONNE,CIRCONFERENCE_1M,DATE_PLANTATION,DATE_PLANTATION_ESTIMEE,DATE_OBSERVATION,SOUCHE,STATUT,SITUATION";
  for (let offset = 0; offset < ids.objectIds.length; offset += 300) {
    const batch = ids.objectIds.slice(offset, offset + 300);
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
      !page.error && Array.isArray(page.features) && !page.exceededTransferLimit,
      "Geneva returned an error or truncated page",
    );
    const received = new Set(page.features.map((f) => f.attributes.OBJECTID));
    assert(
      received.size === batch.length && batch.every((id) => received.has(id)),
      "Geneva record vanished or page was incomplete",
    );
    features.push(...page.features);
  }
  unique(features, (f) => f.attributes.OBJECTID);
  const stableCounts = new Map();
  for (const feature of features) {
    const id = feature.attributes.ID_ARBRE;
    assert(id !== null && id !== undefined, "Geneva stable ID missing");
    stableCounts.set(String(id), (stableCounts.get(String(id)) ?? 0) + 1);
  }
  const identityConflicts = [...stableCounts]
    .filter(([, count]) => count > 1)
    .map(([sourceKey, count]) => ({ sourceKey, count }));
  const finalIds = await get(endpoint(base, query));
  assert(
    Array.isArray(finalIds.objectIds) &&
      finalIds.objectIds.length === ids.objectIds.length &&
      finalIds.objectIds.every((id) => ids.objectIds.includes(id)),
    "Geneva membership changed during acquisition",
  );
  return {
    body: { spatialReference: { wkid: 4326 }, features },
    count: features.length,
    upstreamCount: ids.objectIds.length,
    identityConflicts,
    completeness:
      "All object IDs in the declared window fetched in validated batches; membership rechecked after download. Not a transactionally consistent upstream snapshot.",
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
  const bbox = bounds.porto;
  const features = body.features.filter((f) => {
    assert(
      f.geometry?.type === "Point" &&
        Array.isArray(f.geometry.coordinates) &&
        f.geometry.coordinates.length >= 2,
      "Unexpected Porto geometry",
    );
    const [x, y] = f.geometry.coordinates;
    assert(
      Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90,
      "Invalid Porto coordinates",
    );
    return x >= bbox[0] && y >= bbox[1] && x <= bbox[2] && y <= bbox[3];
  });
  assert(features.length > 0, "Porto pilot window unexpectedly empty");
  return {
    body: { type: "FeatureCollection", features },
    count: features.length,
    upstreamCount: body.features.length,
    completeness:
      "Complete GeoJSON resource downloaded, then clipped by point position to the declared window. No independent upstream total is published.",
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
      "Selected public tree records around Hundertwasserhaus and western Prater; not all trees in Vienna.",
  },
  geneva: {
    acquire: geneva,
    title: "SITG — Inventaire cantonal des arbres isolés",
    url: "https://sitg.ge.ch/donnees/sipv-ica-arbre-isole",
    licence: "SITG A — Accès libre",
    licenceUrl: "https://sitg.ge.ch/ressources/conditions-utilisation-donnees",
    attribution: "Données SITG / Ville de Genève",
    identity:
      "ID_ARBRE is documented stable but observed duplicate IDs must be explicitly resolved or quarantined during normalization. OBJECTID is not permanent.",
    coverage:
      "Selected inventory records outside forests in central Geneva. Historical positioning may be inaccurate by about 25 m; recent surveys about 1 m.",
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
      "Selected public-domain inventory records in central Porto. The age field is an interval, not a planting year.",
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
    file,
    sha256,
    ...metadata,
    ...result,
    bbox: bounds[id],
    coordinateReferenceSystem: "EPSG:4326",
    retrievedAt: new Date().toISOString(),
    requests: requestLog.slice(start),
    processing:
      "Geographic subset; source properties retained except Geneva observer identities omitted. No inferred biological trees or deduplication.",
  });
  console.log(`${id}: ${result.count} records (${file})`);
}
// Consumers only discover a new acquisition after all sources have passed.
const temporary = join(root, `provenance-${process.pid}.tmp`);
await writeFile(
  temporary,
  `${JSON.stringify({ schemaVersion: 1, acquiredAt: new Date().toISOString(), sources: prepared }, null, 2)}\n`,
);
await rename(temporary, join(root, "provenance.json"));
