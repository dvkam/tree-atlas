# Amsterdam

## Interfaces and coverage

Use the [v2 API documentation](https://api.data.amsterdam.nl/v1/docs/datasets/bomen@v2.html) and [dataset schema](https://schemas.data.amsterdam.nl/datasets/bomen/dataset). Version 1 was superseded; its published support end was 19 September 2026.

| Interface    | Official endpoint                                                         | Use in Tree Atlas                  |
| ------------ | ------------------------------------------------------------------------- | ---------------------------------- |
| REST         | [stamgegevens v2](https://api.data.amsterdam.nl/v1/bomen/v2/stamgegevens) | Inventory acquisition              |
| WFS          | [bomen v2](https://api.data.amsterdam.nl/v1/wfs/bomen/v2)                 | Documented alternative             |
| Vector tiles | [TileJSON](https://api.data.amsterdam.nl/v1/mvt/bomen/v2/tilejson.json)   | Documented alternative; zooms 7–15 |

Anonymous requests worked on 26 October 2026. The documentation announces API keys without a fixed introduction date. The published app reads its own release files and needs no upstream key.

The REST downloader requests `_format=geojson`, `_sort=id` and pages of 10,000. It follows validated pagination links and compares the total count before and after acquisition. IDs must increase strictly. GeoJSON returns CRS84 longitude and latitude; default REST coordinates use Dutch RD (`EPSG:28992`). Do not interpret RD coordinates as degrees.

The snapshot contains **326,518 records**. **24 records have no location** and remain searchable. Another **30 records** have source positions near France. They retain their coordinates and a quality note. The default map view uses the Amsterdam area, rather than fitting those outliers.

## Field rules

- `id` identifies a record within a release.
- `soortnaam` and `soortnaamTop` supply species names.
- `standplaatsGedetailleerd` supplies the preferred location description. `standplaats` is a category, not necessarily a street address.
- `jaarVanAanleg` describes placement. Zero and implausible years such as `1` and `15` become unknown, with quality notes where needed.
- `mutatieDatum` is a data modification date, not a tree observation date.
- `boomhoogteklasseActueel` describes a height range. Preserve unrecognized source classes as notes.
- `stamdiameterklasse` describes diameter. Do not store it as measured circumference.

## Terms and implementation

The source states that data is public unless exceptions apply. Do not relabel that statement as CC0. Retain **Gemeente Amsterdam, Directie Verkeer en Openbare Ruimte** and the source terms in provenance.

Acquisition: [download-new-sources.mjs](../../scripts/download-new-sources.mjs). Normalization: [import-additional.ts](../../src/import-additional.ts). Tests: [import-additional.test.ts](../../src/import-additional.test.ts).
