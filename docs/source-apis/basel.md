# Basel-Stadt source

[Official catalogue](https://data.bs.ch/explore/dataset/100052/) · [Source interface](https://data.bs.ch/api/explore/v2.1/catalog/datasets/100052) · [Reuse conditions](https://data-bs.ch/stata/dataspot/permalinks/20240822-osm-vektordaten.pdf)

The acquired export contains 32,435 source records; 0 have no usable coordinates. Licence: CC BY 4.0 + OpenStreetMap. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

The dataset covers maintained stock in Basel and Riehen. The licence is labelled CC BY 4.0 + OpenStreetMap. Its linked document is a waiver allowing CC BY data to be incorporated into OpenStreetMap; it does not make these source records an OSM extract. Credit Geodaten Kanton Basel-Stadt. ba_standjahr is not treated as a calendar planting year.

Identifiers use gml_id and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs basel` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
