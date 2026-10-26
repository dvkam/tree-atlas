# Tree Atlas

Explore public tree records in small study areas in **Vienna, Geneva and Porto**, with an optional **Copernicus 2021 tree-cover overlay**. This pilot tests how different inventories can share a map without losing the meaning of their data.

This is a new project by David Kaminski. It builds on the search and map work in [Baumkataster Wien](https://github.com/dvkam/baumkataster-wien), which remains a separate application. This repository starts with new history; no earlier commits have been imported.

## Start

Use Node.js 24 LTS and pnpm 11.25.0:

```sh
git clone https://github.com/dvkam/tree-atlas.git
cd tree-atlas
pnpm install --frozen-lockfile
pnpm dev
```

The checked-in data makes the pilot usable without running imports, registering for an API key or starting a backend. Open the local URL printed by Vite.

## Explore

Choose a city, then type a species, recorded street label, tag or city name in the single search field. Suggestions use the loaded source records. Full address and landmark geocoding is not included in this pilot. Porto's source has no street-label field.

Select a dot or a list item to read its details. Closing details keeps the map and search. Move the map and select **Search this area** to filter to the visible bounds. Mouse-wheel, trackpad, touch and button zoom work. The result list provides keyboard access to records.

**Near me** requests location once and checks whether it falls in a study area. It does not imply coverage elsewhere. The dashed rectangle marks the imported area, not a city boundary. Counts describe source records in that area, not every living tree.

Links retain the city, filters, selected record, layer choice and source release. Old release assets are retained in the repository; removing them would break saved links. A missing release produces an explicit message rather than substituting new records.

## Sources

| Dataset    |            Published records | Source and licence                                                                                                                             |
| ---------- | ---------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Vienna     |                        4,375 | [Stadt Wien Baumkataster](https://www.data.gv.at/datasets/c91a4635-8b7d-43fe-9b27-d95dec8392a7), CC BY 4.0                                     |
| Geneva     |                        4,685 | [SITG isolated-tree inventory](https://sitg.ge.ch/donnees/sipv-ica-arbre-isole), SITG A open access                                            |
| Porto      |                        2,328 | [Município do Porto inventory](https://dadosabertos.cm-porto.pt/dataset/identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto), CC0 |
| Copernicus | Not an individual-tree count | [Urban Atlas Street Tree Layer 2021](https://land.copernicus.eu/en/products/urban-atlas/street-tree-layer-stl-2021), live WMS                  |

Inventory extracts were retrieved on 26 October 2026. Retrieval dates are not survey dates. See [source documentation](docs/sources.md), [Copernicus findings](docs/copernicus.md), and the machine-readable [manifest](public/data/manifest.json), which points to immutable provenance with requests, licences, transformations and limitations.

Vienna height and crown values remain ranges. Geneva measurements remain values, with estimated planting years identified. Porto age ranges do not become invented planting years. Four Geneva records share an identifier documented as stable; each is retained with an object-qualified, release-scoped identity. No nearby records are automatically merged.

The Copernicus overlay is a live image service, separate from the pinned inventory snapshots. It shows tree-covered patches and rows with reference year 2021, not current individual trees or species. Official vector download requires a Copernicus account. The optional local vector importer has fixture tests but has **not** been validated with the official Vienna file or connected to the map.

## Refresh data

```sh
pnpm data:download
pnpm data:prepare
pnpm check
pnpm build
```

Downloads go into ignored `data/raw/`. The downloader verifies WFS counts and ArcGIS batch membership, retains provenance and fails on partial responses. Preparation validates every record, clips to exact geographic bounds, writes immutable releases and switches the manifest last. Review the generated reports before committing a release. Imports are manual during the pilot; no freshness schedule is promised.

## Architecture and backend

React renders the interface; TanStack Router owns shareable search state; TanStack Query caches versioned downloads. Leaflet renders the map. Zod validates source and published data. The browser loads the complete bounded study-area snapshot, so filtering cannot omit records from an unloaded tile.

We own the preparation pipeline now. An always-running API and database are not needed for this pilot. Broader coverage should move assets to object storage and introduce a tested spatial partition index. Complete cross-country queries or more complex spatial filters would justify a spatial backend such as PostGIS. See the [architecture decision](docs/architecture.md).

The UI is English, with source names preserved in their original languages. This is not yet a multilingual, citywide or European service.

## Development checks

```sh
pnpm check       # TypeScript, Oxlint, Oxfmt, Vitest
pnpm build      # Production build with the React Compiler
pnpm test:e2e   # Browser regression journeys (install Chromium first)
```

Install the test browser with `pnpm exec playwright install chromium`.

Dependencies were checked against npm's stable `latest` tags on 26 October 2026 and pinned: TypeScript 7.0.2, React 19.3.1, Vite 8.3.5 and Vitest 5.0.5. pnpm uses a committed lockfile. Oxlint 1.89.0 runs type-aware and React Compiler validation rules; Oxfmt 0.74.0 formats code. The actual React Compiler transform is `oxc-transform-react` 0.155.0 via `react({ compiler: true })`, not the linter. [Oxc marks this integration experimental](https://oxc.rs/docs/guide/usage/transformer/react-compiler).

TypeScript enables strict mode, exact optional properties, checked indexed access, unused-code and fallthrough checks, explicit overrides, checked side-effect imports and unreachable-code errors. `skipLibCheck` is **false**. Oxlint's `consistent-return` rule is disabled because it misreports exhaustive discriminated-union switches; TypeScript's `noImplicitReturns` and exhaustive-switch linting remain enabled. CSS side-effect imports are explicitly allowed.

Tests cover provider conformance, source identity conflicts, release integrity, saved-release handling, spatial edge membership and public user journeys. MSW intercepts network requests at the catalogue interface. Synthetic canopy fixtures are marked as fixtures and are never published as observations.

## Privacy and map services

There are no analytics or application accounts. Location stays in browser state and may appear in a copied area link. Opening the map sends tile-area requests to OpenStreetMap; enabling canopy sends them to Copernicus. Public services have no availability guarantee. Follow their terms and choose an appropriate tile provider before wider deployment.

Code is MIT licensed. Dataset licences and attribution remain separate; see [NOTICE](NOTICE).
