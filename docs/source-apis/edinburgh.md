# Edinburgh

Use the [official council dataset](https://city-of-edinburgh-council-open-spatial-data-cityofedinburgh.hub.arcgis.com/datasets/cityofedinburgh::trees) and [ArcGIS Trees layer 41](https://services-eu1.arcgis.com/FgpikkYuSUOuITxp/arcgis/rest/services/Trees/FeatureServer/41). The [publisher item](https://www.arcgis.com/sharing/rest/content/items/6c224ada230b4d349cfd739015c7846d?f=pjson) grants OGL v3.0. Its data edit date is 11 June 2024; this is not each tree's inspection date.

The reviewed acquisition contains **50,400 records**. The service stores British National Grid points. The downloader requests `EPSG:4326`, obtains the complete object-ID list and fetches bounded batches. It checks the final count and unique IDs.

Preserve `PrimaryKey`, `LocationOrTagNo` and `OBJECTID`. Height, spread and breast-height diameter are strings. Preserve source descriptions when units are unverified. Do not turn a range into an exact measurement.

The originally suggested `Council_Trees` endpoint in ArcGIS organisation `1qjjJoUN1p26Md36` is an Esri UK demonstration copy. Its metadata identifies demo data, an April 2019 edit and no licence grant. It is not the source used here.

Retain the publisher's council and Ordnance Survey attribution: **Copyright City of Edinburgh Council, contains Ordnance Survey data © Crown copyright and database right 2026**. Acquisition: [download-uk-sources.mjs](../../scripts/download-uk-sources.mjs). Evidence: [UK source review](../uk-source-review.md).

Some records use a group identifier (Grp/) rather than a single-tree identifier. The app preserves this distinction in source notes. Published coordinates can also disagree with a site label; the app retains the official coordinates and does not invent a corrected position.
