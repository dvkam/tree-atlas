# Porto

## Interface and coverage

The [municipal open-data catalogue](https://dadosabertos.cm-porto.pt/dataset/identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto) publishes the inventory. The downloader discovers its GeoJSON resource through [CKAN package metadata](https://dadosabertos.cm-porto.pt/api/3/action/package_show?id=identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto). Resource URLs can change. Do not hard-code a historical download UUID as the permanent interface.

The snapshot contains **71,634 records**. The importer validates WGS84 points and unique `objectid` values. The download has no independent API count to reconcile. Coverage means all records in this resource, not every tree within Porto.

## Field rules

- `objectid` identifies a record within a release.
- `esp_nomecientifico` supplies the botanical name. `esp_nomecomum` supplies the common name.
- `arv_intervalo_idade` is an age interval. Do not convert it into an exact planting year.
- This export has no street name, exact height or planting-year field. Catalogue descriptions do not establish that a field exists in the downloaded file.

The catalogue modification date was 1 October 2026. It is not a tree observation date. The app cannot provide Porto street-label matches when the source supplies no such labels.

## Licence and implementation

The resource uses [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Tree Atlas retains **Município do Porto** as the source credit.

Acquisition: [download-sources.mjs](../../scripts/download-sources.mjs). Normalization: [import.ts](../../src/import.ts). Tests: [import.test.ts](../../src/import.test.ts). Provenance records the resolved resource URL and file checksum.
