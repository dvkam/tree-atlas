# Rostock

Reviewed 27 October 2026. The acquired snapshot contains 70,590 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://geo.sv.rostock.de/geodienste). [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Attribution: Hanse- und Universitätsstadt Rostock.

All records in the published Bäume layer. This is not a census of all physical trees.

## Interface

- [baeume/wfs](https://geo.sv.rostock.de/geodienste/baeume/wfs)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: Acer species; location text not supplied.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs rostock --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.
