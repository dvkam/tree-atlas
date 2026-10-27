# Florence source

[Official catalogue](https://opendata.comune.fi.it/page_dataset_show?id=42cd1073-521f-4040-9491-e993d03663a4) · [Source interface](https://data.comune.fi.it/datastore/api/package_show?id=42cd1073-521f-4040-9491-e993d03663a4&stats=1) · [Reuse conditions](https://creativecommons.org/licenses/by/4.0/)

The acquired export contains 82,269 source records; 0 have no usable coordinates. Licence: CC BY 4.0. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

The complete public-tree export contains 82,269 rows. Twelve rows have repeated publisher IDs. A release-row suffix preserves each conflicting record and a quality note identifies the conflict. CIRCONF_CM is circumference in centimetres. Source positions have documented accuracy of about 5 m.

Identifiers use ID and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs florence` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
