# Amsterdam, Hamburg and Zürich source review

Verified against official services on 26 October 2026. The importer acquires complete published collections without geographic filtering. Counts describe source records, not every physical tree in a city. Requests, response hashes and before/after count checks are recorded in release provenance.

## Amsterdam

[Official API documentation](https://api.data.amsterdam.nl/v1/docs/datasets/bomen@v2.html) and the [dataset schema](https://schemas.data.amsterdam.nl/datasets/bomen/dataset) identify v2 as stable. The user-provided v1 documentation remains accessible, but v1 is marked superseded with support ending 19 September 2026. The tree master-record collection is `stamgegevens`; other tables include management locations, inspections and work orders and are not additional tree inventories.

- REST: `https://api.data.amsterdam.nl/v1/bomen/v2/stamgegevens`
- WFS: `https://api.data.amsterdam.nl/v1/wfs/bomen/v2`
- Vector TileJSON: `https://api.data.amsterdam.nl/v1/mvt/bomen/v2/tilejson.json`

All three interfaces responded anonymously during the probe. The documentation announces an upcoming API-key requirement without a fixed deadline. Future refreshes may require a key; the published application uses its own prepared snapshot and does not pass credentials to visitors.

Acquisition uses ordered REST GeoJSON pages of 10,000, follows the published next link to exhaustion, verifies strictly increasing unique `id` values and reconciles before/after totals. `_format=geojson` returns CRS84 longitude/latitude; default REST geometry uses RD / EPSG:28992 and must not be interpreted as latitude/longitude. The official MVT layer describes zooms 7–15 and is useful for visualization, but it does not replace complete text search or pinned record details.

The collection has **326,518 records** at the initial probe. Exactly 24 records have no geometry; 326,494 have valid points. For example, record `3869075` has no point, species or planting year. Those records must remain searchable and readable with an explicit missing-location state; a map cannot place them. No coordinate should be invented and no source row should be silently dropped. Another 30 records (IDs 9441293–9441322) have numerically valid positions around 3.313604° E, 47.975237° N, far outside Amsterdam. Preserve these source coordinates with a quality note; do not silently relocate them. A nominal Amsterdam map centre avoids opening the default map near the midpoint of the anomalous source extent.

The source identifies `id` as its record key. Permanent identity across future releases is not established, so links remain release-qualified. `soortnaam` supplies the scientific name and `soortnaamTop` the Dutch name. `standplaats` is a site-type label, not a street address. `jaarVanAanleg` is the placement year; zero means unknown. Three records publish implausible nonzero years: 1 (IDs 1602973 and 5069938) and 15 (ID 8689678). Keep their source values in quality notes and show the planting year as unknown. `mutatieDatum` is a data-change timestamp, not an observation date.

`boomhoogteklasseActueel` is a height range: below 6 m, 6–9, 9–12, 12–15, 15–18, 18–24, or at least 24 m. Legacy values include 6–12 and 12–18 m; other codes indicate unknown or not applicable. Preserve ranges. `stamdiameterklasse` describes trunk **diameter** in metre ranges; it must not be shown as measured circumference.

Amsterdam labels the dataset “openbaar, tenzij anders aangegeven / behoudens uitzonderingen.” Preserve those published terms and attribution to Gemeente Amsterdam; do not relabel it CC0 or another standardized licence without evidence.

## Hamburg

The [official FAQ](https://www.hamburg.de/politik-und-verwaltung/behoerden/bukea/themen/hamburgs-gruen/baeume/strassenbaeume-online/strassenbaeume-online-faq-274306) directs downloads to the Transparenzportal. The [current catalogue publication](https://suche.transparenz.hamburg.de/dataset/strassenbaumkataster-hamburg34), dated 8 September 2026, links the live WFS, WMS, downloadable resources and OGC API Features.

- WFS: `https://geodienste.hamburg.de/HH_WFS_Strassenbaumkataster`
- OGC API Features: `https://api.hamburg.de/datasets/v1/strassenbaumkataster`
- WMS: `https://geodienste.hamburg.de/HH_WMS_Strassenbaumkataster`

The current WFS advertises one feature type, `de.hh.up:strassenbaumkataster`. Its hits count and OGC API collection count both report **229,876**. Historical download URLs still mention a separate HPA type; that type is not advertised by the current service and must not be assumed to be an extra collection. The inventory concerns public street parcels, not comprehensive park, forest or private-tree coverage. Published records can lag planting and removal.

Acquisition requests sorted WFS 2.0 pages in `application/geo+json` and EPSG:4326, reconciles unique `baumid` values and before/after hits counts. The service returns longitude/latitude singleton MultiPoints. Convert only a MultiPoint containing exactly one coordinate to Point; reject other shapes rather than invent a centroid.

Fields include `baumid`, `baumnummer`, scientific and German genus/species/cultivar names, `pflanzjahr`, `kronendurchmesser` in metres, `stammumfang` in centimetres, `strasse` and descriptive district fields. Displayed companion fields such as `kronendurchmesser_z` and `stammumfang_z` may contain qualifiers; preserve these rather than implying precision the source does not support. `daten_aus_vorjahr` identifies the source reference year, not an exact observation date.

The licence is [Datenlizenz Deutschland — Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0). Use the catalogue attribution: Freie und Hansestadt Hamburg, Behörde für Umwelt, Klima, Energie und Agrarwirtschaft.

## Zürich

The [city catalogue](https://data.stadt-zuerich.ch/dataset/geo_baumkataster) publishes the inventory under CC0 and lists GeoJSON, WFS, WMS and WMTS. It includes municipal street trees, fruit trees, selected public green areas and some private trees, with some records outside the city boundary. Park coverage is expanded gradually.

- WFS: `https://www.ogd.stadt-zuerich.ch/wfs/geoportal/Baumkataster`
- GeoJSON download entry: `https://www.stadt-zuerich.ch/geodaten/download/Baumkataster?format=geojson_link`
- WMS: `https://www.ogd.stadt-zuerich.ch/wms/geoportal/Baumkataster`
- WMTS capabilities: `https://www.ogd.stadt-zuerich.ch/mapproxy/wmts/1.0.0/WMTSCapabilities.xml`

Acquire the `baumkataster_baumstandorte` point layer with WFS 1.1.0, `application/vnd.geo+json` and EPSG:4326. The initial hits total is **81,142**. Before/after totals reconcile with the single full download. The two other advertised layers are crown and CAD circle representations of these trees; importing them as extra records would duplicate the inventory.

Use `objectid` as the release-scoped row key and `baumnummer` as the visible tag. Scientific and German names are `baumnamelat` and `baumnamedeu`; `strasse` is the street label and `pflanzjahr` the planting year. Source `status` values describe categories such as fruit trees and should not be guessed to mean a living/removed status.

The source explicitly warns that crown diameters are estimated, incomplete and irregularly updated. Its CAD crown layer substitutes 8 m where a diameter is missing. Do not present those representations as exact measured crown sizes. Street-tree positions vary in accuracy with survey method; private and park-tree positions may be less precise.

## Completeness and refresh limits

No source provides a transactionally pinned snapshot across these requests. Equal before/after totals and unique IDs catch truncation and many paging errors, but cannot prove that no concurrent same-count edit occurred. A failed acquisition must not replace the last published manifest. Keep raw acquisition evidence ignored locally and publish hashes, transformations, counts, missing-location audits and source terms alongside immutable releases.
