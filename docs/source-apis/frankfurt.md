# Frankfurt

Reviewed 27 October 2026. The acquired snapshot contains 163,569 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://offenedaten.frankfurt.de/dcat/dataset/de-he-frankfurtam-baumkataster_op.html). [Datenlizenz Deutschland — Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0). Attribution: Stadt Frankfurt am Main — Grünflächenamt.

Complete official CSV snapshot dated 1 August 2024, published February 2025. Newer changes in the public map are not implied.

## Interface

- [de-he-frankfurtam-baumkataster_op/content.csv](https://offenedaten.frankfurt.de/dcat/dataset/de-he-frankfurtam-baumkataster_op/content.csv)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: Platanus acerifolia; Ackermannstrasse. Source height: 7. Height units require source confirmation. Snapshot: 1 August 2024.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs frankfurt --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.

Three rows have malformed eight-digit UTM northings (about 55 million metres). Their positions are withheld. All three remain searchable. The snapshot has 163,566 located records and three unlocated records.

Validation uses the native UTM northing range of 0–10,000,000 metres, not a city bounding box. Valid distant coordinates are retained. Planting years use the shared 1000–2200 domain range.
