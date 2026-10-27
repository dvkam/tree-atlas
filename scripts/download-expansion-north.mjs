import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, open, rename } from "node:fs/promises";
import proj4 from "proj4";

const raw = new URL("../data/raw/", import.meta.url);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (value) =>
  value == null || String(value).trim() === "" ? null : String(value).trim();
const unknown = () => ({ kind: "unknown" });
const number = (value) => Number(String(value ?? "").replace(",", "."));
const measure = (value, unit) =>
  number(value) > 0 ? { kind: "value", value: number(value), unit } : unknown();
const year = (value) => {
  const n = Number(String(value ?? "").slice(0, 4));
  return Number.isInteger(n) && n >= 1000 && n <= 2200 ? n : null;
};
const defaults = (id) => ({
  sourceId: String(id),
  idScope: "release",
  tag: null,
  scientificName: null,
  commonName: null,
  location: null,
  height: unknown(),
  crown: unknown(),
  circumference: unknown(),
  plantingYear: null,
  plantingEstimated: false,
  age: null,
  observedAt: null,
  status: "unknown",
});
const requests = [];
async function get(requestUrl, json = true) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(requestUrl, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw Error(`${response.status} ${requestUrl}`);
      const body = await response.text();
      const result = json ? JSON.parse(body) : body;
      if (result.error) throw Error(JSON.stringify(result.error));
      requests.push({
        url: String(requestUrl),
        sha256: hash(body),
        retrievedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
function url(base, params) {
  const result = new URL(base);
  for (const [key, value] of Object.entries(params)) result.searchParams.set(key, String(value));
  return result.href;
}
function geometry(feature, projection) {
  let g = feature.geometry;
  if (g?.type === "MultiPoint" && g.coordinates.length === 1)
    g = { type: "Point", coordinates: g.coordinates[0] };
  if (g == null) return null;
  if (g.type !== "Point") throw Error(`Unexpected geometry ${g.type}`);
  let xy = g.coordinates.slice(0, 2);
  if (projection) xy = proj4(projection, "EPSG:4326", xy);
  if (!xy.every(Number.isFinite) || Math.abs(xy[0]) > 180 || Math.abs(xy[1]) > 90)
    throw Error(`Invalid WGS84 point ${xy}`);
  return { type: "Point", coordinates: xy };
}
async function* ods(base, dataset, key) {
  const endpoint = `${base}/api/explore/v2.1/catalog/datasets/${dataset}`;
  const metadata = await get(endpoint);
  const data = await get(`${endpoint}/exports/geojson?lang=en&timezone=UTC`);
  if (data.features.length !== metadata.metas.default.records_count)
    throw Error("ODS export count changed");
  for (const [index, feature] of data.features.entries())
    feature.id = `${feature.properties[key] ?? "unidentified"}:row:${index + 1}`;
  yield data.features;
  if ((await get(endpoint)).metas.default.records_count !== data.features.length)
    throw Error("ODS final count changed");
}
async function* arc(base, layers) {
  for (const layer of layers) {
    const endpoint = `${base}/${layer}`;
    const metadata = await get(`${endpoint}?f=json`);
    const idField =
      metadata.objectIdField ??
      metadata.fields.find((field) => field.type === "esriFieldTypeOID")?.name;
    const ids = (
      await get(url(`${endpoint}/query`, { f: "json", where: "1=1", returnIdsOnly: true }))
    ).objectIds.sort((a, b) => a - b);
    if (ids.length !== new Set(ids).size) throw Error("Duplicate ArcGIS object IDs");
    const batchSize = Math.min(200, metadata.maxRecordCount ?? 200);
    for (let offset = 0; offset < ids.length; offset += batchSize) {
      const batch = ids.slice(offset, offset + batchSize);
      const data = await get(
        url(`${endpoint}/query`, {
          f: "geojson",
          objectIds: batch.join(","),
          outFields: "*",
          outSR: 4326,
          returnGeometry: true,
        }),
      );
      if (
        data.exceededTransferLimit ||
        data.properties?.exceededTransferLimit ||
        data.features.length !== batch.length
      )
        throw Error("ArcGIS incomplete batch");
      const got = data.features
        .map((feature) => Number(feature.properties[idField]))
        .sort((a, b) => a - b);
      if (JSON.stringify(got) !== JSON.stringify(batch)) throw Error("ArcGIS batch ID mismatch");
      for (const feature of data.features) {
        feature.id = `${layer}:${feature.properties[idField]}`;
        feature.properties["_sourceLayer"] = layer;
      }
      yield data.features;
    }
    const finalIds = (
      await get(url(`${endpoint}/query`, { f: "json", where: "1=1", returnIdsOnly: true }))
    ).objectIds.sort((a, b) => a - b);
    if (JSON.stringify(ids) !== JSON.stringify(finalIds)) throw Error("ArcGIS ID set changed");
  }
}
async function* wfs(base, types, sort, format = "application/json") {
  for (const type of types) {
    const common = { service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: type };
    const hits = async () => {
      const body = await get(url(base, { ...common, resultType: "hits" }), false);
      const match = /numberMatched="(\d+)"/.exec(body);
      if (!match) throw Error(`No WFS count: ${body.slice(0, 300)}`);
      return Number(match[1]);
    };
    const count = await hits();
    console.log(`Acquiring ${type}: ${count}`);
    const pageSize = type === "ms:baumkataster" ? count : 10000;
    for (let offset = 0; offset < count; offset += pageSize) {
      const data = await get(
        url(base, {
          ...common,
          startIndex: offset,
          count: pageSize,
          outputFormat: format,
          srsName: "EPSG:4326",
          ...(sort ? { sortBy: sort } : {}),
        }),
      );
      if (data.features.length !== Math.min(pageSize, count - offset))
        throw Error(`WFS incomplete page ${type} ${offset}: ${data.features.length}`);
      for (const feature of data.features) {
        feature.id = `${type}:${feature.id ?? `row:${offset + data.features.indexOf(feature) + 1}`}`;
        feature.properties["_sourceLayer"] = type;
      }
      yield data.features;
    }
    if ((await hits()) !== count) throw Error("WFS count changed");
  }
}
const by = "https://creativecommons.org/licenses/by/4.0/",
  zero = "https://creativecommons.org/publicdomain/zero/1.0/",
  dlby = "https://www.govdata.de/dl-de/by-2-0",
  dlzero = "https://www.govdata.de/dl-de/zero-2-0";
async function* luxembourgNational() {
  const meta = await get("https://data.public.lu/api/1/datasets/arbres-remarquables/");
  if (meta.license !== "cc-zero") throw Error("Luxembourg licence changed");
  const resource = meta.resources.find((item) => item.format === "geojson");
  if (!resource) throw Error("No official Luxembourg GeoJSON resource");
  const data = await get(resource.url);
  for (const feature of data.features) feature.id = feature.properties.nr_id;
  yield data.features;
}
async function* frankfurt() {
  const body = await get(
    "https://offenedaten.frankfurt.de/dcat/dataset/de-he-frankfurtam-baumkataster_op/content.csv",
    false,
  );
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') {
      if (quoted && body[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === ";" || c === "\n")) {
      row.push(field);
      field = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else if (c !== "\r" || quoted) field += c;
  }
  if (quoted) throw Error("Invalid CSV quoting");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  const features = [];
  for (const values of rows) {
    if (values.length === 1 && values[0] === "") continue;
    if (values.length !== headers.length) throw Error("CSV width mismatch");
    const p = Object.fromEntries(headers.map((key, i) => [key, values[i]]));
    const native = [number(p["ETRS 89 Rechtswert"]), number(p["ETRS 89 Hochwert"])];
    const valid = native.every(Number.isFinite) && native[1] >= 0 && native[1] <= 10_000_000;
    const xy = valid
      ? proj4("+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs", "EPSG:4326", native)
      : null;
    features.push({
      type: "Feature",
      id: p["Objelt ID"],
      geometry: xy !== null ? { type: "Point", coordinates: xy } : null,
      properties: p,
    });
  }
  yield features;
}
async function* brussels() {
  const data = await get("https://sites.heritage.brussels/medias/sites.trees.fr.json");
  for (const feature of data.features) {
    feature.id = feature.properties.id;
    const parts = feature.properties.name.split(/<br\s*\/?\s*>/i);
    feature.properties = {
      id: feature.properties.id,
      nom: feature.properties.nom,
      common: parts[1]?.trim() ?? null,
      location: parts.slice(2).join(", ").trim(),
    };
  }
  yield data.features;
}
const definitions = [
  {
    id: "brussels",
    source: brussels,
    url: "https://sites.heritage.brussels/fr/cartographie/",
    licence: "Publisher information-reuse terms (attribution required)",
    licenceUrl: "https://sites.heritage.brussels/fr/legal/",
    attribution: "Direction des Monuments et des Sites (DMS), Région de Bruxelles-Capitale (MRBC)",
    coverage:
      "Factual extract from the official remarkable-tree map. Selected heritage trees, not a complete city census. Custom attribution terms apply; photographs and narrative descriptions are excluded.",
    map: (p) => ({
      tag: text(p.id),
      scientificName: text(p.nom),
      commonName: text(p.common),
      location: text(p.location),
    }),
  },
  {
    id: "rotterdam",
    source: () =>
      wfs(
        "https://ows.gis.rotterdam.nl/cgi-bin/mapserv.exe?map=d:%5Cgwr%5Cwebdata%5Cmapserver%5Cmap%5Cbbdwh_pub.map",
        ["ms:obs_bmn_alg", "ms:obs_bmn_bos", "ms:obs_bmn_depot"],
        "ID",
        "application/json; subtype=geojson",
      ),
    url: "https://data.overheid.nl/dataset/6371060d-ebef-480f-939e-a07a678cf0b3",
    licence: "Public Domain Mark 1.0",
    licenceUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    attribution: "Gemeente Rotterdam",
    coverage:
      "Published general, woodland and depot tree layers. Special-tree and genus-rendering layers are excluded as overlapping views. Woodland and depot layers were empty at acquisition.",
    map: (p) => ({
      tag: text(p.ID),
      scientificName: text(p.BOOMSORTIMENT),
      commonName: text(p.BOOMSORTIMENT_NEDERLANDS),
      location: text(p.STRAAT),
      plantingYear: year(p.AANLEGJAAR),
      age: text(p.ONTWIKKELINGSFASE),
      qualityNotes: [
        "Source height class: " +
          (p.HOOGTE ?? "unknown") +
          ". Diameter and crown units are unverified. Source status: " +
          (p.BOOMSTATUS ?? "unknown") +
          ".",
      ],
    }),
  },
  {
    id: "antwerp",
    source: () =>
      arc(
        "https://geodata.antwerpen.be/arcgissql/rest/services/P_Groeninventaris/Groeninventaris_extern/MapServer",
        [5],
      ),
    url: "https://ebesluit.antwerpen.be/zittingen/15.1003.2844.0208/agendapunten/21.0205.3821.6720",
    licence: "Gratis Open Data Licentie Vlaanderen v1.0",
    licenceUrl: "https://www.antwerpen.be/info/gratis-open-data-licentie",
    attribution: "bron stad Antwerpen",
    coverage:
      "Published individually managed trees in public space. Woodland is represented separately as areas. The council approved release of Groeninventaris_BOOM as open data in 2015.",
    map: (p) => ({
      tag: text(p.ANTW_ID),
      scientificName: text(p.LATBOOMSOORT),
      location: text(p.DISTRICT),
      qualityNotes: [
        "Source trunk circumference: " +
          (p.STAMOMTREK ?? "unknown") +
          ". Units have not been verified.",
      ],
    }),
  },
  {
    id: "luxembourgnational",
    source: luxembourgNational,
    url: "https://data.public.lu/fr/datasets/arbres-remarquables/",
    licence: "CC0 1.0",
    licenceUrl: zero,
    attribution: "Administration de la nature et des forêts — Luxembourg",
    coverage: "Selected remarkable trees across Luxembourg; this is not a national tree census.",
    map: (p) => ({
      tag: text(p.nr_id),
      scientificName: text(p.essence),
      location: text(p.commune),
      qualityNotes: ["Selected remarkable tree. Interest: " + (p.interet ?? "not recorded") + "."],
    }),
  },
  {
    id: "frankfurt",
    source: frankfurt,
    url: "https://offenedaten.frankfurt.de/dcat/dataset/de-he-frankfurtam-baumkataster_op.html",
    licence: "Datenlizenz Deutschland — Namensnennung 2.0",
    licenceUrl: dlby,
    attribution: "Stadt Frankfurt am Main — Grünflächenamt",
    coverage:
      "Complete official CSV snapshot dated 1 August 2024, published February 2025. Newer changes in the public map are not implied.",
    map: (p) => ({
      tag: text(p.Baumnummer),
      scientificName: text(p["Lateinischer Name"]?.split(",")[0]),
      commonName: text(p["Lateinischer Name"]?.split(",").slice(1).join(",")),
      location: text(p.Strasse),
      plantingYear: year(p.Pflanzjahr),
      crown: measure(p["Kronen Durchmesser in Meter"], "m"),
      circumference: measure(p["Stamm Umfang in cm"], "cm"),
      qualityNotes: [
        "Source height: " +
          (p["Baumhöhe"] ?? "unknown") +
          ". Height units require source confirmation. Snapshot: 1 August 2024.",
      ],
    }),
  },
  {
    id: "nantes",
    source: () =>
      ods(
        "https://data.nantesmetropole.fr",
        "244400404_patrimoine-arbore-nantes-metropole",
        "id_emplacement",
      ),
    url: "https://data.nantesmetropole.fr/explore/dataset/244400404_patrimoine-arbore-nantes-metropole/",
    licence: "Licence Ouverte",
    licenceUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence",
    attribution: "Nantes Métropole et Ville de Nantes — Direction Nature et Jardins",
    coverage:
      "Published tree locations across Nantes Métropole and city-managed properties. Includes empty planting sites and source records awaiting qualification.",
    map: (p) => ({
      tag: text(p.id_emplacement),
      scientificName:
        p.lib_espece === "VIDE"
          ? null
          : text([p.lib_genre, p.lib_espece, p.lib_sous_espece].filter(Boolean).join(" ")),
      location: text(p.nom),
      plantingYear: year(p.annee_plantation),
      observedAt: text(p.date_inventaire),
      age: text(p.classe_age),
      status: p.statut === "Planté" ? "existing" : "unknown",
      qualityNotes: [
        "Source status: " +
          (p.statut ?? "unknown") +
          "; species/site: " +
          (p.lib_genre ?? "") +
          " " +
          (p.lib_espece ?? "") +
          ". Height class: " +
          (p.lib_hauteur_totale ?? "unknown") +
          ". Crown is an estimate; diameter units are unverified.",
      ],
    }),
  },
  {
    id: "ghent",
    source: () => ods("https://data.stad.gent", "locaties-bomen-gent", "gis_id"),
    url: "https://data.stad.gent/explore/dataset/locaties-bomen-gent/",
    licence: "Modellicentie Gratis Hergebruik",
    licenceUrl:
      "https://www.vlaanderen.be/digitaal-vlaanderen/onze-oplossingen/open-data/voorwaarden-voor-het-hergebruik-van-overheidsinformatie/modellicentie-gratis-hergebruik",
    attribution: "Stad Gent — Groendienst",
    coverage:
      "Published tree locations; incomplete inventory and source updates paused during migration. Circumferences can be group averages.",
    map: (p) => ({
      scientificName: text(p.sortiment),
      location: text(p.straatnaam),
      plantingYear: year(p.aanlegjaar),
      qualityNotes: [
        "Source height class: " +
          (p.hoogte ?? "unknown") +
          ". Circumferences may be group averages; individual measurements remain unknown.",
      ],
    }),
  },
  {
    id: "liege",
    source: () => ods("https://www.odwb.be", "arbustum", "arbotag"),
    url: "https://www.odwb.be/explore/dataset/arbustum/",
    licence: "CC BY 4.0",
    licenceUrl: by,
    attribution: "Ville de Liège",
    coverage: "All published tagged public trees; this excludes untagged trees.",
    map: (p) => ({
      tag: text(p.arbotag),
      scientificName: text(p.tree_species),
      location: text(p.street_name),
      plantingYear: year(p.planting_year),
      height: measure(p.height, "m"),
      crown: measure(p.top_diameter, "m"),
      circumference: measure(p.circumference, "cm"),
    }),
  },
  {
    id: "eindhoven",
    source: () => ods("https://data.eindhoven.nl", "bomen", "objectid"),
    url: "https://data.eindhoven.nl/explore/dataset/bomen/",
    licence: "Public domain",
    licenceUrl: "https://data.overheid.nl/dataset/a265b796-2876-44bf-b74d-b4ccc4ad55a0",
    attribution: "Gemeente Eindhoven",
    coverage:
      "Published municipal and selected valuable private trees; woodland trees are usually absent.",
    map: (p) => ({
      tag: text(p.boomnummer),
      scientificName: text(p.boomsoort),
      commonName: text(p.boomsoort_nederlands),
      plantingYear: year(p.plantjaar),
      qualityNotes: [
        "Source height class (m): " +
          (p.hoogte ?? "unknown") +
          ". Protection status: " +
          (p.status_ter_indicatie ?? "not specified") +
          "; this is not living status.",
      ],
    }),
  },
  {
    id: "arnhem",
    source: () =>
      arc("https://geo.arnhem.nl/arcgis/rest/services/OpenData/Bomenkaart/MapServer", [0]),
    url: "https://data.overheid.nl/dataset/bomenkaart-arnhem",
    licence: "CC BY 4.0",
    licenceUrl: by,
    attribution: "Gemeente Arnhem",
    coverage:
      "Published managed freestanding trees and valuable trees; not every tree in woodland.",
    map: (p) => ({
      tag: text(p.BOOMNUMMER),
      scientificName: text(p.BOOMSOORT),
      commonName: text(p.NEDERLANDSE_NAAM),
      location: text(p.STRAATNAAM),
      plantingYear: year(p.PLANTJAAR),
      qualityNotes: [
        "Source crown description: " +
          (p.KROONDIAMETER_ACTUEEL ?? "unknown") +
          ". Diameter class: " +
          (p.STAMDIAMETERKLASSE ?? "unknown") +
          ". Unverified units remain unknown.",
      ],
    }),
  },
  {
    id: "delft",
    source: () =>
      arc(
        "https://services3.arcgis.com/j07voPd56xoB4c87/arcgis/rest/services/Bomen%20in%20beheer%20door%20gemeente%20Delft/FeatureServer",
        [0],
      ),
    url: "https://data.overheid.nl/dataset/bomen-in-beheer-door-gemeente-delft",
    licence: "CC BY 4.0",
    licenceUrl: by,
    attribution: "Gemeente Delft",
    coverage: "All published municipal tree rows. Inventory accuracy and update dates vary.",
    map: (p) => ({
      tag: text(p.ELEMENTNUMMER),
      scientificName: text(p.BOOMSORTIMENT),
      location: text(p.LIGGING ?? p.GROENGEBIEDNAAM),
      plantingYear: year(p.AANLEGJAAR),
      qualityNotes: [
        "Source tree status: " +
          (p.BOOMSTATUS ?? "unknown") +
          ". Height: " +
          (p.HOOGTE ?? "unknown") +
          "; diameter: " +
          (p.DIAMETER ?? "unknown") +
          ". Units are not verified.",
      ],
    }),
  },
  {
    id: "utrecht",
    source: () =>
      arc(
        "https://services-eu1.arcgis.com/SMnoOtmU2UWf0vRp/arcgis/rest/services/bomenkaart_2026/FeatureServer",
        [0, 1],
      ),
    url: "https://open.utrecht.nl/dataset/bomen/24462069-4993-4106-9e69-a52d5e56baac",
    licence: "CC BY-SA 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    attribution: "Gemeente Utrecht",
    coverage:
      "Current 2026 tree service: park/street trees and trees in wooded planting areas. Layer-qualified IDs preserve every source row.",
    map: (p) => ({
      tag: text(p.Boomnummer),
      scientificName: text(p.Wetenschap),
      commonName: text(p.Nederlands),
      location: text(p.Buurtnaam ?? p.Wijknaam),
      plantingYear: year(p.plantjaar),
    }),
  },
  {
    id: "leipzig",
    source: () =>
      wfs("https://geodienste.leipzig.de/l3/OpenData/wfs", ["OpenData:Baeume"], "objectid"),
    url: "https://www.opendata.leipzig.de/dataset/baumkataster-stadt-leipzig1",
    licence: "Datenlizenz Deutschland — Namensnennung 2.0",
    licenceUrl: dlby,
    attribution: "Stadt Leipzig",
    coverage:
      "All published municipal inventory records; field collection is incomplete. Removed and planned replacement information is retained.",
    map: (p) => ({
      tag: text(p.baumnummer),
      scientificName: text(p.ga_lang_wiss),
      commonName: text(p.ga_lang_deutsch),
      location: text(p.strasse),
      plantingYear: year(p.pflanzjahr),
      status: p.gefaellt_am ? "removed" : "unknown",
      qualityNotes: [
        "Source height: " +
          (p.baumhoehe ?? "unknown") +
          "; crown: " +
          (p.kr_durchm ?? "unknown") +
          "; circumference: " +
          (p.st_umfang ?? "unknown") +
          ". Units require field documentation. Replacement planned: " +
          (p.nachpflanzung_geplant || "not specified") +
          ".",
      ],
    }),
  },
  {
    id: "cologne",
    source: () =>
      wfs(
        "https://geoportal.stadt-koeln.de/wss/service/baumkataster_extern_wfs/guest",
        ["ms:baumkataster"],
        "Baumnummer",
        "geojson",
      ),
    projection: "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs",
    url: "https://data.gov.de/suche/daten/baumkataster-koln-fortlaufend-aktualisiert",
    licence: "Datenlizenz Deutschland — Zero 2.0",
    licenceUrl: dlzero,
    attribution: "Stadt Köln",
    coverage:
      "All current published municipal individual trees; fields remain incomplete after system migration. Native GeoJSON coordinates are ETRS89 UTM32 despite the requested WGS84 output.",
    map: (p) => ({
      tag: text(p.Baumnummer),
      scientificName: text(p.Botanischer_Name),
      commonName: text(p.Deutscher_Name),
      location: text(p["Straße"]),
      plantingYear: year(p.Pflanzjahr),
      height: measure(p["Höhe_-_m"], "m"),
      crown: measure(p["Kronendurchmesser_-_m"], "m"),
      circumference: measure(p["Stammumfang_-_cm"], "cm"),
    }),
  },
  {
    id: "rostock",
    swapCoordinates: true,
    source: () =>
      wfs(
        "https://geo.sv.rostock.de/geodienste/baeume/wfs",
        ["baeume:hro.baeume.baeume"],
        undefined,
        "application/geo+json",
      ),
    url: "https://geo.sv.rostock.de/geodienste",
    licence: "CC0 1.0",
    licenceUrl: zero,
    attribution: "Hanse- und Universitätsstadt Rostock",
    coverage:
      "All records in the published Bäume layer. This is not a census of all physical trees.",
    map: (p) => ({
      scientificName: text(p.art_botanisch ?? p.gattung_botanisch),
      commonName: text(p.art_deutsch ?? p.gattung_deutsch),
      height: measure(p.hoehe, "m"),
      crown: measure(p.kronendurchmesser, "m"),
      circumference: measure(p.stammumfang, "cm"),
    }),
  },
  {
    id: "berlin",
    source: () =>
      wfs(
        "https://gdi.berlin.de/services/wfs/baumbestand",
        ["baumbestand:strassenbaeume", "baumbestand:anlagenbaeume"],
        "gisid",
      ),
    url: "https://daten.berlin.de/datensaetze/baumbestand-berlin-wfs-48ad3a23",
    licence: "Datenlizenz Deutschland — Zero 2.0",
    licenceUrl: dlzero,
    attribution: "Senatsverwaltung für Mobilität, Verkehr, Klimaschutz und Umwelt Berlin",
    coverage:
      "All published street and park WFS tree records. The geographic service can omit inventory records without positions; private and separately managed trees are outside this source.",
    map: (p) => ({
      tag: text(p.standortnr),
      scientificName: text(p.art_bot),
      commonName: text(p.art_dtsch),
      location: text(p.strname ?? p.namenr),
      plantingYear: year(p.pflanzjahr),
      height: measure(p.baumhoehe, "m"),
      crown: measure(p.kronedurch, "m"),
      circumference: measure(p.stammumfg, "cm"),
      status: "existing",
    }),
  },
];
const blocked = [
  {
    id: "luxembourg",
    url: "https://www.vdl.lu/fr/visiter/loisirs-et-nature/arbres/cadastre",
    reason:
      "The official map exposes DYNDATA/SCENERY/FeatureServer/0. A sample query returned Latin names and WGS84 points. Service copyright and portal item licenseInfo are empty. The national open-data catalogue returned no matching city tree cadastre. Bulk redistribution permission remains unverified.",
  },
  {
    id: "gdansk",
    url: "https://ckan.multimediagdansk.pl/dataset/drzewa-w-gdansku",
    reason:
      "The official CKAN record links an October 2026 Gdanska_Zielen_WFS service and field dictionaries. Its licence fields are empty. Service requests failed or timed out during this review. Both a working full export and applicable reuse terms must be verified.",
  },
  {
    id: "wroclaw",
    url: "https://geoportal.wroclaw.pl/mapy/zzm/",
    reason:
      "The official ZZM MapServer layer 3 returned 104012 records in a count query. It exposes Latin/common names, arbotag and circumference fields. Service copyright is empty. General portal permissions for other resources do not establish permission for this tree layer. Redistribution terms remain unverified.",
  },
  {
    id: "poznan",
    url: "https://geopoz.poznan.pl/geo/aktualnosci/1719,Roslinnosc-w-Modelu-3D.html",
    reason:
      "The official 3D model and public configuration expose inventoried vegetation and separate remote-sensing layers. The map offers area-based exports. This review did not verify a complete repeatable individual-tree export with applicable redistribution terms. LiDAR trees must not be presented as species inventories.",
  },
  {
    id: "warsaw",
    url: "https://zzw.waw.pl/nasze-dzialania/zielen/zarzadzanie-zielenia/",
    reason:
      "The official page distinguishes Baza Zieleni field inventory from canopy mapping. The linked map failed to connect during this review. No complete licensed individual-tree export was verified. A WMS map alone does not meet the search and details contract.",
  },
];
await mkdir(raw, { recursive: true });
let sources = [];
try {
  sources = JSON.parse(await readFile(new URL("north-provenance.json", raw), "utf8")).sources;
} catch {}
let fixtures = {};
try {
  fixtures = JSON.parse(
    await readFile(new URL("../tests/fixtures/expansion-north.json", import.meta.url), "utf8"),
  );
} catch {}
const refresh = process.argv.includes("--refresh");
const requested = process.argv.slice(2).filter((value) => !value.startsWith("--"));
for (const definition of definitions) {
  if (requested.length && !requested.includes(definition.id)) continue;
  if (sources.some((source) => source.id === definition.id) && !refresh) {
    console.log(`Retaining acquired ${definition.id}`);
    continue;
  }
  requests.length = 0;
  const temporary = new URL(`${definition.id}-north-acquiring.json`, raw),
    handle = await open(temporary, "w"),
    digest = createHash("sha256");
  let count = 0,
    missing = 0,
    bbox = [180, 90, -180, -90];
  const ids = new Set(),
    examples = [];
  const emit = async (value) => {
    digest.update(value);
    await handle.writeFile(value);
  };
  try {
    await emit('{"type":"FeatureCollection","features":[');
    for await (const page of definition.source()) {
      const output = [];
      for (const feature of page) {
        const id = text(feature.id);
        if (id === null || ids.has(id)) throw Error(`${definition.id} missing/duplicate ID ${id}`);
        ids.add(id);
        if (definition.swapCoordinates && feature.geometry?.type === "Point")
          feature.geometry.coordinates = [
            feature.geometry.coordinates[1],
            feature.geometry.coordinates[0],
          ];
        const point = geometry(feature, definition.projection);
        if (point === null) missing++;
        else {
          const [x, y] = point.coordinates;
          bbox = [
            Math.min(bbox[0], x),
            Math.min(bbox[1], y),
            Math.max(bbox[2], x),
            Math.max(bbox[3], y),
          ];
        }
        const atlas = { ...defaults(id), ...definition.map(feature.properties) };
        const sourceYear = [
          "pflanzjahr",
          "Pflanzjahr",
          "aanlegjaar",
          "AANLEGJAAR",
          "PLANTJAAR",
          "plantjaar",
          "planting_year",
          "annee_plantation",
        ]
          .map((field) => feature.properties[field])
          .find((value) => value !== null && value !== undefined && String(value).trim() !== "");
        if (sourceYear !== undefined && year(sourceYear) === null)
          atlas.qualityNotes = [
            ...(atlas.qualityNotes ?? []),
            `Source planting year: ${String(sourceYear)}. Outside the supported year range or not a valid year.`,
          ];
        if (definition.id === "frankfurt" && point === null)
          atlas.qualityNotes = [
            ...(atlas.qualityNotes ?? []),
            "Source UTM coordinate is invalid: northing must be finite and within 0–10000000 metres. Position withheld; original values and record retained.",
          ];
        const outputFeature = {
          type: "Feature",
          geometry: point,
          properties: { ...feature.properties, atlas },
        };
        if (examples.length < 2) examples.push(outputFeature);
        output.push(JSON.stringify(outputFeature));
      }
      await emit((count ? "," : "") + output.join(","));
      count += page.length;
      console.log(`${definition.id}: ${count}`);
    }
    await emit("]}");
    await handle.close();
    const sha256 = digest.digest("hex"),
      file = `${definition.id}-${sha256.slice(0, 16)}.json`;
    await rename(temporary, new URL(file, raw));
    sources = sources.filter((source) => source.id !== definition.id);
    sources.push({
      id: definition.id,
      scope: "full",
      file,
      sha256,
      count,
      bbox,
      retrievedAt: new Date().toISOString(),
      url: definition.url,
      licence: definition.licence,
      licenceUrl: definition.licenceUrl,
      attribution: definition.attribution,
      coverage: definition.coverage,
      coordinateReferenceSystem: "EPSG:4326",
      geometryAudit: { located: count - missing, unlocated: missing },
      requests: [...requests],
    });
    fixtures[definition.id] = examples;
    await writeFile(
      new URL("north-provenance.json", raw),
      JSON.stringify({ schemaVersion: 1, sources, blocked }, null, 2),
    );
    await writeFile(
      new URL("../tests/fixtures/expansion-north.json", import.meta.url),
      JSON.stringify(fixtures, null, 2),
    );
  } catch (error) {
    process.exitCode = 1;
    await handle.close().catch(() => {});
    console.error(`${definition.id}: ${error.message}`);
    await writeFile(new URL(`${definition.id}-failure.txt`, raw), String(error.stack));
  }
}

await writeFile(
  new URL("north-provenance.json", raw),
  JSON.stringify({ schemaVersion: 1, sources, blocked }, null, 2),
);
