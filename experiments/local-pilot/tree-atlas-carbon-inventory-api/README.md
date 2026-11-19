# Local Carbon inventory-query adapter

> **Versioned pilot branch:** Start with [the workspace guide](../README.md). This copy is under `experiments/local-pilot/tree-atlas-carbon-inventory-api`. Original dated sections below describe earlier checkpoints; use [branch validation](../BRANCH-VALIDATION.md) for the current relocation checks. Historical reports are archived separately; see [the evidence policy](../HISTORICAL-EVIDENCE.md). No public app or deployment changes are included.

This local interoperability adapter reads the four validated PostgreSQL releases.
It returns exact search results without sending a whole inventory to the client.
The public apps, frozen contract and canonical records are unchanged. No frontend
connection, active catalogue publication or deployment was performed.

## What runs where

| Owner | Responsibility |
| --- | --- |
| Carbon, `src/service.carbon` | Routes, methods/media gates, SQL-operation selection, response forwarding |
| Private C++ runtime | Inventory input validation, Unicode, query-key encoding, bounded cache, HTTP lifecycle, pool and cancellation |
| PostgreSQL functions in `sql/api.sql` | Search membership, exact counts, ordinal pagination, grid aggregation, details and suggestions |

The C++ and SQL implementation is substantial. This proves a Carbon entrypoint
and native interoperability adapter, not a Carbon-native web framework or a
Carbon-majority domain implementation. The runtime starts from the earlier local
C1 PoC but lives in a separate folder; that original executable and database were
not changed.

The server uses the restricted `tree_atlas_reader` role against `tree_atlas_pilot`.
SQL functions execute with the caller's rights and read validated views only.
They do not fetch municipal APIs, import records or write canonical data.

## Correctness evidence

The frozen cohort remains London 1,111,784; Vienna 233,102; Geneva 240,827; Porto
71,634. Total: **1,657,347 records**. Every ID was read through actual HTTP and
matched the independent ordered identity digests across **16,576 pages**.

Other checks cover:

- 192 selected HTTP pages across all 48 frozen query cases, exact totals,
  located/viewport counts, release fingerprints and query/request correlation.
- 16 suggestion cases, eight full canonical details and small filtered sets.
- Complete sampled cluster unions and viewport pages; a real pair of coincident
  Geneva trees remains individually reachable at zoom 24.
- 22 HTTP regressions, including real blocked-SQL cancellation, deadline expiry,
  client reset, delayed legitimate half-close, malformed Unicode, embedded NUL,
  large escaped valid text, exact composite IDs and missing-release behavior.
- 1,132,108 native normalization parity cases against pinned Node Unicode 17,
  including every Unicode scalar and contextual strings.
- 20,012 numeric serialization cases against ECMAScript JSON.stringify.
- Real SQL regressions for tiny viewport arithmetic and missing release metadata;
  synthetic metadata changes are always rolled back.

The normalizer uses an isolated official ICU 78.3 client package with a checked
SHA-256. It performs NFD, Diacritic-property removal, root lowercase and the exact
ECMAScript trim set. It does not use host locale or PostgreSQL unaccent. Escaped
lone surrogates are rejected before json-c can replace them. Valid NUL query text
cannot occur in PostgreSQL text: it produces exact zero membership and its own
correct query key, rather than being truncated to an empty query.

Query keys use explicit ECMAScript number formatting, including negative zero,
subnormal numbers and decimal/scientific notation thresholds. json-c's default
double formatting is not used for this key. Source IDs remain exact strings.

## London filtered-query follow-up — 19 November

The current read path uses one exact summary membership scan, skips SQL for
provably empty/out-of-range list pages, and filters/pages a covering search
projection before retrieving only the selected canonical records. The search
cover adds about 262 MB. [Investigation and regression scope](sql/LONDON-SEARCH.md)
records the reproduced timeouts, phase observations and unchanged deadline.
Apply `sql/apply_search_index.py` after staging/restoring; it validates an existing
index definition and performs ordinary VACUUM/ANALYZE. Full current HTTP, offline
and clean-room evidence is recorded at the workspace level.

