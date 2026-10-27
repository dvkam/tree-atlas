# Bern source

[Official catalogue](https://opendata.swiss/de/dataset/baumkataster1) · [Source interface](https://map.bern.ch/arcgis/rest/services/Geoportal/Baumkataster/MapServer/0?f=json) · [Reuse conditions](https://opendata.swiss/terms-of-use#terms_open)

The acquired export contains 23,984 source records; 0 have no usable coordinates. Licence: Open use. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

The WFS distribution is explicitly marked open use in the Swiss catalogue. The corresponding official ArcGIS layer supplies WGS84 coordinates. Gattung and Art are numeric codes. Gattung_beschrieb supplies the genus and Art_beschrieb the German common name. Planting year is preserved; location-accuracy descriptions remain notes.

Identifiers use Objectid and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs bern` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
