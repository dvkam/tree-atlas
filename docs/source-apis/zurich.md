# Zürich

## Interfaces and coverage

The [official catalogue](https://data.stadt-zuerich.ch/dataset/geo_baumkataster) describes the tree register. It includes municipal street trees, fruit trees and selected park or other managed trees. Some records lie on private land or outside the municipal boundary. Park coverage is expanding. It is not a census of all trees in Zürich.

| Interface | Official endpoint                                                                                 | Use in Tree Atlas             |
| --------- | ------------------------------------------------------------------------------------------------- | ----------------------------- |
| WFS       | [Baumkataster](https://www.ogd.stadt-zuerich.ch/wfs/geoportal/Baumkataster)                       | Inventory acquisition         |
| GeoJSON   | [Download entry](https://www.stadt-zuerich.ch/geodaten/download/Baumkataster?format=geojson_link) | Official download alternative |
| WMS       | [Baumkataster](https://www.ogd.stadt-zuerich.ch/wms/geoportal/Baumkataster)                       | Official map alternative      |
| WMTS      | [Capabilities](https://www.ogd.stadt-zuerich.ch/mapproxy/wmts/1.0.0/WMTSCapabilities.xml)         | Official map alternative      |

The downloader uses WFS 1.1.0, type `baumkataster_baumstandorte`, output `application/vnd.geo+json` and `EPSG:4326`. It requests the complete layer, checks hit counts before and after the download, and rejects duplicate `objectid` values. The snapshot contains **81,142 records**. Crown and CAD layers describe existing trees; they are not extra tree records to append.

## Field rules

- `objectid` identifies a record within a release. `baumnummer` supplies the tag.
- `baumnamelat` and `baumnamedeu` supply names. `strasse` supplies the street. `pflanzjahr` supplies the planting year.
- `status` contains categories such as fruit tree, park tree and street tree. It does not establish whether a tree is alive or felled.
- Crown dimensions are estimated, incomplete and updated irregularly. CAD data can substitute an eight-metre default. Tree Atlas leaves exact crown diameter unknown and preserves an available estimate in a quality note.

## Licence and implementation

The data uses [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Tree Atlas retains **Stadt Zürich — Grün Stadt Zürich / Geomatik + Vermessung** as the source credit.

Acquisition: [download-new-sources.mjs](../../scripts/download-new-sources.mjs). Normalization: [import-additional.ts](../../src/import-additional.ts). Tests: [import-additional.test.ts](../../src/import-additional.test.ts).
