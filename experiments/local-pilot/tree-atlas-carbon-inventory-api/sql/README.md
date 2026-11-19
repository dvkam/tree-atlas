# Read-only inventory SQL interface

`api.sql` defines PostgreSQL functions called by Carbon-selected parameterized
SQL. Every function is SECURITY INVOKER and uses only validated views. The
`tree_atlas_reader` role still cannot read base staging tables or write data.
The native request module must validate input, normalize text under Unicode 17,
and calculate query correlation before binding `$1::jsonb` and `$2::text`.
No function forwards municipal API requests.

All release-scoped outputs include `releaseFingerprint`, the canonical content
SHA-256 of the pinned validated release. Missing pins raise SQLSTATE P0002;
unsupported input/cluster parameters raise 22023; mismatched release contract
metadata raises 55000. Missing detail in an available release returns tree:null.
No missing release becomes an empty result or latest-release fallback.

Functions:

| Function | Result |
| --- | --- |
| summary | exact total/located/viewport counts, bounded markers, aggregation/readiness |
| page | ordinal page of text-and-area matches |
| viewport_page | exact viewport-filtered located page and total |
| cluster_members | exact cell member page and total/memberCount |
| detail | exact source-ID canonical detail or null |
| suggest | first eight matching raw dictionary values in prepared order |
| release_info | pinned release evidence, counts and fingerprints |
| catalogue | all locally validated releases; no active publisher/latest pointer |

The grid is 30×30 over the exact viewport subset. It therefore returns at most
900 marker objects and represents every located matching point inside that
viewport exactly once. Singleton cells expose a tree; other cells expose a raw
`cell` coordinate, count, mean position and expansion zoom. Native code must
replace/bind the raw cell to an opaque handle scoped to the release, normalized
query, area, viewport and zoom before exposing member lookup publicly. The SQL
does not authenticate an opaque client handle.

This grouping is deliberately not pixel-identical to Supercluster. Its exact
represented count equals exact viewport count; the frozen contract permits this
while separately defining both counts. Paged viewport/member access preserves
coincident-tree access at maximum zoom.

Text uses escaped literal LIKE, not ILIKE or database unaccent. Percent,
underscore and backslash are escaped as data. This enables optional trigram
indexes while retaining the exact frozen substring predicate. The native module
sanitizes PostgreSQL-inexpressible U+0000 text to a `containsNul:true` request
flag and an empty bound term. All relevant functions explicitly return zero
matches for that flag; they must not mistake it for empty-query/all-records.

## Performance behavior to measure

Summary and page are separate SQL operations so the native adapter can cache
bounded immutable summaries across pagination. The summary cache key must include
release fingerprint, normalized text, NUL flag, selected area, viewport and zoom;
offset/limit are excluded. The HTTP query still completes only when both outputs
are available. Cache expiry is a performance concern, not source freshness, since
the release is immutable.

Global empty-query totals use verified release counts. Global empty-query pages
use contiguous ordinal ranges rather than increasing OFFSET scans. The same fast
path applies to full-viewport pages and whole-city cell pages only when source
bounds and located counts prove equivalence. Filtered pages preserve exact
ordinal OFFSET semantics.

`indexes.sql` is an optional measured change: a multi-column trigram GIN index,
dictionary trigram GIN index and spatial covering B-tree. It uses the already
available pg_trgm extension and concurrent index creation. Apply `api.sql` first.
Index installation changes storage/plans, not canonical records or fingerprints.
No speed claim follows from merely installing an index.

Profile uncached summary, page and combined HTTP separately. Include empty,
one-character, rare/common text, literal wildcards, small selected area, world
viewport, last page and maximum-zoom coincident/member cases. Repeat at least six
times to catch PL/pgSQL generic-plan changes as well as warm caches. Inspect
actual row counts, buffer reads, sort/temp work and index use with EXPLAIN
(ANALYZE,BUFFERS); plain EXPLAIN of the wrapper function hides nested work.
Short terms and broad matches can still scan. A deadline must return an explicit
error rather than approximate counts or partial success.

The parent authorized installation of the API functions, the spatial covering
index and ordinary post-load VACUUM. Function-local measured settings now avoid
JIT/parallel-plan overhead for summary and generic-plan regressions in selected
query functions. No GIN index has been applied. See [PROFILE.md](PROFILE.md) and
the parent adapter's evidence for the actual measurements and remaining limits.
