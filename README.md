# Tree Atlas

Explore **44 public tree inventories across Europe**, with **7,613,581 source records** and an optional **Copernicus 2021 tree-cover overlay**. Choose a country and inventory in the location picker. These records describe what each publisher supplies, not every physical tree in those places.

[Open Tree Atlas](https://dvkam.github.io/tree-atlas/)

This is a new project by David Kaminski. It builds on the search and map work in [Baumkataster Wien](https://github.com/dvkam/baumkataster-wien), which remains a separate application. This repository starts with new history; no earlier commits have been imported.

## Start

Use Node.js 24 LTS and pnpm 11.25.0:

```sh
git clone https://github.com/dvkam/tree-atlas.git
cd tree-atlas
pnpm install --frozen-lockfile
pnpm dev
```

The checked-in data makes the app usable without running imports, registering for an API key or starting a backend. Open the local URL printed by Vite.

## Explore

Choose a country and inventory, then type a species, recorded street label, tag or city name in the single search field. The map opens before the complete search index finishes loading. You can zoom in and read tree details during this time. A status message tells you when complete search is still loading; early map markers are not filtered by your query. For London and the 34 new inventories, complete text search becomes available before all geometry has loaded. Suggestions and text totals cover every source record. Exact area filtering waits for geometry and shows a pending state without a partial count. Selecting a text result loads its detail record; pending coordinates are not labelled as missing. A geometry failure leaves text search available and offers a retry. Full address and landmark geocoding is not included. Porto's source has no street-label field.

Select a numbered cluster to zoom in, then select a dot or a list item to read its details. Closing details keeps the map and search. Move the map and select **Search this area** to filter to the visible bounds. Mouse-wheel, trackpad, touch and button zoom work. Results are paged in groups of 30 for keyboard access. Unlocated records remain searchable but cannot appear on the map. Without a map-area filter, search covers the entire selected inventory.

**Near me** requests location once and searches the surrounding area when it falls within an inventory's extent. The dashed rectangle is the extent of the published coordinates, not an administrative boundary or a guarantee of coverage at every point. Geneva includes its canton, not only the city.

Links retain the city, filters, selected record, layer choice and source release. Old release assets are retained in the repository; removing them would break saved links. Original study-area links still open their original records and offer **Open full inventory**. A missing release produces an explicit message rather than substituting new records.

## Sources

| Dataset       |            Published records | Source and licence                                                                                                                             |
| ------------- | ---------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Vienna        |                      233,102 | [Stadt Wien Baumkataster](https://www.data.gv.at/datasets/c91a4635-8b7d-43fe-9b27-d95dec8392a7), CC BY 4.0                                     |
| Geneva canton |                      240,827 | [SITG isolated-tree inventory](https://sitg.ge.ch/donnees/sipv-ica-arbre-isole), SITG A open access                                            |
| Porto         |                       71,634 | [Município do Porto inventory](https://dadosabertos.cm-porto.pt/dataset/identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto), CC0 |
| Amsterdam     |                      326,518 | [Gemeente Amsterdam v2 tree API](https://api.data.amsterdam.nl/v1/docs/datasets/bomen@v2.html), published public-data terms                    |
| Hamburg       |                      229,876 | [Transparenzportal street-tree inventory](https://suche.transparenz.hamburg.de/dataset/strassenbaumkataster-hamburg34), DL-DE-BY 2.0           |
| Zürich        |                       81,142 | [Stadt Zürich Baumkataster](https://data.stadt-zuerich.ch/dataset/geo_baumkataster), CC0                                                       |
| London        |                    1,111,784 | [GLA Public Realm Trees](https://data.london.gov.uk/dataset/london-public-realm-trees-2r45m), OGL v3.0; Camden contributor excluded            |
| Camden        |                       28,128 | [Trees in Camden](https://opendata.camden.gov.uk/d/csqp-kdss), OGL v3.0                                                                        |
| Edinburgh     |                       50,400 | [Council Trees service](https://services-eu1.arcgis.com/FgpikkYuSUOuITxp/arcgis/rest/services/Trees/FeatureServer/41), OGL v3.0                |
| Belfast       |                       56,521 | [Council tree downloads](https://www.belfastcity.gov.uk/open-and-linked-data), OGL v3.0                                                        |
| Copernicus    | Not an individual-tree count | [Urban Atlas Street Tree Layer 2021](https://land.copernicus.eu/en/products/urban-atlas/street-tree-layer-stl-2021), live WMS                  |

The remaining 34 inventories are listed in the [complete source API index](docs/source-apis/index.md), with individual counts, licences, fields and limitations. Luxembourg City, Gdańsk, Wrocław, Poznań and Warsaw remain unpublished because access or redistribution terms are not verified. Nottingham remains unpublished under the inspected restrictive GIS terms.

Inventory extracts were retrieved on 26–27 October 2026. Retrieval dates are not survey dates. See the [per-city API reference](docs/source-apis/index.md), [UK source review](docs/uk-source-review.md), [original source documentation](docs/sources.md), [new source documentation](docs/new-sources.md), [Copernicus findings](docs/copernicus.md), and the machine-readable [manifest](public/data/manifest.json), which points to immutable provenance with requests, licences, transformations and limitations.

Vienna height and crown values remain ranges. Geneva measurements remain values, with estimated planting years identified. Porto age ranges do not become invented planting years. Six Geneva records share two identifiers documented as stable; each is retained with an object-qualified, release-scoped identity. One Geneva record has source planting year 202, outside the supported range: the record remains available, its planting year is shown as unknown, and the original value is preserved in a quality note. No nearby records are automatically merged. London excludes 24,265 rows whose maintainer is exactly `LB Camden`; the separate Camden inventory supplies current coverage. This is a provider partition, not record-by-record matching. Camden row IDs are release-scoped because asset identifiers repeat. Edinburgh includes group records, so record counts are not physical-tree counts. Belfast’s companion XML was created on 24 February 2026; this is not a confirmed CSV survey date.

Nottingham is not published. Its GIS terms prohibit redistribution, and we have not verified an open licence for layer 42. The [Nottingham source note](docs/source-apis/nottingham.md) records the blocker.

The Copernicus overlay is a live image service, separate from the pinned inventory snapshots. It shows tree-covered patches and rows with reference year 2021, not current individual trees or species. Official vector download requires a Copernicus account. The optional local vector importer has fixture tests but has **not** been validated with the official Vienna file or connected to the map.

## Refresh data

```sh
pnpm data:download
pnpm data:prepare
pnpm check
pnpm build
```

Downloads go into ignored `data/raw/`. Vienna uses ordered keyset paging with before/after source counts. Geneva uses all source IDs, validated batches and a final ID-set comparison. Porto uses the full published GeoJSON resource. Amsterdam uses the current v2 REST collection, Hamburg its Transparenzportal-linked WFS, and Zürich its WFS tree-point layer. Where the provider supports count or ID checks, the downloader compares them. Turin’s unresolved count mismatch is disclosed. WFS, GeoJSON and Amsterdam vector-tile capabilities are documented; the app uses pinned snapshots rather than mixing live provider tiles with saved records. Preparation validates every record; full-inventory releases fail if any record would be excluded by their geographic extent. Unlocated records remain searchable and readable; exact map-area searches exclude them. The manifest gives located and unlocated totals for each release. Thirty distant Amsterdam source coordinates remain unchanged with quality notes. Immutable files are written before the manifest pointer changes. Review the generated reports before committing a release. Imports are manual; no freshness schedule is promised. See the [operations guide](docs/operations.md) for refresh, failed-publication recovery and rollback.

## Architecture and backend

React renders the interface; TanStack Router owns shareable search state; TanStack Query caches query results and details. A dedicated worker loads and validates the selected inventory's compact search index. Search and Supercluster indexing run off the UI thread. Leaflet draws at most 1,000 result markers or clusters for the viewport, plus the selected-record highlight. The list returns 30 records per page. Search results remain complete: clusters change presentation, not which records match.

Each current release has a small spatial catalogue. The map loads this first, then requests only the detail leaves needed for its viewport. It keeps at most 16 leaves, with at most three leaf downloads at a time. Spatial assets and the complete search index belong to the same immutable release. Once complete search is ready, the map switches to its filtered results. Older releases without spatial assets use the original loading path.

London and the 34 new inventories load a complete text index first, then exact geometry. All records become searchable before coordinates finish downloading. Exact area filtering waits for geometry; the early map remains unfiltered and says so. Retained version-two releases use the previous combined index. Coordinates are preserved exactly. Measurements and other details are loaded in 512-record compressed shards on demand, with four shards cached per worker. Files use opaque `.bin` names to prevent static hosts from interpreting stored gzip bytes as HTTP content encoding. Hashes are checked before worker decompression. A bounded browser cache retains verified immutable bytes (up to 32 MiB and 18 entries); denied or corrupted storage falls back to the network. Switching inventory disposes its worker, so parsed inventories do not accumulate. See the current [search performance comparison](docs/search-performance.md) and the earlier [cold-load drill-down](docs/cold-profile.md), [repository review](docs/repository-review.md), [mobile-like measurements and limitations](docs/mobile-performance.md) and the [architecture comparison](docs/mobile-architecture.md).

We own the preparation pipeline. These 44 published inventories use static hosting without an always-running application API. London is the largest test case; early map access does not remove the cost of downloading and building its complete search index. Broader coverage should use object storage and a measured indexing strategy; complete cross-country queries or more complex spatial filters would justify a spatial backend such as PostGIS. This implementation is not a claim that loading a complete index per country will scale. See the [architecture decision](docs/architecture.md).

The UI is English, with source names preserved in their original languages. Countrywide search, translated interfaces and full address geocoding are not included.

Turin’s full GeoJSON response contains 105,476 unique planting-site records, while WFS hits reported 105,439. The import preserves the returned records and reports this unresolved mismatch; it does not claim live-service completeness. Frankfurt retains three malformed UTM positions as unlocated records.

## Development checks

```sh
pnpm check       # TypeScript, Oxlint, Oxfmt, Vitest
pnpm build      # Production build with the React Compiler
pnpm test:e2e   # Run after build; journeys use the production preview
pnpm benchmark # Local engine measurements, excluding network and browser startup
```

Install the test browser with `pnpm exec playwright install chromium`.

Dependencies were checked against npm's stable `latest` tags on 26 October 2026 and pinned: TypeScript 7.0.2, React 19.3.1, Vite 8.3.5 and Vitest 5.0.5. pnpm uses a committed lockfile. Oxlint 1.89.0 runs type-aware and React Compiler validation rules; Oxfmt 0.74.0 formats code. The actual React Compiler transform is `oxc-transform-react` 0.155.0 via `react({ compiler: true })`, not the linter. [Oxc marks this integration experimental](https://oxc.rs/docs/guide/usage/transformer/react-compiler).

React Strict Mode is enabled. It checks effect cleanup and other lifecycle assumptions in development. Its extra development renders do not run in production. We keep it to catch leaked workers and stale map sessions.

TypeScript enables strict mode, exact optional properties, checked indexed access, unused-code and fallthrough checks, explicit overrides, checked side-effect imports and unreachable-code errors. `skipLibCheck` is **false**. Oxlint's `consistent-return` rule is disabled because it misreports exhaustive discriminated-union switches; TypeScript's `noImplicitReturns` and exhaustive-switch linting remain enabled. CSS side-effect imports are explicitly allowed.

Tests cover provider conformance, source identity conflicts, release integrity, saved-release handling, full-source count reconciliation, spatial edge membership, cluster count conservation, lazy details and public user journeys. MSW intercepts network requests at the catalogue interface. Synthetic canopy fixtures are marked as fixtures and are never published as observations.

## Privacy and map services

There are no analytics or application accounts. Location stays in browser state and may appear in a copied area link. Opening the map sends tile-area requests to OpenStreetMap; enabling canopy sends them to Copernicus. Public services have no availability guarantee. Follow their terms and choose an appropriate tile provider before wider deployment.

Code is MIT licensed. Dataset licences and attribution remain separate; see [NOTICE](NOTICE).
