# Pilot data sources

These are bounded extracts for testing the architecture, not city-wide tree counts. The checked-in release is reproducible from the raw acquisition manifest and source adapters. Running the downloader later produces a new acquisition; it cannot recreate an upstream snapshot that the publisher no longer serves.

`pnpm data:download` (or `node scripts/download-sources.mjs`) downloads the inventory sources. It writes content-addressed raw files, then replaces `data/raw/provenance.json` only after all sources pass acquisition checks. Raw downloads are not shipped to the browser. The manifest records exact request URLs, response hashes, retrieval times, geographic windows and observed source issues. The release preparation step must verify those hashes before normalization. A failed download must not replace the last good published release.

## Vienna

- Publisher: Stadt Wien; [official dataset](https://www.data.gv.at/datasets/c91a4635-8b7d-43fe-9b27-d95dec8392a7).
- Service: [WFS capabilities](https://data.wien.gv.at/daten/geo?service=WFS&request=GetCapabilities), `ogdwien:BAUMKATOGD`, WFS 1.1.0, requested EPSG:4326 GeoJSON.
- Window: longitude 16.383–16.405, latitude 48.202–48.213 (Hundertwasserhaus / western Prater).
- Acquisition on 26 October 2026: **4,384 records returned by the source envelope query**. Nine lie outside the exact longitude/latitude box and must be excluded during normalization, leaving 4,375 before other validation. A separate WFS `resultType=hits` count must equal the fetched record count. The window is deliberately limited to fewer than 10,000 records; an unexpectedly empty or larger response fails.
- Reuse: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution: **Datenquelle: Stadt Wien — data.wien.gv.at**. Processing: geographic subset and normalization.

`OBJECTID` identifies a source row in this release. The response also includes `BAUM_ID`; this pilot does not assume either field is permanent across publisher refreshes. `BAUMNUMMER` is a displayed tag, not a globally unique ID. `GATTUNG_ART` contains botanical and often German common names. `OBJEKT_STRASSE` is a source location label. `PFLANZJAHR` is planting year; zero means unrecorded. `STAMMUMFANG` is circumference in centimetres. `BAUMHOEHE` and `KRONENDURCHMESSER` are class codes, not measured metres; the source also supplies corresponding `_TXT` labels. Preserve ranges and open-ended classes.

This inventory concerns managed public trees and has incomplete coverage of other trees. A complete response for this window is not evidence that every physical tree is recorded.

## Geneva

- Publisher: SITG / Ville de Genève; [official metadata and field definitions](https://sitg.ge.ch/donnees/sipv-ica-arbre-isole).
- Service: [ArcGIS FeatureServer layer 0](https://vector.sitg.ge.ch/arcgis/rest/services/SIPV_ICA_ARBRE_ISOLE/FeatureServer/0).
- Window: longitude 6.135–6.155, latitude 46.195–46.212 (central Geneva).
- Acquisition on 26 October 2026: **4,855 source rows returned by the envelope query**. Of these, 170 lie outside the exact longitude/latitude box and must be excluded during normalization, leaving 4,685 before other validation. Fetch all matching object IDs, request records in batches of 300, verify every requested object ID is returned exactly once, reject transfer-limit flags, and repeat the ID query after acquisition. This detects membership changes, but does not provide an upstream transaction snapshot.
- Reuse: **SITG A — Accès libre**. The [SITG conditions](https://sitg.ge.ch/ressources/conditions-utilisation-donnees) permit public and commercial reuse with source, extraction date/frequency and processing stated. Attribution: **Données SITG / Ville de Genève, extracted 26 October 2026; geographic subset and normalization**.

The source explicitly describes `ID_ARBRE` as permanent and warns against using `OBJECTID` permanently. **The actual pilot extract contains a conflict:** `ID_ARBRE=395916` appears on four rows, `OBJECTID=223758…223761`, at different coordinates. Keep all four rows. Their release-scoped identities must include the object ID and carry an identity warning. Do not silently overwrite or merge them; no proximity-based deduplication is performed. Other unique `ID_ARBRE` values can retain the documented stable identity.

`NOM_COMPLET` is the Latin name. `NO_INVENTAIRE` is an inventory tag. `HAUTEUR_TOTALE` and `DIAMETRE_COURONNE` are metres; `CIRCONFERENCE_1M` is centimetres measured at one metre above the ground. `DATE_PLANTATION` and `DATE_OBSERVATION` are epoch-millisecond date values in ArcGIS JSON. `DATE_PLANTATION_ESTIMEE=1` marks an estimated planting date. Keep estimated planting separate from known planting; do not infer an exact year from age. `SOUCHE` distinguishes stumps. `STATUT` describes survey / position status, not whether a tree is alive. `ID_ACTEUR` is intentionally not requested; observer identities are unnecessary for this app.

The inventory covers isolated trees outside forests across the canton, not only the city. Historical positions can be approximately 25 metres from the actual location; recent field surveys are described as approximately one metre. An imported record does not guarantee that a tree still exists today.

The service returned intermittent ArcGIS errors during validation. The downloader makes at most three attempts per request and fails closed. A direct feature query also returned `exceededTransferLimit=true` with fewer rows than its requested maximum, so response length alone is not a valid completeness check.

## Porto

- Publisher: Município do Porto; [official dataset](https://dadosabertos.cm-porto.pt/dataset/identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto).
- Metadata: [CKAN package API](https://dadosabertos.cm-porto.pt/api/3/action/package_show?id=identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto).
- Resource: [official GeoJSON download](https://dadosabertos.cm-porto.pt/dataset/7177befc-9e19-11f1-84ed-6abdb6d5cf34/resource/d0a25fb0-b28d-44d3-b0a6-a77fa63c4264/download/identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto_geojson.geojson).
- Window: longitude −8.622–−8.599, latitude 41.141–41.156 (central Porto).
- Acquisition on 26 October 2026: full resource **71,634 point records**, of which **2,328** intersect the declared window. The downloader validates the complete FeatureCollection and unique row IDs before clipping. No independent source total was available; this establishes completeness relative to the downloaded resource, not an independently audited city inventory.
- Reuse: metadata declares **CC0** ([terms](https://creativecommons.org/publicdomain/zero/1.0/)). Credit: **Município do Porto**. Metadata modified 1 October 2026; this is not a tree survey date.

The actual GeoJSON properties are `objectid`, `esp_nomecientifico`, `esp_nomecomum` and `arv_intervalo_idade`. Preserve the scientific name, Portuguese common name and source age interval. Although the catalogue description mentions planting dates, this downloaded resource contains an age interval, not a planting date. Do not manufacture planting years or height measurements. Source ID permanence is not documented, so links are release-scoped.

Coordinates are longitude/latitude WGS84. The publisher describes public-domain municipal trees; the pilot subset is not a census of private trees or vegetation.

## Limits shared by the inventory extracts

The geographic windows are inclusive bounding boxes. Native-CRS envelope queries can return extra points beyond the requested WGS84 rectangle; exact longitude/latitude clipping must happen before publication. Browser search can only claim completeness within the published window and for accepted source records. Rejected rows and identity conflicts must be visible in release metadata. Raw records are not deduplicated across publishers. Fetch time, source metadata update time, observation time and planting time are separate facts.

Source APIs may change, temporarily fail or alter historical records. A successful previous acquisition does not guarantee the next one. Hashes prove which bytes were processed; they do not prove upstream accuracy.
