# Turin source

[Official catalogue](https://www.geoportale.piemonte.it/geonetwork/serv/api/records/c_l219:b0493156-2d45-4792-977c-c3ab2937f171) · [Source interface](https://geomap.reteunitaria.piemonte.it/ws/siccms/coto-01/wfsg01/wfs_sicc11_alberate?service=WFS&version=1.1.0&request=GetFeature&typeName=AlberatePt&srsName=EPSG:4326&outputFormat=application%2Fjson%3B%20subtype%3Dgeojson%3B%20charset%3DISO-8859-1) · [Reuse conditions](https://creativecommons.org/licenses/by/4.0/)

The acquired export contains 105,476 source records; 0 have no usable coordinates. Licence: CC BY 4.0. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

The full GeoJSON export contains 105,476 unique planting-site IDs. A second fresh export contains the same ID set. The WFS hits response reports 105,439. These counts are not reconciled. Completeness against the live service is unverified. Records can describe empty planting sites or non-living trees. Only Pianta viva maps to existing status; other source statuses remain notes.

Identifiers use id_posto_pianta and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs turin` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
