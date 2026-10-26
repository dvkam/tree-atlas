# London

The [GLA Public Realm Trees dataset](https://data.london.gov.uk/dataset/london-public-realm-trees-2r45m) supplies a combined downloadable inventory. The reviewed export is the November 2025 compilation. Contributor coverage and observation dates differ. Missing coordinates do not exclude a record from search.

The acquisition contains **1,136,049 upstream rows**. Tree Atlas excludes **24,265 rows** whose `maintainer` is exactly `LB Camden`, leaving **1,111,784 rows**. The separate current [Camden inventory](camden.md) replaces that contributor. This rule does not match individual trees. Other contributors can still overlap. Do not merge nearby points or identical species names as presumed duplicates.

`uniqueid` is a GLA mapping identifier, not a borough asset ID. Preserve `maintainer` and borough information. `girth_dbh` combines source measurement descriptions. Do not convert it into one circumference or diameter field. Height and canopy fields can contain units, ranges and non-numeric categories.

The source uses [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Credit the Greater London Authority and contributing public bodies. Retain the source date and describe the Camden exclusion.

The [UK downloader](../../scripts/download-uk-sources.mjs) retains the original input, checksum, upstream count and excluded count. Its `london-original.csv` cache must be removed or renamed before requesting a fresh export. See the [UK acquisition review](../uk-source-review.md) for evidence and refresh instructions.