## Performance changes and measurements

`sql/PROFILE.md` records the actual nested plans and counterfactual measurements.
The original London path scanned about a gigabyte of heap data and spilled a
large sort. A sixth-call generic-plan switch made some runs exceed five seconds.
The measured fixes were:

- A valid 128,090,112-byte spatial covering index and ordinary post-load VACUUM.
- Function-scoped custom plans; summary alone disables JIT and unavailable
  parallel-worker planning. No cluster-wide PostgreSQL settings changed.
- Contiguous ordinal-range paging for empty queries, avoiding repeated deep
  OFFSET scans. Filtered queries retain the frozen offset semantics.
- Compact release metadata lookup, avoiding repeated descriptor serialization.
- A 64-entry / 32 MiB encoded-summary LRU, keyed by immutable release, normalized
  filter, viewport and zoom. Page contents and caller keys are never cached there.
  Singleflight avoids duplicate concurrent builds of the same summary. The
  exhaustive run held about 1.32 MB of encoded summary data, not a full inventory.
- A bounded 16-request database wait queue instead of four. The first burst test
  rejected 13 of 100 ten-client requests. The revised queue kept two database
  connections and the same 250 ms wait/deadlines, and removed those errors.

The local performance run checked response correctness as well as timing:

| Case | Samples | p95 | Errors |
| --- | ---: | ---: | ---: |
| Fresh API process/cache, first complete London search including process startup and attempt reservation | 30 | 1,033 ms | 0 |
| Warm pinned queries, one concurrent client | 100 | 7.7 ms | 0 |
| Warm pinned queries, ten concurrent clients | 100 | 20.0 ms | 0 |
| Warm pinned queries, 25 concurrent clients | 100 | 47.3 ms | 9 explicit 503 busy responses |

The slowest of the 30 fresh-process samples was about 1,059 ms. Observed API
process RSS after the warm test was 44,984 KiB, excluding PostgreSQL, OS cache
and test clients. Client maxSockets was 32, so the concurrency test was not
silently limited to two client sockets. Busy responses contain no partial data.

These are localhost measurements with warm/uncontrolled database and OS caches.
They do not establish the full browser-to-first-result three-second target,
physical mobile performance, hosted latency, cold database behavior or ten
simultaneous uncached distinct text filters. The 25-client row is stress
characterization, not a zero-error pass. London still has a sort spill; broad
filtered deep-page work is not solved by the summary cache. No trigram GIN
indexes were installed; `sql/indexes.sql` is an optional candidate, not evidence
that those indexes help. Database size with the covering index is about 1.74 GB,
excluding WAL and temporary peaks.

## Run locally in WSL

The validated staging database and private `reader.json` from the previous step
must already exist. From this folder:

```sh
python3 tools/build.py
python3 tools/run.py
```

The executable binds an ephemeral **127.0.0.1** port and prints `PORT <number>`.
Stop it with Ctrl-C. Credentials stay in the private 0600 WSL configuration;
the launcher passes them through the environment, never argv or reports.

The checked ICU client is under `unicode/tools/icu/usr/local`. On a fresh local
copy, `python3 unicode/fetch_icu.py` fetches and checks the pinned client; it is
Linux x86-64 tooling, not a portable hosting package. The compiler and libpq
client remain pinned in the earlier Carbon PoC.

The SQL functions and covering index are already installed. Fresh setup after
validated staging would use:

```sh
sudo python3 tools/install_sql.py
sudo python3 sql/apply_spatial_index.py
sudo python3 sql/apply_search_index.py
sudo python3 sql/vacuum_after_import.py
```

These operations add read paths and maintain visibility/statistics; they do not
rewrite canonical records or publish a catalogue. Restart the local API after
changing query functions so in-memory summaries are not retained across code
changes. Do not run table-lock fault tests during benchmarks.

## HTTP interface

`GET /health` and `GET /stats` are local diagnostics. Reserve a single-use token
with `POST /attempt`; send it as `X-Request-ID` on each inventory request. Tokens
expire unused after 30 seconds and cannot be replayed. Each retry reserves a new
token. `POST /cancel` with `{"id":"<token>"}` cancels pending or active work.

