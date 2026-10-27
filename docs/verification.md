# Verification

## Expanded release — 27 October 2026

The expanded selection contains **44 inventories and 7,613,581 source records**. Of these, 7,613,308 have usable coordinates; 273 remain searchable without a map position. Five registered candidates remain blocked; Nottingham remains separately documented and unpublished. Source-specific checks cover the acquired interface, not every physical tree.

London and the 34 new inventories expose complete text search and suggestions before exact geometry is ready. The other nine current releases retain their existing combined index. Area filters wait without a partial count. Detail selection loads a separate shard. Geometry failures preserve text search and offer retry. See [search performance](search-performance.md) for the current profiling results and verification status.

The source review corrected Rostock axis order, Cologne projection and three malformed Frankfurt UTM coordinates. Turin returned 105,476 unique IDs on two full exports while WFS hits reported 105,439; this mismatch remains disclosed.

Run the production build before browser journeys. The preview server serves built files, so testing without rebuilding can test stale code. Current source conformance compares acquired normalized fixtures with fixed publisher facts and coordinate checks. These fixtures do not replay live acquisition or guarantee future provider schemas. Complete acquisitions were checked separately before publication.

### Completed expansion checks

- Strict TypeScript, type-aware Oxlint and Oxfmt passed.
- **170 Vitest tests passed** across 18 files, including audited counts, complete pagination and bounded map totals for all 44 inventories.
- **19 production Chromium journeys passed**, including the 44-inventory tour, early details, geometry failure and retry, no queued area requests while coordinates load, and text search with detail downloads unavailable.
- The production build passed. Public assets occupy 893.0 MB; all previously published releases remain available.
- Local documentation links passed inspection. Unslop found no banned phrases in the 57 checked reference and guide pages.

The mobile timing method and final measurements are recorded in [search performance](search-performance.md). Browser emulation is not a physical-phone test.

## Earlier ten-inventory checkpoint — retained for comparison

At this checkpoint, releases contained **2,429,932 records** across ten inventories. Exactly 269 records lack coordinates: 24 in Amsterdam and 245 in Camden. They remain searchable. London excludes 24,265 rows from the Camden contributor in favour of the separate current Camden inventory. Counts describe source records, including some Edinburgh groups, not distinct physical trees.

## Completed checks

- Strict TypeScript, type-aware Oxlint with React Compiler rules, and Oxfmt passed.
- **93 Vitest tests passed**, including source conformance, complete counts for all ten inventories, streamed London parsing, immutable publication, spatial membership, hash failures, cancellation, bounded cache persistence and unlocated search.
- **15 Chromium journeys passed**. They cover all ten inventories, early tree selection while the complete index is blocked, pending search, corrupt spatial-data fallback, rapid city changes, saved releases, mobile layout, zoom, pagination and cache reuse.
- The production build passed with the Oxc React Compiler.

The restricted Windows test launcher initially failed while reading user information. The full checks passed with normal Windows process access. An earlier browser runner also left its local test server open; after closing that test-owned server, the complete browser suite exited successfully.

The cold-load profile and follow-up measurements are in [cold-profile.md](cold-profile.md). These use desktop mobile emulation, not a physical phone. External basemap requests are blocked, so browser tests do not prove third-party service availability.

## Review findings

Two review rounds compared the architecture and inspected the implementation. Fixes cover visible partial-cell aggregates, background cache persistence, spatial-error fallback, streamed large-source parsing and sequential publication. See [repository-review.md](repository-review.md).

UK source checks replaced an Edinburgh demo service with the official council layer, verified all 50,400 object IDs, retained source coordinate and unit uncertainty, and preserved Camden rows whose asset identifiers repeat. Nottingham remains unpublished because the inspected GIS terms prohibit redistribution.

Published releases are immutable. Old study and full-inventory links remain available. Source counts, hashes and identity checks validate acquired data; they do not establish transactional upstream snapshots or physical completeness.
