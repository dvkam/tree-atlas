import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, open, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../data/raw/", import.meta.url));
const hash = (x) => createHash("sha256").update(x).digest("hex");
const requests = [];
async function get(url, json = true) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw Error(`${r.status} ${url}`);
  const t = await r.text();
  requests.push({ url, sha256: hash(t), retrievedAt: new Date().toISOString() });
  const v = json ? JSON.parse(t) : t;
  if (v.error) throw Error(JSON.stringify(v.error));
  return v;
}
function* csv(text) {
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field);
      field = "";
      if (c === "\n") {
        yield row;
        row = [];
      }
    } else if (c !== "\r" || quoted) field += c;
  }
  if (quoted) throw Error("Unclosed CSV quote");
  if (field || row.length) {
    row.push(field);
    yield row;
  }
}
function records(text) {
  const iterator = csv(text);
  const headers = iterator.next().value;
  return {
    *[Symbol.iterator]() {
      for (const row of iterator) {
        if (row.length === 1 && row[0] === "") continue;
        if (row.length !== headers.length)
          throw Error(`CSV columns ${row.length}/${headers.length}`);
        yield Object.fromEntries(headers.map((k, i) => [k, row[i]]));
      }
    },
  };
}
function point(lon, lat) {
  if (lon === null || lat === null || String(lon).trim() === "" || String(lat).trim() === "")
    return null;
  const x = Number(lon),
    y = Number(lat);
  return Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= -180 &&
    x <= 180 &&
    y >= -90 &&
    y <= 90 &&
    (x !== 0 || y !== 0)
    ? { type: "Point", coordinates: [x, y] }
    : null;
}
const ogl = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
const sources = [],
  fixtures = {};
async function save(id, features, metadata, key) {
  const ids = new Set();
  let missing = 0;
  let bounds = [180, 90, -180, -90];
  for (const f of features) {
    const sourceIdentity = f.properties[key];
    if (sourceIdentity === null || sourceIdentity === undefined)
      throw Error(`${id} missing ${key}`);
    const identity = String(sourceIdentity);
    if (!identity || ids.has(identity)) throw Error(`${id} duplicate ${identity}`);
    ids.add(identity);
    if (!f.geometry) missing++;
    else {
      const [x, y] = f.geometry.coordinates;
      bounds = [
        Math.min(bounds[0], x),
        Math.min(bounds[1], y),
        Math.max(bounds[2], x),
        Math.max(bounds[3], y),
      ];
    }
  }
  const tmp = root + id + "-acquiring.json";
  const handle = await open(tmp, "w");
  const digest = createHash("sha256");
  async function emit(chunk) {
    digest.update(chunk);
    await handle.writeFile(chunk);
  }
  await emit('{"type":"FeatureCollection","features":[');
  for (let i = 0; i < features.length; i += 1000) {
    await emit(
      (i ? "," : "") +
        features
          .slice(i, i + 1000)
          .map((f) => JSON.stringify(f))
          .join(","),
    );
  }
  await emit("]}");
  await handle.close();
  const sha256 = digest.digest("hex"),
    file = `${id}-${sha256.slice(0, 16)}.json`;
  await rename(tmp, root + file);
  fixtures[id] = [
    features[0],
    features.find((f) => Boolean(f.geometry) !== Boolean(features[0].geometry)) ?? features[1],
  ];
  sources.push({
    id,
    scope: "full",
    file,
    sha256,
    count: features.length,
    upstreamCount: features.length,
    coordinateReferenceSystem: "EPSG:4326",
    bbox: bounds,
    geometryAudit: { located: features.length - missing, unlocated: missing },
    licence: "Open Government Licence v3.0",
    licenceUrl: ogl,
    retrievedAt: new Date().toISOString(),
    requests: requests.splice(0),
    ...metadata,
  });
  await writeFile(
    root + "uk-provenance.json",
    JSON.stringify({ schemaVersion: 1, sources }, null, 2),
  );
  console.log(id, features.length, missing);
}
await mkdir(root, { recursive: true });
const camdenMeta = await get("https://opendata.camden.gov.uk/api/views/csqp-kdss.json");
if (camdenMeta.licenseId !== "UK_OGLV3.0") throw Error("Camden licence changed");

// Resource API uses field names, unlike human-readable download headers.
const expected = Number(
  (await get("https://opendata.camden.gov.uk/resource/csqp-kdss.json?$select=count(*)"))[0].count,
);
let camden = [];
for (let offset = 0; offset < expected; offset += 10000) {
  const rows = await get(
    `https://opendata.camden.gov.uk/resource/csqp-kdss.json?$limit=10000&$offset=${offset}&$order=:id&$select=*,%3Aid`,
  );
  camden.push(
    ...rows.map((p) => ({
      type: "Feature",
      properties: p,
      geometry: point(p.longitude, p.latitude),
    })),
  );
}
if (camden.length !== expected) throw Error("Camden count changed");
await save(
  "camden",
  camden,
  {
    title: "Trees in Camden",
    url: "https://opendata.camden.gov.uk/d/csqp-kdss",
    identity: ":id (Socrata row ID; identifier may repeat)",
    attribution:
      "Contains public sector information licensed under the Open Government Licence v3.0. London Borough of Camden.",
    coverage: "All published Camden council tree records; groups retain number_of_trees.",
    sourceUpdatedAt: new Date(camdenMeta.rowsUpdatedAt * 1000).toISOString(),
  },
  ":id",
);
camden = null;
const londonUrl =
  "https://data.london.gov.uk/download/2r45m/e62a6a1f-390d-4193-ae32-3aabd9846f36/Borough_tree_list_2025Nov.csv";
