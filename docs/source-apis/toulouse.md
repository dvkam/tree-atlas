# Toulouse source

[Official catalogue](https://data.toulouse-metropole.fr/explore/dataset/arbres-urbains/) · [Source interface](https://data.toulouse-metropole.fr/api/explore/v2.1/catalog/datasets/arbres-urbains) · [Reuse conditions](https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf)

The acquired export contains 124,214 source records; 0 have no usable coordinates. Licence: Licence Ouverte v2.0 (Etalab). Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

Species is assembled from genre, espece and cultivar_variete. Source zero measurements mean not measured. The approximate forestry height is kept as a note because the inspected metadata does not establish its unit. Planting dates and development stages are retained when present.

Identifiers use id and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs toulouse` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
