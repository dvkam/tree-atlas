import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, open, rename } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import proj4 from "proj4";
const root = new URL("../data/raw/", import.meta.url),
  out = new URL("../tests/fixtures/south-sources.json", import.meta.url);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const selected = new Set(process.argv.slice(2));
let previous = { sources: [], failures: [] },
  fixtures = {};
if (selected.size) {
  try {
    previous = JSON.parse(await readFile(new URL("south-provenance.json", root)));
    fixtures = JSON.parse(await readFile(out));
  } catch {}
}
const sources = previous.sources.filter((x) => !selected.has(x.id)),
  failures = previous.failures.filter((x) => !selected.has(x.id));
const cc = "https://creativecommons.org/licenses/by/4.0/",
  odbl = "https://opendatacommons.org/licenses/odbl/1-0/",
  etalab = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/";
const text = (v) =>
  v == null || String(v).trim() === "" || /^(null|unknown|non renseigné|-)$/i.test(String(v).trim())
    ? null
    : String(v).trim();
const measurement = (v, unit) => {
  const n = Number(String(v).replace(",", "."));
  return v !== null && v !== "" && Number.isFinite(n) && n > 0
    ? { kind: "value", value: n, unit }
    : { kind: "unknown" };
};
const year = (v) => {
  const n = Number(String(v).slice(0, 4));
  return Number.isInteger(n) && n >= 1000 && n <= 2200 ? n : null;
};
function atlas(p, c, index) {
  const value = (k) => text(p[k]);
  const id = value(c.id) ?? value("_featureId");
  if (!id) throw Error(`Missing source ID ${c.city} row ${index}`);
  const notes = (c.notes ?? []).flatMap((k) => (value(k) ? [`${k}: ${value(k)}.`] : []));
  const a = {
    sourceId: id,
    tag: value(c.tag ?? c.id),
    scientificName: c.scientific
      ? value(c.scientific)
      : (c.parts ?? []).map(value).filter(Boolean).join(" ") || null,
    commonName: value(c.common),
    location: (c.locations ?? []).map(value).filter(Boolean).join(" · ") || null,
    height: c.height ? measurement(p[c.height], "m") : { kind: "unknown" },
    crown: c.crown ? measurement(p[c.crown], "m") : { kind: "unknown" },
    circumference: c.circumference ? measurement(p[c.circumference], "cm") : { kind: "unknown" },
    plantingYear: c.year ? year(p[c.year]) : null,
    plantingEstimated: false,
    age: value(c.age),
    observedAt: null,
    status: "unknown",
    idScope: "release",
    qualityNotes: notes,
  };
  if (c.city === "cascais" && p.abate === "Sim") a.status = "removed";
  if (c.city === "rennes" && (p.abattu === true || p.abattu === "Oui" || p.abattu === 1))
    a.status = "removed";
  if (c.city === "turin") {
    if (p.descr_stato_posto_pianta === "Pianta viva") a.status = "existing";
    else
      a.qualityNotes.push("Source record may describe a planting site rather than a living tree.");
  }
  return a;
}
async function request(url, requests, binary = false) {
  let e;
  for (let n = 0; n < 3; n++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw Error(`${r.status} ${url}`);
      const b = Buffer.from(await r.arrayBuffer());
      requests.push({ url, retrievedAt: new Date().toISOString(), sha256: hash(b) });
      return binary ? b : JSON.parse(b.toString("utf8"));
    } catch (x) {
      e = x;
    }
  }
  throw e;
}
async function save(c, features, metadata, requests) {
  const ids = new Set(),
    frequencies = new Map();
  for (const f of features) {
    const key = String(f.properties[c.id] ?? f.id);
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  let conflicts = 0;
  let bounds = [180, 90, -180, -90],
    located = 0;
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    f.properties ??= {};
    if (f.id !== undefined) f.properties["_featureId"] = String(f.id);
    f.properties.atlas = atlas(f.properties, c, i);
    let id = f.properties.atlas.sourceId;
    if ((frequencies.get(id) ?? 0) > 1) {
      conflicts++;
      id = id + ":row:" + String(i + 1);
      f.properties.atlas.sourceId = id;
      f.properties.atlas.qualityNotes.push(
        "Publisher identifier is repeated; release row suffix preserves each source record.",
      );
    }
    if (ids.has(id)) throw Error(`Duplicate ${c.city} ${id}`);
    ids.add(id);
    const g = f.geometry;
    if (g !== null && g !== undefined) {
      if (g.type !== "Point" || g.coordinates.length < 2) throw Error("Nonpoint geometry");
      g.coordinates = g.coordinates.slice(0, 2);
      const [x, y] = g.coordinates;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90)
        throw Error("Invalid coordinates");
      located++;
      bounds = [
        Math.min(bounds[0], x),
        Math.min(bounds[1], y),
        Math.max(bounds[2], x),
        Math.max(bounds[3], y),
      ];
    } else f.geometry = null;
  }
  const tmp = new URL(`south-${c.city}.tmp`, root);
  const h = await open(tmp, "w");
  const digest = createHash("sha256");
  const emit = async (s) => {
    digest.update(s);
    await h.writeFile(s);
  };
  await emit('{"type":"FeatureCollection","features":[');
  for (let i = 0; i < features.length; i += 1000)
    await emit(
      (i ? "," : "") +
        features
          .slice(i, i + 1000)
          .map((x) => JSON.stringify(x))
          .join(","),
    );
  await emit("]}");
  await h.close();
  const sha256 = digest.digest("hex"),
    file = `${c.city}-${sha256.slice(0, 16)}.json`;
  await rename(tmp, new URL(file, root));
  sources.push({
    id: c.city,
    scope: "full",
    file,
    sha256,
    title: c.title ?? c.city,
    url: c.url,
    licence: c.licence,
    licenceUrl: c.licenceUrl,
    attribution: c.attribution ?? c.title ?? c.city,
    identity: c.id,
    coverage:
      c.coverage ?? "Complete selected official publisher export; not a census of all trees.",
    count: features.length,
    upstreamCount: features.length,
    bbox: bounds,
    coordinateReferenceSystem: "EPSG:4326",
    geometryAudit: { located, unlocated: features.length - located },
    retrievedAt: new Date().toISOString(),
    requests,
    identityConflictRows: conflicts,
    ...metadata,
  });
  fixtures[c.city] = features.slice(0, 2);
  await persist();
  console.log("SAVED", c.city, features.length, located);
}
async function persist() {
  await writeFile(
    new URL("south-provenance.json", root),
    JSON.stringify({ schemaVersion: 1, sources, failures, blocked: [] }, null, 2),
  );
  await writeFile(out, JSON.stringify(fixtures, null, 2));
}
const ods = [
  {
    city: "paris",
    host: "opendata.paris.fr",
    dataset: "les-arbres",
    id: "idbase",
    parts: ["genre", "espece", "varieteoucultivar"],
    common: "libellefrancais",
    locations: ["adresse", "arrondissement"],
    height: "hauteurenm",
    circumference: "circonferenceencm",
    age: "stadedeveloppement",
  },
  {
    city: "bologna",
    host: "opendata.comune.bologna.it",
    dataset: "alberi-manutenzioni",
    id: "num_pt",
    scientific: "classe",
    locations: ["dimora", "quartiere"],
    year: "data_impnt",
    notes: ["cl_h", "classe_circonferenza_diametro"],
  },
  {
    city: "basel",
    host: "data.bs.ch",
    dataset: "100052",
    id: "gml_id",
    tag: "ba_baumnr",
    scientific: "baumart_lateinisch",
    common: "baumart_deutsch",
    locations: ["ba_strasse", "ba_gemeinde"],
    notes: ["ba_standjahr", "timeposition"],
    age: "ba_baumalter",
  },
  {
    city: "bordeaux",
    host: "datahub.bordeaux-metropole.fr",
    dataset: "ec_arbre_p",
    id: "gid",
    scientific: "espece",
    common: "nom_francais",
    locations: ["station", "nom"],
    year: "date_plantation",
    notes: ["hauteur", "diametre_couronne", "circonference_tronc", "statut", "date_disparition"],
  },
  {
    city: "strasbourg",
    host: "opendata.strasbourg.eu",
    dataset: "patrimoine_arbore",
    id: "num_arbre",
    scientific: "si_essence",
    notes: ["si_hauteur", "si_largeur_couronne", "si_diametre_fut"],
  },
  {
    city: "rennes",
    host: "data.rennesmetropole.fr",
    dataset: "arbre",
    id: "gml_id",
    tag: "id_gestion",
    parts: ["genre", "espece", "variete"],
    common: "nom_commun",
    locations: ["localisation", "code_insee"],
    year: "date_plantation",
    notes: ["hauteur", "circonference", "houppier", "abattu"],
  },
  {
    city: "toulouse",
    host: "data.toulouse-metropole.fr",
    dataset: "arbres-urbains",
    id: "id",
    parts: ["genre", "espece", "cultivar_variete"],
    locations: ["quartier", "commune"],
    year: "date_plantation",
    age: "stade_dev",
    notes: ["hauteur_approx_forestry"],
  },
];
async function odsSource(c) {
  const req = [];
  const base = `https://${c.host}/api/explore/v2.1/catalog/datasets/${c.dataset}`;
  const m = await request(base, req);
  const d = m.metas.default;
  if (!/Licence|License|CC BY|ODbL/i.test(d.license ?? "")) throw Error("Unverified licence");
  const raw = await request(base + "/exports/geojson?lang=fr&timezone=UTC", req);
  if (raw.features.length !== d.records_count)
    throw Error(`Count mismatch ${raw.features.length}/${d.records_count}`);
  await save(
    {
      ...c,
      url: `https://${c.host}/explore/dataset/${c.dataset}/`,
      title: d.title,
      licence: d.license,
      licenceUrl: d.license_url,
      attribution: [d.publisher, ...(d.attributions ?? [])].filter(Boolean).join("; "),
    },
    raw.features,
    { sourceUpdatedAt: d.modified, sourceFields: m.fields },
    req,
  );
}
async function arcSource(c) {
  const req = [];
  const m = await request(c.base + "?f=json", req);
  const idField =
    m.objectIdField ??
    m.objectIdFieldName ??
    m.fields.find((f) => f.type === "esriFieldTypeOID")?.name;
  const list = await request(c.base + "/query?where=1%3D1&returnIdsOnly=true&f=json", req);
  if (!Array.isArray(list.objectIds)) throw Error(JSON.stringify(list));
  const ids = list.objectIds.sort((a, b) => a - b),
    features = [];
  for (let i = 0; i < ids.length; i += 400) {
    const groups = Array.from({ length: Math.min(4, Math.ceil((ids.length - i) / 100)) }, (_, j) =>
      ids.slice(i + j * 100, i + (j + 1) * 100),
    );
    const pages = await Promise.all(
      groups.map(async (group) => {
        const p = await request(
          c.base + "/query?objectIds=" + group.join(",") + "&outFields=*&outSR=4326&f=geojson",
          req,
        );
        const expected = new Set(group);
        for (const f of p.features ?? [])
          if (!expected.delete(f.properties[idField])) throw Error("Unexpected ArcGIS ID");
        if (expected.size) throw Error("Missing ArcGIS IDs");
        return p.features;
      }),
    );
    features.push(...pages.flat());
  }
  await save(
    { ...c, id: c.id ?? idField },
    features,
    {
      sourceUpdatedAt: m.editingInfo?.dataLastEditDate
        ? new Date(m.editingInfo.dataLastEditDate).toISOString()
        : null,
      sourceFields: m.fields,
    },
    req,
  );
}
const arc = [
  {
    city: "valencia",
    base: "https://geoportal.valencia.es/server/rest/services/OPENDATA/MedioAmbiente/MapServer/151",
    url: "https://opendata.vlci.valencia.es/es/dataset/arbratge-arbolado",
    licence: "CC BY 4.0",
    licenceUrl: cc,
    tag: "idarbol",
    scientific: "nom_botanico",
    common: "nom_comu_c",
    locations: ["lugar", "barrio"],
    notes: ["altura", "copa", "perimetro", "estado_gral"],
  },
  {
    city: "bern",
    base: "https://map.bern.ch/arcgis/rest/services/Geoportal/Baumkataster/MapServer/0",
    url: "https://opendata.swiss/de/dataset/baumkataster1",
    licence: "Open use",
    licenceUrl: "https://opendata.swiss/terms-of-use#terms_open",
    tag: "Nummer",
    scientific: "Gattung_beschrieb",
    common: "Art_beschrieb",
    year: "Pflanzjahr",
    notes: ["Lagegenauigkeit_beschrieb"],
  },
  {
    city: "lisbon",
    base: "https://services.arcgis.com/1dSrzEWVQn5kHHyK/arcgis/rest/services/Ambiente_DMEVAE/FeatureServer/0",
    url: "https://dados.cm-lisboa.pt/dataset/arvoredo",
    licence: "CC0",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    tag: "COD_SIG_NEW",
    scientific: "ESPECIE_VA",
    common: "NOME_VULGA",
    locations: ["MORADA", "FREG_2012"],
    notes: ["PAP", "OCUPACAO"],
  },
];
const statics = [
  {
    city: "florence",
    id: "ID",
    scientific: "SPECIE",
    common: "NOME_COMUNE",
    locations: ["QUARTIERE"],
    circumference: "CIRCONF_CM",
    licence: "CC BY 4.0",
    licenceUrl: cc,
    url: "https://opendata.comune.fi.it/page_dataset_show?id=42cd1073-521f-4040-9491-e993d03663a4",
  },
  {
    city: "cascais",
    id: "_featureId",
    tag: "numero_registo",
    scientific: "nome_cientifico",
    common: "especie",
    locations: ["rua", "local", "freguesia"],
    year: "data_plantacao",
    age: "estado",
    notes: ["abate", "caldeira_vazia"],
    licence: "Creative Commons Attribution (version not stated)",
    licenceUrl: "http://www.opendefinition.org/licenses/cc-by",
    url: "https://dadosabertos.cascais.pt/pt_BR/dataset/geocascais-arvore",
  },
  {
    city: "montpellier",
    id: "id_arbre",
    scientific: "nom_latin",
    common: "nom_commun",
    locations: ["adresse", "quartier", "commune"],
    licence: "ODbL 1.0",
    licenceUrl: odbl,
    url: "https://data.montpellier3m.fr/dataset/arbres-de-montpellier",
  },
];
async function staticSource(c) {
  const req = [];
  let address;
  if (c.city === "montpellier")
    address = "https://data.montpellier3m.fr/sites/default/files/ressources/MMM_MTP_Arbres.json";
  else {
    const m = await request(
      c.city === "florence"
        ? "https://data.comune.fi.it/datastore/api/package_show?id=42cd1073-521f-4040-9491-e993d03663a4&stats=1"
        : "https://dadosabertos.cascais.pt/api/3/action/package_show?id=geocascais-arvore",
      req,
    );
    address = m.result.resources.find((r) => r.format.toLowerCase() === "geojson").url;
  }
  const raw = await request(address, req);
  await save(c, raw.features, {}, req);
}
async function barcelona() {
  const req = [],
    features = [];
  const meta = await request(
    "https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_search?q=arbrat&rows=20",
    req,
  );
  for (const name of ["arbrat-viari", "arbrat-zona", "arbrat-parcs"]) {
    const m = meta.result.results.find((x) => x.name === name);
    if (m.license_id !== "CC-BY-4.0") throw Error("Barcelona licence changed");
    const r = m.resources.find((x) => x.format === "JSON");
    const rows = await request(r.url, req);
    for (const p of rows) {
      p.source_inventory = name;
      p.atlas_source_id = name + ":" + p.codi;
      features.push({
        type: "Feature",
        properties: p,
        geometry:
          p.longitud && p.latitud
            ? { type: "Point", coordinates: [Number(p.longitud), Number(p.latitud)] }
            : null,
      });
    }
  }
  await save(
    {
      city: "barcelona",
      id: "atlas_source_id",
      tag: "codi",
      scientific: "cat_nom_cientific",
      common: "cat_nom_catala",
      locations: ["adreca", "nom_barri", "espai_verd"],
      year: "data_plantacio",
      notes: ["source_inventory", "tipus_element"],
      licence: "CC BY 4.0",
      licenceUrl: cc,
      url: "https://opendata-ajuntament.barcelona.cat/data/en/dataset/arbrat-viari",
      coverage: "Combined official street, zone and park inventories; no proximity deduplication.",
    },
    features,
    {},
    req,
  );
}
async function lyon() {
  const req = [],
    features = [];
  let address =
    "https://data.grandlyon.com/geoserver/ogc/features/v1/collections/metropole-de-lyon:abr_arbres_alignement.abrarbre/items?f=application%2Fgeo%2Bjson&limit=10000";
  let expected;
  while (address) {
    const p = await request(address, req);
    expected ??= p.numberMatched;
    features.push(...p.features);
    address = p.links.find((l) => l.rel === "next")?.href;
  }
  if (features.length !== expected) throw Error("Lyon count mismatch");
  await save(
    {
      city: "lyon",
      id: "gid",
      tag: "identifiant",
      scientific: "essence",
      common: "essencefrancais",
      locations: ["nomvoie", "commune"],
      height: "hauteurtotale_m",
      crown: "diametrecouronne_m",
      circumference: "circonference_cm",
      year: "anneeplantation",
      licence: "Licence Ouverte",
      licenceUrl: etalab,
      url: "https://data.grandlyon.com/portail/fr/jeux-de-donnees/arbres-alignement-metropole-lyon/info",
    },
    features,
    {},
    req,
  );
}
async function turin() {
  const req = [];
  const base =
    "https://geomap.reteunitaria.piemonte.it/ws/siccms/coto-01/wfsg01/wfs_sicc11_alberate";
  const address =
    base +
    "?service=WFS&version=1.1.0&request=GetFeature&typeName=AlberatePt&srsName=EPSG:4326&outputFormat=application%2Fjson%3B%20subtype%3Dgeojson%3B%20charset%3DISO-8859-1";
  const raw = await request(address, req);
  const hitsDocument = await request(
    base +
      "?service=WFS&version=1.1.0&request=GetFeature&typeName=AlberatePt&resultType=hits&_=" +
      Date.now(),
    req,
    true,
  );
  const hitsCount = Number(hitsDocument.toString("utf8").match(/numberOfFeatures="(\d+)"/)?.[1]);
  if (!Number.isInteger(hitsCount)) throw Error("Turin hits count unavailable");
  const mismatch = hitsCount !== raw.features.length;
  if (mismatch) {
    const second = await request(address + "&_=" + Date.now(), req);
    const ids = new Set(raw.features.map((f) => f.properties.id_posto_pianta));
    if (
      second.features.length !== raw.features.length ||
      second.features.some((f) => !ids.delete(f.properties.id_posto_pianta)) ||
      ids.size
    )
      throw Error("Turin repeated exports disagree");
  }
  await save(
    {
      city: "turin",
      coverage: mismatch
        ? `Downloaded planting-site export; service count disagrees (${hitsCount} vs ${raw.features.length} rows). Completeness against live service is unverified.`
        : "Complete published planting-site export; records include non-living planting sites.",
      id: "id_posto_pianta",
      scientific: "descr_specie",
      locations: ["descr_ambito"],
      age: "descr_eta",
      notes: ["altezza", "diametro_fusto", "diametro_medio_chioma", "descr_stato_posto_pianta"],
      licence: "CC BY 4.0",
      licenceUrl: cc,
      url: "https://www.geoportale.piemonte.it/geonetwork/serv/api/records/c_l219:b0493156-2d45-4792-977c-c3ab2937f171",
    },
    raw.features,
    {
      sourceUpdatedAt: "2026-09-30",
      upstreamCountVerified: !mismatch,
      exportCount: raw.features.length,
      hitsCount,
      repeatedExportVerified: mismatch,
    },
    req,
  );
}
async function madrid() {
  const req = [];
  const base =
    "https://datos.madrid.es/api/3/action/datastore_search?resource_id=300761-8-arbolado-especies&limit=10000";
  let features = [],
    count;
  for (let offset = 0; count === undefined || offset < count; offset += 10000) {
    const p = (await request(base + "&offset=" + offset + "&sort=_id", req)).result;
    count ??= p.total;
    if (!p.records.length) throw Error("Madrid incomplete");
    for (const row of p.records) {
      const xy = [Number(row.X), Number(row.Y)];
      const pos =
        xy.every(Number.isFinite) && xy.every((n) => n !== 0)
          ? proj4("+proj=utm +zone=30 +ellps=GRS80 +units=m +no_defs", "EPSG:4326", xy)
          : null;
      features.push({
        type: "Feature",
        properties: row,
        geometry: pos ? { type: "Point", coordinates: pos } : null,
      });
    }
  }
  if (features.length !== count) throw Error("Madrid count");
  await save(
    {
      city: "madrid",
      id: "_id",
      tag: "ASSETNUM",
      scientific: "ESPECIE",
      locations: ["NBRE_BARRIO", "NBRE_DISTRITO"],
      height: "ALTURA_TOTAL",
      circumference: "PERIMETRO",
      licence: "CC BY 4.0",
      licenceUrl: cc,
      url: "https://datos.madrid.es/dataset/300761-0-arbolado-especies",
    },
    features,
    {
      sourceUpdatedAt: "2026-07-07",
      processing: "ETRS89 / UTM zone30N transformed to EPSG:4326. All publisher rows retained.",
    },
    req,
  );
}
function unzipJson(b) {
  for (let i = 0; i < b.length - 46; i++) {
    if (b.readUInt32LE(i) !== 0x02014b50) continue;
    const method = b.readUInt16LE(i + 10),
      size = b.readUInt32LE(i + 20),
      nl = b.readUInt16LE(i + 28),
      offset = b.readUInt32LE(i + 42),
      name = b.subarray(i + 46, i + 46 + nl).toString();
    if (!/\.geo?json$/i.test(name) && !name.endsWith(".json")) continue;
    const start = offset + 30 + b.readUInt16LE(offset + 26) + b.readUInt16LE(offset + 28),
      data = b.subarray(start, start + size);
    return JSON.parse((method === 8 ? inflateRawSync(data) : data).toString("utf8"));
  }
  throw Error("No JSON in archive");
}
async function milan() {
  const req = [];
  const m = (
    await request(
      "https://dati.comune.milano.it/api/3/action/package_show?id=ds2484_infogeo_alberi_localizzazione",
      req,
    )
  ).result;
  const resource = m.resources.find((x) => x.format === "GeoJSON");
  const raw = unzipJson(await request(resource.url, req, true));
  await writeFile(new URL("south-original-milan.json", root), JSON.stringify(raw));
  await save(
    {
      city: "milan",
      id: "obj_id",
      tag: "codice",
      parts: ["genere", "specie", "varieta"],
      locations: ["localita", "municipio"],
      height: "h_m",
      notes: ["diam_tronc", "diam_chiom", "data_ini"],
      licence: "CC BY 4.0",
      licenceUrl: cc,
      url: "https://dati.comune.milano.it/dataset/groups/ds2484_infogeo_alberi_localizzazione",
      coverage:
        "Complete official downloadable archive. Resource name says March 2025; archive member says March 2024. Observation vintage is unresolved.",
    },
    raw.features,
    { sourceUpdatedAt: null, resourceUpdatedAt: resource.last_modified },
    req,
  );
}
await mkdir(root, { recursive: true });
const tasks = [
  ...ods.map((c) => [c.city, () => odsSource(c)]),
  ...statics.map((c) => [c.city, () => staticSource(c)]),
  ...arc.map((c) => [c.city, () => arcSource(c)]),
  ["barcelona", barcelona],
  ["lyon", lyon],
  ["turin", turin],
  ["madrid", madrid],
  ["milan", milan],
];
for (let i = 0; i < tasks.length; i += 3) {
  await Promise.all(
    tasks
      .slice(i, i + 3)
      .filter(([id]) => !selected.size || selected.has(id))
      .map(async ([id, run]) => {
        try {
          await run();
        } catch (e) {
          failures.push({ id, reason: e.message });
          console.log("BLOCKED", id, e.message);
          await persist();
        }
      }),
  );
}
await persist();

if (failures.length > 0) process.exitCode = 1;
