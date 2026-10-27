# Rotterdam

Reviewed 27 October 2026. The acquired snapshot contains 199,558 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://data.overheid.nl/dataset/6371060d-ebef-480f-939e-a07a678cf0b3). [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/). Attribution: Gemeente Rotterdam.

Published general, woodland and depot tree layers. Special-tree and genus-rendering layers are excluded as overlapping views. Woodland and depot layers were empty at acquisition.

## Interface

- [cgi-bin/mapserv.exe](https://ows.gis.rotterdam.nl/cgi-bin/mapserv.exe)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: ACER SACCHARINUM; ZUIDZIJDE. Source height class: 6-9 m.. Diameter and crown units are unverified. Source status: NIET VAN TOEPASSING.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs rotterdam --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.
