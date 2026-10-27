# Delft

Reviewed 27 October 2026. The acquired snapshot contains 36,763 records. This is the published source inventory, not a census of every physical tree.

## Source and terms

[Official catalogue or publisher](https://data.overheid.nl/dataset/bomen-in-beheer-door-gemeente-delft). [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution: Gemeente Delft.

All published municipal tree rows. Inventory accuracy and update dates vary.

## Interface

- [FeatureServer/0](https://services3.arcgis.com/j07voPd56xoB4c87/arcgis/rest/services/Bomen%20in%20beheer%20door%20gemeente%20Delft/FeatureServer/0)
- [0/query](https://services3.arcgis.com/j07voPd56xoB4c87/arcgis/rest/services/Bomen%20in%20beheer%20door%20gemeente%20Delft/FeatureServer/0/query)

The downloader checks ODS export counts, ArcGIS object-ID sets, or WFS counts before and after acquisition. Static files have a recorded hash and row count; they do not provide an independent completeness check. See [download-expansion-north.mjs](../../scripts/download-expansion-north.mjs) for exact requests and field mapping.

## Field rules

The import keeps source identity, Latin and common names where supplied, planting year, and location. It does not infer a species from a municipality or genus code. Unknown units remain unknown. Height classes and estimated dimensions remain source notes unless their meaning is verified. Zero dimensions do not mean a measured zero.

Example: Fraxinus excelsior; Binnen de bebouwde kom. Source tree status: unknown. Height: 18-24 m.; diameter: unknown. Units are not verified.

Coordinates are stored as WGS84 longitude then latitude. Source IDs are release-scoped. Keep links tied to the published release. The acquisition retains unlocated records; they remain searchable and have no invented map point.

## Refresh and checks

Run `node scripts/download-expansion-north.mjs delft --refresh`, then prepare and validate the catalogue. Review upstream terms and schema before publication. [Source conformance tests](../../tests/import-north.test.ts) cover fixed factual examples; they cannot prove that the upstream inventory is complete.
