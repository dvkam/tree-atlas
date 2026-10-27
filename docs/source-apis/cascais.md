# Cascais source

[Official catalogue](https://dadosabertos.cascais.pt/pt_BR/dataset/geocascais-arvore) · [Source interface](https://dadosabertos.cascais.pt/dataset/08f1aebc-4692-4a23-9c5b-22197a27982e/resource/25bce551-91b3-4f58-8737-82a3eaabd93a/download/geocascais-arvore_20261026_173023.geojson) · [Reuse conditions](http://www.opendefinition.org/licenses/cc-by)

The acquired export contains 37,944 source records; 0 have no usable coordinates. Licence: Creative Commons Attribution (version not stated). Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

The complete municipal download contains 37,944 records. Feature IDs identify rows; numero_registo is retained as the tag. abate=Sim is retained as removed status. Empty planting-pit flags remain notes. The catalogue states Creative Commons Attribution without an explicit version; its original licence link is retained.

Identifiers use _featureId and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs cascais` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
