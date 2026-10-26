# Pilot architecture

The pilot publishes complete available inventories for Vienna, the canton of Geneva, Porto, Amsterdam, Hamburg, Zürich, London, Camden, Edinburgh and Belfast. Copernicus remains a separate live canopy overlay; official vector publication is not yet validated.

## Decision

Prepare validated, immutable releases outside the browser and publish their manifest last. A small, verified spatial catalogue opens first. A quadtree selects aggregates or detail leaves for the viewport; each leaf normally contains at most 512 located records. Coincident records at the maximum tree depth may remain aggregated until full search is ready. The browser retains at most 16 leaves and fetches at most three at once. A viewport query caps individual records at 4,096 before further aggregation, then returns at most 1,000 markers. Leaf details allow selection before the global index is available.

After the first map result, the selected inventory loads a complete compressed search index into a dedicated worker. Early map markers are unfiltered; the UI states that complete search is pending. The first complete search result replaces the early map data. The worker validates hashes and schemas, searches the complete snapshot and builds Supercluster indexes. Detailed records arrive on demand in 512-record shards, with four shards cached. Switching inventories disposes the worker and spatial session. Superseded viewport requests are aborted. A spatial failure displays a notice and falls back to the complete index. Saved releases without spatial assets use the original full-index path.

The main thread receives only a result page of 30 records and at most 1,000 map markers or clusters. Dense views coarsen clustering rather than truncate matching records. Coincident records remain counted and accessible through the paginated list. Map movement reuses the existing clustering index; changing the text or area filter rebuilds it.

Stored gzip bytes use opaque `.bin` filenames. This prevents static servers from treating file compression as HTTP content encoding before the worker checks the stored-byte hash. Descriptor and detail identities must agree with the pinned release. Original study releases remain readable through the version-one interface.

London raw JSON exceeds the JavaScript single-string limit. Preparation verifies its checksum as a stream, then parses feature batches and checks identities across batches. Each source’s immutable output is written before preparing the next source. Only small dataset metadata remains for the final manifest switch. A failed preparation may leave unused immutable files, but it cannot replace the active manifest.

## Alternatives and backend

Direct browser queries to WFS, ArcGIS and file downloads would move paging, CORS failures and changing schemas into each visitor's session. Loading all detailed records on the main thread would also impose unnecessary transfer and rendering work. Neither approach provides the current separation between complete search, bounded presentation and lazy details.

These ten inventories use static hosting with an owned preparation pipeline; they do not yet require an always-running application API. Worker memory remains material; current index sizes are recorded in [mobile performance](mobile-performance.md). Before broader expansion, measure representative phones and move assets to object storage as needed. Spatially partitioned indexes or a PostGIS-backed service become appropriate when client download and memory budgets, cross-country filters or incremental updates require them. TanStack Query caches requests; it does not replace data preparation or spatial indexing.

## Public interfaces and tests

Source import validates provider records and identity rules. The published catalogue interface validates descriptors, assets, release identity, complete query counts and lazy details, with MSW covering failures. Browser journeys cover search, map interactions, pagination, city changes and saved links. These are the three test interfaces agreed with the user.

## Invariants

- Source records are not biological identities. IDs are dataset-qualified; release-scoped IDs also require a release.
- Unknown measurements stay unknown; ranges remain ranges and age is not a planting year.
- Retrieval, publication and source reference dates remain distinct.
- Full-inventory publication fails if its bounds would exclude records. No proximity deduplication occurs.
- Failed imports cannot replace the valid manifest. Downloads failing validation never appear as zero results.
- Search, map and details use one immutable release. Saved releases remain available.
- Clustering changes presentation, not membership. Pagination does not cap the search.
- Source extent is not an administrative boundary or proof of complete physical-tree coverage.
- Copernicus coverage is vegetation, not individual species records.

See [measured performance and limitations](performance.md) and [source evidence](sources.md).

See [mobile architecture](mobile-architecture.md) for the cache, lossless encoding and partitioned-search comparison.
