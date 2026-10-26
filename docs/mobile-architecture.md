# Mobile and six-inventory architecture

## Work phases

- Ground: complete. Acquisition publishes immutable descriptors, full search indexes and lazy detail shards. The UI terminates its worker on each inventory change. A new worker verifies, parses and indexes the selected inventory; only result pages and map clusters reach React.
- Sketch: complete. Compared complete worker indexes with bounded compressed-byte storage against precomputed spatial tiles plus independent complete text postings.
- Agree: proceed under the user's implementation request; no additional checkpoint requested.
- Implement: bounded verified-byte cache, lossless adaptive encoding, stable map layers and six-source conformance implemented.
- Scrap: reconsider partitioned search if measured phone download or memory costs remain unacceptable.

## Usage and shape

The caller still opens `createInventorySession(base, dataset, signal)`, calls `query`, `suggest` or `detail`, then disposes the session. The module hides validation, cache recovery, source release identity, search and clustering. Callers never coordinate a map tile index with a separate text index.

Only verified immutable asset bytes enter persistent browser storage. Parsed indexes and clusters belong to one active worker. Cache keys combine the asset URL and expected hash. Cache denial, eviction or corruption falls back to a verified network request. Stored bytes are bounded to 32 MiB and 18 entries, with an 8 MiB maximum per asset; no user searches or locations are stored. Rapid switching cancels the previous worker.

## Synthesis decision

Two independent candidates and a separate reviewer favored keeping the existing search interface. Candidate A reduces repeated transfer without keeping multiple parsed inventories alive. Candidate B separates prepublished spatial clusters and text postings, which can reduce cold-load memory but adds publication, completeness and version-coordination rules. The reviewer preferred A for six municipal inventories; B remains the next option if measurements justify its cost. The skill's named external model families are unavailable in this environment; the comparison used independent agents on the available parent model.

## Tradeoffs

- Returning to a city avoids asset transfer when cached but still validates, parses and rebuilds its worker index.
- Cold loads still require the complete selected-city search index; this preserves exact global search and existing saved links.
- Provider REST, WFS and tile interfaces are documented as source capabilities. Runtime search uses pinned prepared records, so provider paging, authentication and schema changes do not become visitor failures.
- Mobile emulation provides repeatable regression evidence, not real-phone thermal or memory guarantees.

## Verification rubric

Exact whole-inventory search and cluster counts; isolation during rapid switching; bounded retained data; reproducible cold and return loading; unchanged saved releases; small caller interface. UI improvements must keep immediate feedback without showing a previous city's records as the new city.

## Lossless transfer and missing locations

The publisher compares JSON gzip with byte-plane columns and chooses the smaller asset per inventory. Float64 coordinates are preserved without rounding; string IDs retain leading zeros and precision. Both formats decode behind the same search interface and every asset remains hash-verified. Older releases retain their original format.

Amsterdam publishes 24 unlocated records. Position is now nullable: global search and details include those rows, spatial queries do not. Total and located counts reconcile independently. Thirty distant Amsterdam coordinates remain unchanged with quality notes; a separate initial map view keeps the default camera over Amsterdam.
