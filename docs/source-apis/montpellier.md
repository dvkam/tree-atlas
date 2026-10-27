# Montpellier source

[Official catalogue](https://data.montpellier3m.fr/dataset/arbres-de-montpellier) · [Source interface](https://data.montpellier3m.fr/sites/default/files/ressources/MMM_MTP_Arbres.json) · [Reuse conditions](https://opendatacommons.org/licenses/odbl/1-0/)

The acquired export contains 60,882 source records; 0 have no usable coordinates. Licence: ODbL 1.0. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

The publisher describes surveys from 2025 and 2026. The complete GeoJSON download contains 60,882 records. It exposes species and location fields, but no dimension fields. Unknown dimensions remain unknown. The dataset is ODbL.

Identifiers use id_arbre and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs montpellier` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
