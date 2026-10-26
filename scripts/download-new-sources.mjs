import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../data/raw/", import.meta.url));
const hash = (body) => createHash("sha256").update(body).digest("hex");
const requests = [];
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
function url(base, params) {
  const value = new URL(base);
  for (const [key, item] of Object.entries(params)) value.searchParams.set(key, String(item));
  return value.href;
}
async function get(address, text = false) {
  let failure;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(address, { signal: AbortSignal.timeout(180_000) });
      assert(response.ok, `${response.status}: ${address}`);
      const body = await response.text();
      const parsed = text ? body : JSON.parse(body);
      assert(!parsed?.error, `Source error: ${address}`);
      requests.push({ url: address, retrievedAt: new Date().toISOString(), sha256: hash(body) });
      return { body: parsed, headers: response.headers };
    } catch (error) {
      failure = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw failure;
}
function audit(features, key) {
  const seen = new Set();
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  const missing = [];
  for (const f of features) {
    const id = f.properties[key];
    assert(
      id !== null && id !== undefined && !seen.has(String(id)),
      `Missing or duplicate ${key}: ${id}`,
    );
    seen.add(String(id));
    if (!f.geometry) {
      missing.push(String(id));
      continue;
    }
    const p = f.geometry?.coordinates;
    assert(
      f.geometry?.type === "Point" &&
        p.length === 2 &&
        p.every(Number.isFinite) &&
        Math.abs(p[0]) <= 180 &&
        Math.abs(p[1]) <= 90,
      `Invalid point: ${id}`,
    );
    west = Math.min(west, p[0]);
    south = Math.min(south, p[1]);
    east = Math.max(east, p[0]);
    north = Math.max(north, p[1]);
  }
  assert(west < east && south < north, "Empty or degenerate inventory");
  return {
    bbox: [west, south, east, north],
    geometryAudit: {
      valid: features.length - missing.length,
      missing: missing.length,
      invalid: 0,
      missingSourceIds: missing,
    },
    count: features.length,
  };
}
async function amsterdam() {
  const metadata = (await get("https://schemas.data.amsterdam.nl/datasets/bomen/dataset")).body;
  assert(metadata.versions?.v2?.status === "stable", "Review Amsterdam API version");
  const base = "https://api.data.amsterdam.nl/v1/bomen/v2/stamgegevens";
  const countUrl = url(base, { _count: true, _pageSize: 1 });
  const first = await get(countUrl);
  const expected = Number(first.headers.get("x-total-count"));
  assert(Number.isSafeInteger(expected) && expected > 0, "Amsterdam total missing");
  const features = [];
  let next = url(base, { _format: "geojson", _pageSize: 10000, _sort: "id" });
  const visited = new Set();
  let lastId = -1;
  while (next) {
    assert(
      !visited.has(next) &&
        new URL(next).origin === new URL(base).origin &&
        new URL(next).pathname === new URL(base).pathname,
      "Invalid Amsterdam next page",
    );
    visited.add(next);
    const page = (await get(next)).body;
    assert(
      page.type === "FeatureCollection" && Array.isArray(page.features),
      "Invalid Amsterdam GeoJSON",
    );
    for (const feature of page.features) {
      assert(
        Number.isSafeInteger(feature.properties?.id) && feature.properties.id > lastId,
        "Amsterdam paging order changed",
      );
      lastId = feature.properties.id;
      features.push(feature);
    }
    assert(features.length <= expected, "Amsterdam total grew");
    next = page["_links"]?.find((link) => link.rel === "next")?.href;
    console.log(`Amsterdam ${features.length}/${expected}`);
  }
  const final = await get(countUrl);
  assert(
    features.length === expected && Number(final.headers.get("x-total-count")) === expected,
    "Amsterdam count changed or incomplete pages",
  );
  return {
    body: { type: "FeatureCollection", features },
    ...audit(features, "id"),
    upstreamCount: expected,
    completeness:
      "All ordered REST GeoJSON pages followed through the final next link; strictly increasing unique IDs and before/after totals checked. Not a transactional source snapshot.",
    sourceApiVersion: "v2",
    sourceLicense: metadata.license,
  };
}
async function hamburg() {
  const metadata = (
    await get(
      "https://suche.transparenz.hamburg.de/api/3/action/package_show?id=strassenbaumkataster-hamburg34",
    )
  ).body;
  assert(
    metadata.success && metadata.result.license_id === "dl-de-by-2.0",
    "Review Hamburg licence",
  );
  const base = "https://geodienste.hamburg.de/HH_WFS_Strassenbaumkataster";
  const common = {
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: "de.hh.up:strassenbaumkataster",
  };
  async function count() {
    const text = (await get(url(base, { ...common, RESULTTYPE: "hits" }), true)).body;
    const match = /numberMatched="(\d+)"/u.exec(text);
    assert(match, "Missing Hamburg count");
    return Number(match[1]);
  }
  const expected = await count();
  const features = [];
  for (let start = 0; start < expected; start += 10000) {
    const page = (
      await get(
        url(base, {
          ...common,
          STARTINDEX: start,
          COUNT: 10000,
          SORTBY: "baumid",
          OUTPUTFORMAT: "application/geo+json",
          SRSNAME: "EPSG:4326",
        }),
      )
    ).body;
    assert(
      page.type === "FeatureCollection" &&
        page.features?.length === Math.min(10000, expected - start),
      "Incomplete Hamburg page",
    );
    for (const f of page.features) {
      assert(
        f.geometry?.type === "MultiPoint" && f.geometry.coordinates.length === 1,
        "Hamburg geometry is not a singleton MultiPoint",
      );
      features.push({ ...f, geometry: { type: "Point", coordinates: f.geometry.coordinates[0] } });
    }
    console.log(`Hamburg ${features.length}/${expected}`);
  }
  assert((await count()) === expected, "Hamburg count changed");
  return {
    body: { type: "FeatureCollection", features },
    ...audit(features, "baumid"),
    upstreamCount: expected,
    sourceUpdatedAt: metadata.result.metadata_modified,
    completeness:
      "All current WFS street-tree rows downloaded in sorted pages, unique IDs and before/after count reconciled. The current service exposes one layer; obsolete HPA layer names in historical download links are not separate current layers. Not a transactionally consistent upstream snapshot.",
    processing:
      "No geographic filtering. Singleton MultiPoint geometries converted to Point without changing coordinates. Every source row retained.",
  };
}
async function zurich() {
  const metadata = (
    await get("https://data.stadt-zuerich.ch/api/3/action/package_show?id=geo_baumkataster")
  ).body;
  assert(metadata.success && metadata.result.license_id === "cc-zero", "Review Zürich licence");
  const base = "https://www.ogd.stadt-zuerich.ch/wfs/geoportal/Baumkataster";
  const common = {
    SERVICE: "WFS",
    VERSION: "1.1.0",
    REQUEST: "GetFeature",
    TYPENAME: "baumkataster_baumstandorte",
  };
  async function count() {
    const text = (await get(url(base, { ...common, RESULTTYPE: "hits" }), true)).body;
    const match = /numberOfFeatures="(\d+)"/u.exec(text);
    assert(match, "Missing Zürich count");
    return Number(match[1]);
  }
  const expected = await count();
  const body = (
    await get(
      url(base, {
        ...common,
        MAXFEATURES: expected + 1,
        OUTPUTFORMAT: "application/vnd.geo+json",
        SRSNAME: "EPSG:4326",
      }),
    )
  ).body;
  assert(
    body.type === "FeatureCollection" &&
      body.features?.length === expected &&
      (await count()) === expected,
    "Zürich count changed or download truncated",
  );
  return {
    body,
    ...audit(body.features, "objectid"),
    upstreamCount: expected,
    sourceUpdatedAt: metadata.result.metadata_modified,
    completeness:
      "Complete tree-point WFS layer downloaded without area filter; before/after WFS hits totals reconciled. Crown polygons and CAD marker circles are representations of the same trees and are not additional records. Not a transactional upstream snapshot.",
  };
}
const sources = {
  amsterdam: {
    acquire: amsterdam,
    title: "Gemeente Amsterdam — Bomen stamgegevens",
    url: "https://api.data.amsterdam.nl/v1/docs/datasets/bomen@v2.html",
    licence: "Public data — Amsterdam published terms",
    licenceUrl: "https://api.data.amsterdam.nl/v1/docs/datasets/bomen@v2.html",
    attribution: "Gemeente Amsterdam — Directie Verkeer en Openbare Ruimte",
    identity: "id; release-scoped because permanent cross-release stability is not established",
    coverage:
      "Complete available municipal tree master records. Includes recorded management locations, not all physical trees. No street-address field is published in this collection.",
    services: {
      rest: "https://api.data.amsterdam.nl/v1/bomen/v2/stamgegevens",
      wfs: "https://api.data.amsterdam.nl/v1/wfs/bomen/v2",
      vectorTiles: "https://api.data.amsterdam.nl/v1/mvt/bomen/v2/tilejson.json",
    },
  },
  hamburg: {
    acquire: hamburg,
    title: "Freie und Hansestadt Hamburg — Straßenbaumkataster",
    url: "https://suche.transparenz.hamburg.de/dataset/strassenbaumkataster-hamburg34",
    licence: "Datenlizenz Deutschland — Namensnennung 2.0",
    licenceUrl: "https://www.govdata.de/dl-de/by-2-0",
    attribution:
      "Freie und Hansestadt Hamburg, Behörde für Umwelt, Klima, Energie und Agrarwirtschaft",
    identity: "baumid; release-scoped because permanent cross-release stability is not established",
    coverage:
      "Complete available public street-tree inventory. Park, forest and private trees are not comprehensively covered. Published source records may lag planting or removal.",
    services: {
      wfs: "https://geodienste.hamburg.de/HH_WFS_Strassenbaumkataster",
      features: "https://api.hamburg.de/datasets/v1/strassenbaumkataster",
      wms: "https://geodienste.hamburg.de/HH_WMS_Strassenbaumkataster",
    },
  },
  zurich: {
    acquire: zurich,
    title: "Stadt Zürich — Baumkataster",
    url: "https://data.stadt-zuerich.ch/dataset/geo_baumkataster",
    licence: "CC0 1.0",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attribution: "Stadt Zürich — Grün Stadt Zürich / Geomatik + Vermessung",
    identity:
      "objectid; release-scoped because permanent cross-release stability is not established",
    coverage:
      "Complete available municipal tree-point inventory, including street trees, fruit trees, selected public green areas and some private trees. Includes records outside the municipal boundary. Park coverage is being expanded gradually.",
    services: {
      wfs: "https://www.ogd.stadt-zuerich.ch/wfs/geoportal/Baumkataster",
      geojson: "https://www.stadt-zuerich.ch/geodaten/download/Baumkataster?format=geojson_link",
      wms: "https://www.ogd.stadt-zuerich.ch/wms/geoportal/Baumkataster",
    },
  },
};
await mkdir(root, { recursive: true });
const prepared = [];
for (const [id, { acquire, ...metadata }] of Object.entries(sources)) {
  const requestStart = requests.length;
  const { body, ...result } = await acquire();
  const text = JSON.stringify(body),
    sha256 = hash(text),
    file = `${id}-${sha256.slice(0, 16)}.json`;
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
    requests: requests.slice(requestStart),
    processing:
      result.processing ??
      "No geographic filtering or proximity deduplication. Complete source rows retained.",
  });
  console.log(`${id}: ${result.count} records saved to ${file}`);
  await writeFile(
    join(root, "new-provenance-progress.json"),
    JSON.stringify({ schemaVersion: 1, sources: prepared }, null, 2),
  );
}
const temporary = join(root, `new-provenance-${process.pid}.tmp`);
await writeFile(
  temporary,
  JSON.stringify(
    { schemaVersion: 1, acquiredAt: new Date().toISOString(), sources: prepared },
    null,
    2,
  ),
);
await rename(temporary, join(root, "new-provenance.json"));
