# Vienna

## Interface and coverage

The [official catalogue](https://www.data.gv.at/datasets/c91a4635-8b7d-43fe-9b27-d95dec8392a7) publishes the municipal tree inventory. It is not a census of private trees or all forest vegetation.

The importer uses [WFS](https://data.wien.gv.at/daten/geo), version `1.1.0`, feature type `ogdwien:BAUMKATOGD`, GeoJSON output and `EPSG:4326`. The snapshot contains **233,102 records**.

The downloader orders by `OBJECTID` and requests batches of 10,000 with a keyset filter. IDs must increase strictly. It checks the WFS hit count before and after acquisition, rejects duplicates and requires an empty final page. These checks detect count changes. They cannot detect every edit made during a download if the total stays unchanged.

## Field rules

- `OBJECTID` identifies a record within a release. Do not assume it remains stable across exports.
- `BAUMNUMMER` is a displayed tree tag. It is not globally unique. `BAUM_ID` is not treated as a permanent cross-release identifier.
- `GATTUNG_ART` supplies the species names. `OBJEKT_STRASSE` supplies the location label.
- `PFLANZJAHR = 0` means unknown.
- `STAMMUMFANG` is circumference in centimetres.
- `BAUMHOEHE` and `KRONENDURCHMESSER` are class codes. Their `_TXT` fields describe ranges. They are not exact metre measurements.

## Licence and implementation

The data uses [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Retain the attribution **Datenquelle: Stadt Wien — data.wien.gv.at** and identify processing changes.

Acquisition: [download-sources.mjs](../../scripts/download-sources.mjs). Normalization: [import.ts](../../src/import.ts). Regression cases: [import.test.ts](../../src/import.test.ts). The release provenance records the exact request and retrieval date.
