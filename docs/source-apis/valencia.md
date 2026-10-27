# Valencia source

[Official catalogue](https://opendata.vlci.valencia.es/es/dataset/arbratge-arbolado) · [Source interface](https://geoportal.valencia.es/server/rest/services/OPENDATA/MedioAmbiente/MapServer/151?f=json) · [Reuse conditions](https://creativecommons.org/licenses/by/4.0/)

The acquired export contains 157,649 source records; 0 have no usable coordinates. Licence: CC BY 4.0. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

ArcGIS layer 151 returns the complete object-ID list. Each batch must match its requested IDs. idarbol is retained as the tag. Height, crown and perimeter include classes such as >12, 4/8 and <0.4; these remain source notes. No exact measurement is invented.

Identifiers use objectid and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs valencia` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
