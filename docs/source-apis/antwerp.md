# Antwerp

Reviewed 27 October 2026. The acquired snapshot contains 135,017 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://ebesluit.antwerpen.be/zittingen/15.1003.2844.0208/agendapunten/21.0205.3821.6720). [Gratis Open Data Licentie Vlaanderen v1.0](https://www.antwerpen.be/info/gratis-open-data-licentie). Attribution: bron stad Antwerpen.

Published individually managed trees in public space. Woodland is represented separately as areas. The council approved release of Groeninventaris_BOOM as open data in 2015.

## Interface

- [MapServer/5](https://geodata.antwerpen.be/arcgissql/rest/services/P_Groeninventaris/Groeninventaris_extern/MapServer/5)
- [5/query](https://geodata.antwerpen.be/arcgissql/rest/services/P_Groeninventaris/Groeninventaris_extern/MapServer/5/query)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: Liquidambar styraciflua; MERKSEM. Source trunk circumference: 41. Units have not been verified.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs antwerp --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.
