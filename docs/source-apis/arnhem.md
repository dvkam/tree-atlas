# Arnhem

Reviewed 27 October 2026. The acquired snapshot contains 47,423 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://data.overheid.nl/dataset/bomenkaart-arnhem). [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution: Gemeente Arnhem.

Published managed freestanding trees and valuable trees; not every tree in woodland.

## Interface

- [MapServer/0](https://geo.arnhem.nl/arcgis/rest/services/OpenData/Bomenkaart/MapServer/0)
- [0/query](https://geo.arnhem.nl/arcgis/rest/services/OpenData/Bomenkaart/MapServer/0/query)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: Quercus rubra; Josef Israëlslaan. Source crown description: > 20 m. Diameter class: 100 tot 150 cm. Unverified units remain unknown.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs arnhem --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.
