# Eindhoven

Reviewed 27 October 2026. The acquired snapshot contains 128,034 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://data.eindhoven.nl/explore/dataset/bomen/). [Public domain](https://data.overheid.nl/dataset/a265b796-2876-44bf-b74d-b4ccc4ad55a0). Attribution: Gemeente Eindhoven.

Published municipal and selected valuable private trees; woodland trees are usually absent.

## Interface

- [datasets/bomen](https://data.eindhoven.nl/api/explore/v2.1/catalog/datasets/bomen)
- [exports/geojson](https://data.eindhoven.nl/api/explore/v2.1/catalog/datasets/bomen/exports/geojson)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: Acer rubrum; location text not supplied. Source height class (m): 6-9. Protection status: not specified; this is not living status.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs eindhoven --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.
