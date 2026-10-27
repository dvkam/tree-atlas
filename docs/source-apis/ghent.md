# Ghent

Reviewed 27 October 2026. The acquired snapshot contains 68,240 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://data.stad.gent/explore/dataset/locaties-bomen-gent/). [Modellicentie Gratis Hergebruik](https://www.vlaanderen.be/digitaal-vlaanderen/onze-oplossingen/open-data/voorwaarden-voor-het-hergebruik-van-overheidsinformatie/modellicentie-gratis-hergebruik). Attribution: Stad Gent — Groendienst.

Published tree locations; incomplete inventory and source updates paused during migration. Circumferences can be group averages.

## Interface

- [datasets/locaties-bomen-gent](https://data.stad.gent/api/explore/v2.1/catalog/datasets/locaties-bomen-gent)
- [exports/geojson](https://data.stad.gent/api/explore/v2.1/catalog/datasets/locaties-bomen-gent/exports/geojson)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: Prunus cerasifera 'Nigra'; Gentbruggeplein. Source height class: <6 m.. Circumferences may be group averages; individual measurements remain unknown.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs ghent --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.
