# Camden

The council publishes [Trees in Camden](https://opendata.camden.gov.uk/d/csqp-kdss) through [Socrata](https://opendata.camden.gov.uk/resource/csqp-kdss.json). Its [metadata](https://opendata.camden.gov.uk/api/views/csqp-kdss.json) describes daily updates and explicitly grants Open Government Licence v3.0.

The reviewed acquisition contains **28,128 rows**, including **245 without coordinates**. These are source rows, not a verified count of distinct physical trees. The downloader sorts by Socrata `:id`, checks all pages against the advertised count and rejects duplicate row IDs. A count or uniqueness failure stops acquisition.

`identifier` repeats in the export. Use Socrata `:id` as the row identifier and retain `identifier` as the asset reference. Some rows repeat tree facts with different upload timestamps. Preserve `number_of_trees`: one row can represent several trees. Use `longitude` and `latitude` for positions. Use the units stated by each measurement field. Spread and breast-height diameter are not circumference. A planned removal does not establish that removal has occurred.

The [London compilation](london.md) excludes its exact `LB Camden` contributor rows when this source is published separately. This replacement does not establish complete deduplication across London.

Use [OGL v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) and credit the London Borough of Camden. Acquisition is implemented in [download-uk-sources.mjs](../../scripts/download-uk-sources.mjs). See the [UK review](../uk-source-review.md) for snapshot evidence.
