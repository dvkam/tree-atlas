# Bologna source

[Official catalogue](https://opendata.comune.bologna.it/explore/dataset/alberi-manutenzioni/) · [Source interface](https://opendata.comune.bologna.it/api/explore/v2.1/catalog/datasets/alberi-manutenzioni) · [Reuse conditions](https://creativecommons.org/licenses/by/4.0/)

The acquired export contains 87,285 source records; 0 have no usable coordinates. Licence: CC BY 4.0. Keep this licence and the publisher credit with redistributed data. The project code licence does not replace the data licence.

num_pt identifies the source row. classe contains the species name, not a size class. cl_h and classe_circonferenza_diametro remain text descriptions. Planting dates are only partly populated. A missing planting date stays unknown.

Identifiers use num_pt and are scoped to the published release. Missing values remain unknown. Raw publisher attributes are retained alongside the normalized fields. Acquisition time records a download, not a survey.

Run `node --max-old-space-size=6144 scripts/download-expansion-south.mjs bologna` to refresh this source. The downloader stores request checksums, counts, coordinate coverage and source dates in ignored `data/raw/south-provenance.json`. Import examples and independently checked expectations are in `tests/fixtures/south-sources.json` and `tests/south-import.test.ts`.
