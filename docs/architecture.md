# Pilot architecture

Status: the bounded pilot implements the prepared-release design for inventories. Vienna, Geneva and Porto are separate datasets. Copernicus uses a live canopy overlay; immutable vector publication remains unvalidated.

## Work phases

- Ground: complete; the existing Vienna app and provider differences were reviewed.
- Sketch: complete; direct provider queries and prepared releases were compared independently.
- Agree: complete; the user selected this pilot and a separate public repository.
- Implement: bounded inventory pilot complete; Copernicus vector validation remains open.
- Scrap: revisit if source differences leak into the UI or bounded reads cannot remain complete.

## Synthesis decision

Prepare validated, immutable releases outside the browser. Publish their manifest last. The browser loads a release once and queries that snapshot. The pilot uses small, explicit study areas and loads every record in each area; it does not yet claim citywide or European search. This keeps spatial completeness testable without prematurely adding a tile index.

The alternative was a common browser interface over live WFS, ArcGIS and file downloads. That avoids a publishing job but shifts paging, CORS failures and changing upstream schemas into every visitor's session. It cannot provide a consistent snapshot across map, results and details.

## Does this need our own backend?

It needs an owned data preparation process now, but not an always-running application API or database. Static releases can be hosted alongside the frontend during the bounded pilot. Move large assets to object storage before extending coverage substantially. Add a spatial backend such as PostGIS when complete cross-country filters, arbitrary large-area searches or incremental source updates justify its operating cost. TanStack Query is a browser request cache, not a substitute for data preparation or a spatial database.

## Caller interface

`importInventory(dataset, raw)` validates and normalizes provider records. `loadRelease(manifest, signal)` validates a published snapshot. `searchInventory(release, area, text)` searches that complete snapshot. Selection is dataset-qualified and stays independent from search and map position.

## Agreed test interfaces

The user approved source import conformance, published catalogue behavior (including network failures through MSW), and user journeys. Tests exercise these public interfaces. They do not prove that a provider has recorded every real-world tree.

## Invariants

- A source record is not a biological identity. IDs are qualified by dataset; release-scoped IDs also require a release.
- Unknown values stay unknown. Height ranges are not exact measurements. Age is not a planting year.
- Source reference date, retrieval date and publication date are distinct.
- No proximity-based deduplication across inventories.
- A failed or empty import must not replace a valid release.
- Search, map and details use the same immutable release. Failed downloads never look like zero trees.
- Coverage means a published study area, not every tree within that geography.
- Copernicus polygons have source and reference-year details, not species details.