All `/v1/` operations are POST with application/json and a nonempty scalar
`requestKey`. The optional `contractVersion` defaults to `1.0.0`; explicit null
and other versions are rejected. Dataset/release pins are required except for
the validated-release listing.

| Endpoint | Input beyond dataset/release/requestKey | Result |
| --- | --- | --- |
| `/v1/query` | q, area, viewport, zoom, offset, limit | Complete list page, exact counts and bounded markers |
| `/v1/viewport-page` | Same query fields | Exact located viewport page and viewport total |
| `/v1/cluster-members` | Same fields plus opaque clusterId | Exact member page and cluster total |
| `/v1/detail` | sourceId | Full canonical tree, or tree:null within a valid release |
| `/v1/suggest` | q | First eight matching raw dictionary values |
| `/v1/release` | None | Counts, fingerprints, source coverage/licence/attribution |
| `/v1/catalogue` | requestKey only | All locally validated release metadata; not an active-publication pointer |

Example query body:

```json
{"contractVersion":"1.0.0","dataset":"london","release":"london-316fa121a19059da","q":"acer","area":null,"viewport":[-0.4976816539342512,51.30075137186821,0.2865384448851,51.68540514331459],"zoom":12,"offset":0,"limit":25,"requestKey":"local-check-1"}
```

`q` is field-by-field literal inventory text search, not address geocoding.
The query limit is 500 UTF-16 units; pagination limit is 1–100. Viewport does not
filter the main list. Clusters use at most 900 exact-viewport grid cells and
never depend on the list page. This implementation represents all exact
viewport points, so representedLocatedCount equals viewportLocatedTotal. Cluster
grouping/pixels differ from Supercluster without changing frozen membership.
At maximum zoom the member endpoint still exposes every coincident identity.

Query keys identify the frozen parent input; endpoint and clusterId must also
be included in any future client cache key for different member operations.
Cluster handles are opaque and scoped to normalized filter/release/viewport/zoom.
They are not authorization credentials.

Failures are explicit: 400 invalid input/unsupported contract, 404 unavailable
pinned release, 409 cancellation/spent token, 503 busy/database failure, 504
deadline. Missing detail is a successful null only after release validation.
No error becomes an empty or partial successful result.

The runtime caps connections at 32 and bodies at 16 KiB. Header/body phases
have 1,500 ms absolute limits. Query work has a 2,500 ms budget, with up to
450 ms cancellation cleanup; transport cutoff is 3,100 ms from completed headers,
with scheduling tolerance. The launcher adds a 3,500 ms server fallback. Reset
cancellation is observed; FIN alone remains ambiguous and legitimate write-half-
close is preserved. No universal hard network timing guarantee is claimed.

## Rerun checks

```sh
NODE=/home/david/.nvm/versions/node/v26.13.0/bin/node
sudo env TREE_ATLAS_HTTP_FAULTS=1 python3 -m unittest discover -s tests -v
"$NODE" verification/http-conformance.mjs --quick
"$NODE" verification/http-conformance.mjs
"$NODE" verification/profile-http.mjs
```

The full run enumerates every unfiltered record and hashes actual HTTP IDs.
It does not claim exhaustive HTTP enumeration of every broad filtered match
set, every cluster in every city, or every detail record. PostgreSQL staging
already has separate full canonical/filtered-set evidence. Normalization and
number probe instructions/evidence are under `unicode/` and `tools/`.

## Remaining gates

The subsequent [isolated local frontend](../tree-atlas-local/README.md) now connects
these pinned interfaces to the existing React map and search. It adds verified
complete offline city packs, a versioned app shell, separately saved details,
pinned Unicode 17 normalization, and browser correctness/loading checks. See
its runbook and evidence for the exact tested scope; the API's HTTP/SQL checks
remain separate evidence. Public applications were not changed.

Production admission/authentication, HTTPS ingress, deployment packaging and
restore, refresh publication, full browser journeys and shaped mobile/hosted
performance are still pending. This step made no hosting purchase, repository
push, app deployment or source-data refresh.
