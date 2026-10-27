# Utrecht

Reviewed 27 October 2026. The acquired snapshot contains 162,653 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://open.utrecht.nl/dataset/bomen/24462069-4993-4106-9e69-a52d5e56baac). [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Attribution: Gemeente Utrecht.

Current 2026 tree service: park/street trees and trees in wooded planting areas. Layer-qualified IDs preserve every source row.

## Interface

- [FeatureServer/0](https://services-eu1.arcgis.com/SMnoOtmU2UWf0vRp/arcgis/rest/services/bomenkaart_2026/FeatureServer/0)
- [0/query](https://services-eu1.arcgis.com/SMnoOtmU2UWf0vRp/arcgis/rest/services/bomenkaart_2026/FeatureServer/0/query)
- [FeatureServer/1](https://services-eu1.arcgis.com/SMnoOtmU2UWf0vRp/arcgis/rest/services/bomenkaart_2026/FeatureServer/1)
- [1/query](https://services-eu1.arcgis.com/SMnoOtmU2UWf0vRp/arcgis/rest/services/bomenkaart_2026/FeatureServer/1/query)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: Alnus glutinosa; Veldhuizen.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs utrecht --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.
