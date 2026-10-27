# Madrid source

[Official catalogue](https://datos.madrid.es/dataset/300761-0-arbolado-especies) · [Source interface](https://datos.madrid.es/api/3/action/datastore_search?resource_id=300761-8-arbolado-especies&limit=10000&offset=0&sort=_id) · [Reuse conditions](https://creativecommons.org/licenses/by/4.0/)

The acquired export contains 799,110 source records; 0 have no usable coordinates. Licence: CC BY 4.0. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

The July 2026 export has 799,110 rows. ETRS89 / UTM zone 30N coordinates are transformed to WGS84. The official field guide defines ALTURA_TOTAL in metres and PERIMETRO in centimetres, measured at 1.3 m. ASSETNUM is retained as the tag; datastore row IDs are scoped to the release. The inventory excludes forest masses, palms, nurseries and trees managed by several other municipal bodies.

Identifiers use _id and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs madrid` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
