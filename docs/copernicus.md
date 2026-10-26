# Copernicus in this pilot

The live overlay uses the official **Urban Atlas Street Tree Layer 2021** WMS. It shows mapped tree-covered areas, not individual trees. It has no species, planting year or inventory record to open. Its 2021 reference date stays visible independently of the municipal inventory release date.

The [official product page](https://land.copernicus.eu/en/products/urban-atlas/street-tree-layer-stl-2021) describes satellite-derived vector data in EPSG:3035 and currently marks it “Not yet validated.” The public catalogue gives a minimum mapping unit of 500 m². This layer is not a complete map of all trees or vegetation in Europe.

## Verified access

Checked 26 October 2026:

- Public WMS: `https://mapserver.dataspace.copernicus.eu/ogc`, layer `UA_STL_2021_VECTOR`.
- A 512 × 512 PNG over the Vienna pilot window returned HTTP 200, 45,501 bytes and `Access-Control-Allow-Origin: *`.
- Vienna vector product: `CLMS_UA_STL_S2021_V005ha_AT001L3_WIEN_03035_V01_R02_20251121`, CDSE ID `d8855523-0029-4bfc-90b3-6e4102e44d2c`. Catalogue content length: 30,066,646 bytes. The CLMS page lists a 5.82 MB compressed package; these are different measurements.
- Anonymous [OData download](<https://download.dataspace.copernicus.eu/odata/v1/Products(d8855523-0029-4bfc-90b3-6e4102e44d2c)/$value>) returned HTTP 401, `Token not found`. No credentials are bundled, requested by the app, or placed in browser code.

The WMS is a live dependency. It is **not pinned to the application's inventory release**. A successful image request does not establish polygon completeness or feature identity. It must not contribute to tree counts or search results. Service failures must leave inventory exploration working.

## Optional vector import

Download the Vienna package from the official product page using a Copernicus account, extract its `.fgb`, then run with Node 24.12 or later:

```sh
node scripts/download-canopy.mjs --file /path/to/CLMS_UA_STL_S2021_V005ha_AT001L3_WIEN_03035_V01_R02_20251121.fgb
```

The importer checks the declared EPSG:3035 CRS, feature count when supplied, polygon geometry and ring closure. It reprojects to longitude/latitude and retains complete polygons whose **envelopes** overlap `[16.38, 48.20, 16.41, 48.22]`. This conservative subset may contain polygons outside the exact window. Geometry is not clipped or simplified. Source attributes are reduced to canopy kind, reference year and source index. These are release-scoped polygon IDs, never biological tree IDs.

The candidate is written to `data/raw/copernicus-vienna.geojson` only after validation; failures leave an earlier file intact. It includes a SHA-256 digest, import date and transformation notes. The operator supplies the file; the script does not claim to authenticate that file against CDSE. It does not automatically publish the candidate or replace the live overlay.

The import contract has synthetic conformance tests for CRS rejection, coordinate conversion and malformed rings. The coordinate reference was independently generated with PROJ through pyproj 3.8.0. **An official vector file has not yet been imported, so end-to-end vector validation remains open.** No synthetic polygons ship as Copernicus observations.

## Attribution and reuse

European Union's Copernicus Land Monitoring Service information; [DOI: 10.2909/ed0018c3-5ad0-4721-b5e4-0042aeaf9d00](https://doi.org/10.2909/ed0018c3-5ad0-4721-b5e4-0042aeaf9d00). [Data policy](https://land.copernicus.eu/en/data-policy).

The policy permits reuse with source attribution, a clear statement of modifications and no implication of EU endorsement. A prepared vector subset is reprojected, spatially subset and has reduced attributes; its metadata says so. This project is independent and is not endorsed by the European Union.

## Architecture decision

For this pilot, immutable municipal releases plus a separately labelled WMS overlay are sufficient to validate the difference between tree records and vegetation. They do not complete the planned immutable canopy pipeline.

A spatial backend becomes useful when the product needs complete queries across many areas, server-side polygon operations, or data updates too large for browser delivery. It would also keep authenticated source acquisition off the client. A backend does not repair differences in source coverage or convert canopy polygons into tree records. For now, credentials belong in a preparation job, and the frontend reads prepared public data.

Further references: [CDSE OData documentation](https://documentation.dataspace.copernicus.eu/APIs/OData.html), [FlatGeobuf specification](https://flatgeobuf.org/).
