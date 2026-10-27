# Strasbourg source

[Official catalogue](https://opendata.strasbourg.eu/explore/dataset/patrimoine_arbore/) · [Source interface](https://opendata.strasbourg.eu/api/explore/v2.1/catalog/datasets/patrimoine_arbore) · [Reuse conditions](https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf)

The acquired export contains 83,399 source records; 1 have no usable coordinates. Licence: Licence Ouverte v2.0 (Etalab). Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

Includes records managed by the city and metropolitan services. Municipal responsibilities outside Strasbourg differ. One acquired record has no coordinates and remains searchable. Height, crown width and stem diameter remain source descriptions; diameter is not circumference.

Identifiers use num_arbre and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs strasbourg` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
