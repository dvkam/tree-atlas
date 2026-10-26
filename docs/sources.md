# Inventory data sources

The inventory releases now contain **every available source record** for Vienna, the canton of Geneva and Porto, without study-window filters. The full acquisition on **26 October 2026** contains **545,563 source rows**: 233,102 Vienna, 240,827 Geneva and 71,634 Porto. All have valid WGS84 point geometry. These are source inventory counts, not a census of every physical tree. The Copernicus canopy layer remains a separate, geographically limited layer; see its own source documentation.

The checked-in release is reproducible from the raw acquisition manifest and source adapters. Running the downloader later produces a new acquisition; it cannot recreate an upstream snapshot that the publisher no longer serves.

`pnpm data:download` runs the combined source acquisition and writes `data/raw/provenance.json` after its source checks pass. The direct command `node scripts/download-sources.mjs` downloads only Vienna, Geneva and Porto. It writes content-addressed raw files and `data/raw/original-provenance.json`; it does not assemble the combined provenance file. Raw downloads are not shipped to the browser. The manifest records `scope: full`, exact request URLs, response hashes, retrieval times, measured point extents, geometry audits and observed identity issues. The release preparation step must verify those hashes before normalization. A failed download must not replace the last good published release.

## Vienna

- Publisher: Stadt Wien; [official dataset](https://www.data.gv.at/datasets/c91a4635-8b7d-43fe-9b27-d95dec8392a7).
- Service: [WFS capabilities](https://data.wien.gv.at/daten/geo?service=WFS&request=GetCapabilities), `ogdwien:BAUMKATOGD`, WFS 1.1.0, requested EPSG:4326 GeoJSON.
- Scope: the complete available `BAUMKATOGD` layer. Measured point extent: longitude 16.12399706–16.56954724, latitude 48.12284919–48.31979651. This is a data extent, not an administrative boundary or a query filter.
- Acquisition on 26 October 2026: **233,102 records**, all with valid point geometry. WFS `resultType=hits` counts before and after acquisition both equal the downloaded count. Keyset paging requests up to 10,000 rows ordered by `OBJECTID`, with the next query requiring an ID greater than the previous page's last ID. Every ID must increase strictly; an empty final page is required. Count changes or duplicate/non-increasing IDs abort publication. The source has no transaction snapshot: concurrent edits that leave the total count unchanged cannot be excluded.
- Reuse: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution: **Datenquelle: Stadt Wien — data.wien.gv.at**. Processing: normalization, no geographic filtering.

`OBJECTID` identifies a source row in this release. The response also includes `BAUM_ID`; this pilot does not assume either field is permanent across publisher refreshes. `BAUMNUMMER` is a displayed tag, not a globally unique ID. `GATTUNG_ART` contains botanical and often German common names. `OBJEKT_STRASSE` is a source location label. `PFLANZJAHR` is planting year; zero means unrecorded. `STAMMUMFANG` is circumference in centimetres. `BAUMHOEHE` and `KRONENDURCHMESSER` are class codes, not measured metres; the source also supplies corresponding `_TXT` labels. Preserve ranges and open-ended classes.

This inventory concerns managed public trees and has incomplete coverage of other trees. Downloading the complete published layer is not evidence that every physical tree is recorded. Its measured count should not be replaced with a larger approximate figure from general descriptions of Vienna's tree management.

## Geneva

- Publisher: SITG / Ville de Genève; [official metadata and field definitions](https://sitg.ge.ch/donnees/sipv-ica-arbre-isole).
- Service: [ArcGIS FeatureServer layer 0](https://vector.sitg.ge.ch/arcgis/rest/services/SIPV_ICA_ARBRE_ISOLE/FeatureServer/0).
- Scope: the complete canton-wide layer, not only the city of Geneva. Measured point extent: longitude 5.95954258–6.30976916, latitude 46.13054446–46.36400288.
- Acquisition on 26 October 2026: **240,827 source rows**, all with valid point geometry. Fetch all object IDs without a spatial filter, cross-check `returnCountOnly`, request records in batches of 300 with six concurrent requests, verify every requested object ID is returned exactly once, reject transfer-limit flags, and repeat the full ID query after acquisition. The final membership check uses sets, not repeated linear searches. This detects membership changes, but does not provide an upstream transaction snapshot.
- Reuse: **SITG A — Accès libre**. The [SITG conditions](https://sitg.ge.ch/ressources/conditions-utilisation-donnees) permit public and commercial reuse with source, extraction date/frequency and processing stated. Attribution: **Données SITG / Ville de Genève, extracted 26 October 2026; normalization, no geographic filtering**.

The source explicitly describes `ID_ARBRE` as permanent and warns against using `OBJECTID` permanently. **The full source contains two conflicting identities across six rows:** `ID_ARBRE=393253` appears twice, and `ID_ARBRE=395916` appears four times (including `OBJECTID=223758…223761`) at different coordinates. Keep all rows. Their release-scoped identities must include the object ID and carry an identity warning. Do not silently overwrite or merge them; no proximity-based deduplication is performed. Other unique `ID_ARBRE` values can retain the documented stable identity. No missing `ID_ARBRE` values were observed in this acquisition.

One planting date is implausible: `ID_ARBRE=384757` / `OBJECTID=226999` has an estimated planting timestamp that resolves to year **202**. Retain the tree, report the source anomaly and leave its normalized planting year unknown. Do not assume the publisher meant 2002 or 2020. Raw provenance preserves the original value. Valid negative epoch timestamps elsewhere represent pre-1970 dates and must not be mistaken for missing values.

`NOM_COMPLET` is the Latin name. `NO_INVENTAIRE` is an inventory tag. `HAUTEUR_TOTALE` and `DIAMETRE_COURONNE` are metres; `CIRCONFERENCE_1M` is centimetres measured at one metre above the ground. `DATE_PLANTATION` and `DATE_OBSERVATION` are epoch-millisecond date values in ArcGIS JSON. `DATE_PLANTATION_ESTIMEE=1` marks an estimated planting date. Keep estimated planting separate from known planting; do not infer an exact year from age. `SOUCHE` distinguishes stumps. `STATUT` describes survey / position status, not whether a tree is alive. `ID_ACTEUR` is intentionally not requested; observer identities are unnecessary for this app.

The inventory covers isolated trees outside forests across the canton, not only the city. Historical positions can be approximately 25 metres from the actual location; recent field surveys are described as approximately one metre. An imported record does not guarantee that a tree still exists today.

The service returned intermittent ArcGIS errors during validation. The downloader makes at most four attempts per request with bounded backoff and fails closed. A direct feature query also returned `exceededTransferLimit=true` with fewer rows than its requested maximum, so response length alone is not a valid completeness check.

## Porto

- Publisher: Município do Porto; [official dataset](https://dadosabertos.cm-porto.pt/dataset/identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto).
- Metadata: [CKAN package API](https://dadosabertos.cm-porto.pt/api/3/action/package_show?id=identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto).
- Resource: [official GeoJSON download](https://dadosabertos.cm-porto.pt/dataset/7177befc-9e19-11f1-84ed-6abdb6d5cf34/resource/d0a25fb0-b28d-44d3-b0a6-a77fa63c4264/download/identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto_geojson.geojson).
- Scope: the complete published GeoJSON resource, without clipping. Measured point extent: longitude −8.68967341–−8.55626826, latitude 41.14006668–41.18585492.
- Acquisition on 26 October 2026: **71,634 point records**, all with valid geometry. The downloader validates the complete FeatureCollection and unique row IDs. No independent source total was available; this establishes completeness relative to the downloaded resource, not an independently audited city inventory.
- Reuse: metadata declares **CC0** ([terms](https://creativecommons.org/publicdomain/zero/1.0/)). Credit: **Município do Porto**. Metadata modified 1 October 2026; this is not a tree survey date.

The actual GeoJSON properties are `objectid`, `esp_nomecientifico`, `esp_nomecomum` and `arv_intervalo_idade`. Preserve the scientific name, Portuguese common name and source age interval. Although the catalogue description mentions planting dates, this downloaded resource contains an age interval, not a planting date. Do not manufacture planting years or height measurements. Source ID permanence is not documented, so links are release-scoped.

Coordinates are longitude/latitude WGS84. The publisher describes public-domain municipal trees; this is not a census of private trees or all vegetation.

## Limits shared by the inventories

The stored bounds are measured from every valid source point and must not be used as study-window exclusions. A full release must account for every acquired row. Missing/invalid geometries are audited separately and remain in raw input; they cannot be silently removed. This acquisition has none. Identity conflicts and any normalized invalid field values must remain visible in release metadata. Raw records are not deduplicated across publishers. Fetch time, source metadata update time, observation time and planting time are separate facts.

Source APIs may change, temporarily fail or alter historical records. A successful previous acquisition does not guarantee the next one. Hashes prove which bytes were processed; they do not prove upstream accuracy.
