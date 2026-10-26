# Hamburg

## Interfaces and coverage

The [official FAQ](https://www.hamburg.de/politik-und-verwaltung/behoerden/bukea/themen/hamburgs-gruen/baeume/strassenbaeume-online/strassenbaeume-online-faq-274306) explains the street-tree inventory. The reviewed [Transparenzportal entry](https://suche.transparenz.hamburg.de/dataset/strassenbaumkataster-hamburg34) was dated 8 September 2026.

| Interface        | Official endpoint                                                                        | Use in Tree Atlas        |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------ |
| WFS              | [HH_WFS_Strassenbaumkataster](https://geodienste.hamburg.de/HH_WFS_Strassenbaumkataster) | Inventory acquisition    |
| OGC API Features | [strassenbaumkataster](https://api.hamburg.de/datasets/v1/strassenbaumkataster)          | Independent count check  |
| WMS              | [HH_WMS_Strassenbaumkataster](https://geodienste.hamburg.de/HH_WMS_Strassenbaumkataster) | Official map alternative |

The downloader uses WFS 2.0, type `de.hh.up:strassenbaumkataster`, `application/geo+json`, and `EPSG:4326`. It requests 10,000 records per page, using `STARTINDEX` and `SORTBY=baumid`. It checks the count before and after acquisition, rejects duplicate IDs and reconciles the OGC API count.

The snapshot contains **229,876 records**. A single-point MultiPoint becomes a Point. Other geometry forms fail validation. Historic HPA links do not establish a second current layer to append. Coverage is street trees. It does not cover all park, forest or private trees. Updates can lag planting or removal.

## Field rules

- `baumid` identifies a record within a release. `baumnummer` is the displayed tag.
- `sorte`, `art` and genus fields supply names. `strasse` supplies the street label.
- Invalid planting years such as `175` and `200` become unknown, with quality notes.
- `kronendurchmesser` uses metres. `stammumfang` uses centimetres. Companion `_z` fields preserve measurement qualifiers.
- `daten_aus_vorjahr = 2026` supplies a source year, not an exact observation date.

## Licence and implementation

The data uses [Datenlizenz Deutschland — Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0). Retain **Freie und Hansestadt Hamburg, Behörde für Umwelt, Klima, Energie und Agrarwirtschaft** and identify changes.

Acquisition: [download-new-sources.mjs](../../scripts/download-new-sources.mjs). Normalization: [import-additional.ts](../../src/import-additional.ts). Tests: [import-additional.test.ts](../../src/import-additional.test.ts).
