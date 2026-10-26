# Belfast

The [council open-data page](https://www.belfastcity.gov.uk/open-and-linked-data) links CSV and XML exports and grants Open Government Licence reuse. The downloader uses the CSV for inventory attributes and checks the companion XML for export-date evidence.

The reviewed CSV contains **56,521 rows**. The XML is an Excel XML workbook, not the `belfasttrees` schema described on the web page. Its creation timestamp is **24 February 2026 at 11:12:35 UTC**. This is a workbook export timestamp. It does not establish the CSV observation date, which remains unknown.

Use the CSV longitude and latitude. Keep every exported row. `TreeTag` often contains `NULL`; it cannot identify rows uniquely. Tree Atlas assigns release-scoped row IDs. They can change on refresh and do not establish persistent tree identity.

Height, spread and DBH remain source values until their units are verified. Plausible numbers are not evidence of units. The CSV provides more attributes than the XML.

Retain the credit **Belfast City Council** and the [Open Government Licence notice](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Acquisition: [download-uk-sources.mjs](../../scripts/download-uk-sources.mjs). Evidence and limitations: [UK source review](../uk-source-review.md).
