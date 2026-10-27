# Bordeaux Métropole source

[Official catalogue](https://datahub.bordeaux-metropole.fr/explore/dataset/ec_arbre_p/) · [Source interface](https://datahub.bordeaux-metropole.fr/api/explore/v2.1/catalog/datasets/ec_arbre_p) · [Reuse conditions](https://www.etalab.gouv.fr/wp-content/uploads/2014/05/Licence_Ouverte.pdf)

The acquired export contains 84,718 source records; 0 have no usable coordinates. Licence: Licence Ouverte. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

espece contains the scientific name. nom is the municipality, not the species. Source status and disappearance dates remain notes. Dimensions remain notes until their units are established from the linked data dictionary.

Identifiers use gid and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs bordeaux` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
