# Leipzig

Reviewed 27 October 2026. The acquired snapshot contains 187,989 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://www.opendata.leipzig.de/dataset/baumkataster-stadt-leipzig1). [Datenlizenz Deutschland — Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0). Attribution: Stadt Leipzig.

All published municipal inventory records; field collection is incomplete. Removed and planned replacement information is retained.

## Interface

- [OpenData/wfs](https://geodienste.leipzig.de/l3/OpenData/wfs)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: Rhododendron 'Pink Pearl'; Ostfriedhof. Source height: unknown; crown: unknown; circumference: unknown. Units require field documentation. Replacement planned: not specified.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs leipzig --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.
