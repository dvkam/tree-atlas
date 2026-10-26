# UK source review

Verified on 26 October 2026. Public access and permission to redistribute are separate checks.

## London

The [GLA dataset](https://data.london.gov.uk/dataset/london-public-realm-trees-2r45m) provides the November 2025 public-realm compilation under OGL v3. The download is about 199 MB. Coverage and observation dates differ by contributor. Some records have no coordinates. Keep these records in search.

`uniqueid` is a GLA mapping ID. It is not a borough asset ID. Use it only within this source. Preserve the contributor (`maintainer`) and borough fields. `girth_dbh` combines source measurement descriptions; do not convert it into a single diameter or circumference field without evidence. Height and canopy values include units and non-numeric categories.

To avoid publishing Camden twice, exclude rows whose `maintainer` is exactly `LB Camden` from the London release. Publish the current Camden inventory as a separate city view. Keep the original London file, its checksum, upstream count and excluded count in acquisition evidence. This is a contributor replacement, not a claim that individual trees were matched. Other contributors may still overlap. Do not deduplicate nearby points or trees with the same species.

## Camden

[Dataset](https://opendata.camden.gov.uk/d/csqp-kdss). [Metadata](https://opendata.camden.gov.uk/api/views/csqp-kdss.json). [Socrata API](https://opendata.camden.gov.uk/resource/csqp-kdss.json).

The metadata explicitly identifies OGL v3. The publisher describes daily updates. `identifier` repeats in the live export. Use the Socrata `:id` as the source-row ID and retain `identifier` as the tree asset reference. Rows with the same asset reference can have identical tree facts but different upload timestamps. Acquisition preserves these rows; it does not invent a distinct physical tree for each row. Preserve `number_of_trees`; one record can describe more than one tree. Coordinates use `longitude` and `latitude`. Use the explicit units in field names. Do not confuse spread, crown and diameter at breast height. A planned removal is not proof that a tree has been removed.

The downloader checks the advertised count against all pages. It sorts pages by Socrata row ID and rejects duplicate row IDs. The source is mutable: a count or uniqueness failure must stop publication and trigger a new acquisition.

## Edinburgh

Use the [council dataset](https://city-of-edinburgh-council-open-spatial-data-cityofedinburgh.hub.arcgis.com/datasets/cityofedinburgh::trees) and [Trees layer 41](https://services-eu1.arcgis.com/FgpikkYuSUOuITxp/arcgis/rest/services/Trees/FeatureServer/41). The [publisher item](https://www.arcgis.com/sharing/rest/content/items/6c224ada230b4d349cfd739015c7846d?f=pjson) explicitly grants OGL v3 and requires attribution to the council and Ordnance Survey. Its data edit date is 11 June 2024.

The initially suggested `Council_Trees` service in organisation `1qjjJoUN1p26Md36` is an Esri UK demonstration copy. Its owner is an Esri UK account; its metadata says demo data; its edit date is April 2019; its licence field is empty. Do not use that copy as the official current source.

The verified layer stores British National Grid points. Request EPSG:4326 from ArcGIS. Fetch the complete object-ID list, then request bounded batches and check the final count and unique IDs. Keep `PrimaryKey`, `LocationOrTagNo` and `OBJECTID`. Height, spread and breast-height diameter are strings. Do not invent measurement units or treat a range as an exact value.

## Belfast

The [council page](https://www.belfastcity.gov.uk/open-and-linked-data) links CSV and XML downloads and grants Open Government Licence reuse. Download both when checking dates.

The current XML is an Excel XML workbook, not the `belfasttrees` schema described on the page. Its creation timestamp is 24 February 2026 at 11:12:35 UTC. This is an export timestamp, not an inspection date. The CSV has more attributes than the XML. The CSV observation date is not stated.

Use CSV longitude and latitude. Keep all exported rows. `TreeTag` is often `NULL`; it is unsuitable as a unique ID. Assign a release-scoped row ID and state that it can change on refresh. Do not claim persistent cross-release tree identity. Preserve height, spread and DBH as source values until units are verified. Do not infer units from plausible numbers.

## Nottingham — redistribution blocked

The [requested council layer](https://maps164.nottinghamcity.gov.uk/server/rest/services/Core_services/Environment/MapServer/42) is publicly queryable. Its copyright field says use is subject to conditions and includes Ordnance Survey rights. The council's [mapping terms](https://maps.nottinghamcity.gov.uk/terms/) permit viewing and explicitly prohibit copying and redistribution of licensed data.

The separate [open-data geoportal](https://geoportal-nottmcitycouncil.opendata.arcgis.com/) uses OGL by default, but that does not establish an OGL grant for this specific inventory. Do not publish this layer until a matching open dataset or explicit permission establishes reuse rights. No Nottingham records are included in the acquisition output.

If permission is established, preserve felled and proposed status. `CROWN_SPREAD_RADIUS` is a radius in metres, not a diameter. `HEIGHT_N` is metres. The service description refers to diameter observations, but the inspected layer does not expose a DBH field.

## Reproduce acquisition

Run `node --max-old-space-size=6144 scripts/download-uk-sources.mjs`. Raw inventories and request checksums are written under ignored `data/raw/`. `uk-provenance.json` records source URLs, licences, counts, coordinate coverage, exclusions and date meaning. `tests/fixtures/uk-sources.json` contains small real source examples for importer tests. The London input is retained in `london-original.csv`; remove or rename that file before requesting a fresh London export.

Record completeness means all rows returned by the selected publisher export. It does not mean every tree in the city is included.

Edinburgh source records can represent groups (Grp/ asset references). Report inventory totals as records. Some source coordinates appear inconsistent with their named sites; retain the official geometry and flag the source uncertainty. Do not relocate records from site text.