let londonText;
try {
  londonText = await readFile(root + "london-original.csv", "utf8");
  requests.push({
    url: londonUrl,
    sha256: hash(londonText),
    retrievedAt: new Date().toISOString(),
  });
} catch {
  londonText = await get(londonUrl, false);
  await writeFile(root + "london-original.csv", londonText);
}
let london = [],
  excluded = 0,
  total = 0;
const contributors = {};
for (const p of records(londonText)) {
  total++;
  contributors[p.maintainer] = (contributors[p.maintainer] ?? 0) + 1;
  if (p.maintainer === "LB Camden") {
    excluded++;
    continue;
  }
  london.push({ type: "Feature", properties: p, geometry: point(p.lon, p.lat) });
}
if (!excluded) throw Error("Camden contributor not found");
londonText = null;
await save(
  "london",
  london,
  {
    title: "London Public Realm Trees",
    url: "https://data.london.gov.uk/dataset/london-public-realm-trees-2r45m",
    identity: "uniqueid (GLA mapping ID; not borough asset ID)",
    attribution:
      "Contains public sector information licensed under the Open Government Licence v3.0. Greater London Authority and contributing public bodies.",
    coverage:
      "November 2025 compilation, excluding LB Camden contributor rows replaced by the separate current Camden inventory.",
    upstreamCount: total,
    excludedCamden: excluded,
    contributors,
    sourceUpdatedAt: "2025-11",
    processing:
      "Exact maintainer=LB Camden exclusion; no proximity or species deduplication. Missing coordinates retained.",
  },
  "uniqueid",
);
london = null;
const edBase =
  "https://services-eu1.arcgis.com/FgpikkYuSUOuITxp/arcgis/rest/services/Trees/FeatureServer/41";
const edMeta = await get(edBase + "?f=json");
const edItem = await get(
  "https://www.arcgis.com/sharing/rest/content/items/6c224ada230b4d349cfd739015c7846d?f=json",
);
if (!edItem.licenseInfo.includes("Open Government")) throw Error("Edinburgh licence changed");
const idData = await get(edBase + "/query?where=1%3D1&returnIdsOnly=true&f=json");
const ids = idData.objectIds.sort((a, b) => a - b);
const ed = [];
for (let i = 0; i < ids.length; i += 100) {
  const page = await get(
    edBase +
      "/query?objectIds=" +
      ids.slice(i, i + 100).join(",") +
      "&outFields=*&outSR=4326&f=geojson",
  );
  const expectedIds = new Set(ids.slice(i, i + 100));
  if (
    page.features.length !== expectedIds.size ||
    page.features.some((feature) => !expectedIds.delete(feature.properties.OBJECTID)) ||
    expectedIds.size
  )
    throw Error("Edinburgh ID mismatch");
  ed.push(...page.features);
}
if (ed.length !== ids.length) throw Error("Edinburgh missing page");
await save(
  "edinburgh",
  ed,
  {
    title: "Trees — City of Edinburgh Council",
    url: "https://city-of-edinburgh-council-open-spatial-data-cityofedinburgh.hub.arcgis.com/datasets/cityofedinburgh::trees",
    identity: "OBJECTID",
    attribution:
      "Copyright City of Edinburgh Council, contains Ordnance Survey data © Crown copyright and database right 2026",
    coverage: "All records in the official council Trees layer 41.",
    services: { rest: edBase },
    sourceUpdatedAt: new Date(edMeta.editingInfo.dataLastEditDate).toISOString(),
  },
  "OBJECTID",
);
const belfastUrl =
  "https://www.belfastcity.gov.uk/getContentAsset/82ffb84f-5d46-4d79-a104-63cba2431d7e/dfc3d011-8f63-43f6-9ed8-4b444333a1d0/Trees-Open-Data?language=en-GB";
const belfastText = await get(belfastUrl, false);
const belfastXml = await get(
  "https://www.belfastcity.gov.uk/getContentAsset/e3d0eb00-3822-4931-8990-0dd016f2ce1c/dfc3d011-8f63-43f6-9ed8-4b444333a1d0/Trees-%28all%29?language=en-GB",
  false,
);
let n = 0;
const belfast = Array.from(records(belfastText), (p) => ({
  type: "Feature",
  properties: { ...p, source_row: String(++n) },
  geometry: point(p.Longitude, p.Latitude),
}));
await save(
  "belfast",
  belfast,
  {
    title: "Belfast council tree download",
    url: "https://www.belfastcity.gov.uk/open-and-linked-data",
    identity: "source_row (release-scoped row identity; TreeTag is frequently NULL)",
    attribution:
      "Contains public sector information licensed under the Open Government Licence v3.0. Belfast City Council.",
    coverage: "Complete CSV export. TreeTag is not a reliable unique identifier.",
    sourceUpdatedAt: belfastXml.match(/<Created>(.*?)<\/Created>/)?.[1] ?? null,
    sourceDateMeaning: "Companion XML workbook creation date; CSV observation date is not stated.",
  },
  "source_row",
);
await writeFile(
  new URL("../tests/fixtures/uk-sources.json", import.meta.url),
  JSON.stringify(fixtures, null, 2),
);
