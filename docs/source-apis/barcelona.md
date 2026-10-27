# Barcelona source

[Official catalogue](https://opendata-ajuntament.barcelona.cat/data/en/dataset/arbrat-viari) · [Source interface](https://opendata-ajuntament.barcelona.cat/data/api/3/action/package_search?q=arbrat&rows=20) · [Reuse conditions](https://creativecommons.org/licenses/by/4.0/)

The acquired export contains 222,476 source records; 0 have no usable coordinates. Licence: CC BY 4.0. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

Combines arbrat-viari, arbrat-zona and arbrat-parcs. IDs include the inventory category and codi. The acquired files contain no repeated codi across categories. No location-based deduplication is used. Original longitude and latitude are retained.

Identifiers use source_inventory:codi and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs barcelona` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
