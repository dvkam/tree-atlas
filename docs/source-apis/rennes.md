# Rennes Métropole source

[Official catalogue](https://data.rennesmetropole.fr/explore/dataset/arbre/) · [Source interface](https://data.rennesmetropole.fr/api/explore/v2.1/catalog/datasets/arbre) · [Reuse conditions](http://opendatacommons.org/licenses/odbl/)

The acquired export contains 192,000 source records; 0 have no usable coordinates. Licence: Licence ODbL 1.0. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

Uses the main arbre inventory with 192,000 records. The originally supplied diagnostic_arbres_rennes layer has diagnostic records but lacks species; it is not imported as a second tree inventory. abattu=1 is retained as removed status. Non renseigné becomes unknown. ODbL applies to this dataset.

Identifiers use gml_id and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs rennes` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
