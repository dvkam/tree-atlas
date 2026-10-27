# Lyon Métropole source

[Official catalogue](https://data.grandlyon.com/portail/fr/jeux-de-donnees/arbres-alignement-metropole-lyon/info) · [Source interface](https://data.grandlyon.com/geoserver/ogc/features/v1/collections/metropole-de-lyon:abr_arbres_alignement.abrarbre/items?f=application%2Fgeo%2Bjson&limit=10000) · [Reuse conditions](https://www.etalab.gouv.fr/licence-ouverte-open-licence/)

The acquired export contains 112,425 source records; 0 have no usable coordinates. Licence: Licence Ouverte. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

OGC API Features pagination follows the official next links and checks numberMatched. Explicit fields provide height and crown diameter in metres and circumference in centimetres. The portal advertises monthly updates, but its displayed data date is older; retrieval time is not a new survey date.

Identifiers use gid and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs lyon` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
