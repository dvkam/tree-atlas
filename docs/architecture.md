# Pilot architecture

The pilot publishes complete available inventories for Vienna, the canton of Geneva and Porto. Copernicus remains a separate live canopy overlay; official vector publication is not yet validated.

## Decision

Prepare validated, immutable releases outside the browser and publish their manifest last. Each selected inventory loads a compact compressed search index into a dedicated worker. The worker validates hashes and schemas, searches the complete snapshot and builds Supercluster indexes. Detailed records arrive on demand in 512-record shards, with four shards cached. Switching inventories disposes the worker.

The main thread receives only a result page of 30 records and at most 1,000 map markers or clusters. Dense views coarsen clustering rather than truncate matching records. Coincident records remain counted and accessible through the paginated list. Map movement reuses the existing clustering index; changing the text or area filter rebuilds it.

Stored gzip bytes use opaque `.bin` filenames. This prevents static servers from treating file compression as HTTP content encoding before the worker checks the stored-byte hash. Descriptor and detail identities must agree with the pinned release. Original study releases remain readable through the version-one interface.

## Alternatives and backend

Direct browser queries to WFS, ArcGIS and file downloads would move paging, CORS failures and changing schemas into each visitor's session. Loading all detailed records on the main thread would also impose unnecessary transfer and rendering work. Neither approach provides the current separation between complete search, bounded presentation and lazy details.

These three inventories fit static hosting with an owned preparation pipeline; they do not yet require an always-running application API. The largest compressed index is 5.17 MB, but worker memory remains material. Before broader expansion, measure representative phones and move assets to object storage as needed. Spatially partitioned indexes or a PostGIS-backed service become appropriate when client download and memory budgets, cross-country filters or incremental updates require them. TanStack Query caches requests; it does not replace data preparation or spatial indexing.

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
