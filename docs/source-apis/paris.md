# Paris source

[Official catalogue](https://opendata.paris.fr/explore/dataset/les-arbres/) · [Source interface](https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/les-arbres) · [Reuse conditions](http://opendatacommons.org/licenses/odbl/)

The acquired export contains 220,112 source records; 0 have no usable coordinates. Licence: Open Database License (ODbL). Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

The municipal inventory excludes woodland and private trees. Ten source rows repeat idbase values. A release-row suffix preserves each conflict; no records are silently removed. Height is metres and circumference is centimetres. The ODbL licence remains attached to this dataset.

Identifiers use idbase and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs paris` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
