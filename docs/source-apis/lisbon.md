# Lisbon source

[Official catalogue](https://dados.cm-lisboa.pt/dataset/arvoredo) · [Source interface](https://services.arcgis.com/1dSrzEWVQn5kHHyK/arcgis/rest/services/Ambiente_DMEVAE/FeatureServer/0?f=json) · [Reuse conditions](https://creativecommons.org/publicdomain/zero/1.0/)

The acquired export contains 80,957 source records; 0 have no usable coordinates. Licence: CC0. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

Official ArcGIS item d2eb1eb1cfae400496bec1aeec4e25b2 explicitly grants CC0 and requests author credit. All IDs from Arvoredo layer 0 are fetched and checked. PAP and occupation remain source notes. The cartography is not approved for legal purposes.

Identifiers use GESP_C_PK and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs lisbon` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
