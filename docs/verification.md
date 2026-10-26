# Verification — 27 October 2026

The current releases contain **2,429,932 records** across ten inventories. Exactly 269 records lack coordinates: 24 in Amsterdam and 245 in Camden. They remain searchable. London excludes 24,265 rows from the Camden contributor in favour of the separate current Camden inventory. Counts describe source records, including some Edinburgh groups, not distinct physical trees.

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
