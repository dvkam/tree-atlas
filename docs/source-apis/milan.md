# Milan source

[Official catalogue](https://dati.comune.milano.it/dataset/groups/ds2484_infogeo_alberi_localizzazione) · [Source interface](https://dati.comune.milano.it/api/3/action/package_show?id=ds2484_infogeo_alberi_localizzazione) · [Reuse conditions](https://creativecommons.org/licenses/by/4.0/)

The acquired export contains 247,779 source records; 0 have no usable coordinates. Licence: CC BY 4.0. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

The archive has 247,779 records. Its resource label says March 2025, but the archive member is named March 2024. Observation vintage is unresolved. h_m is an explicit height in metres. Trunk and crown diameter values remain notes; diameter is not circumference. data_ini is not assumed to be a planting date.

Identifiers use obj_id and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs milan` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
