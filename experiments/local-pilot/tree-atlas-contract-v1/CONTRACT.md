# Tree Atlas search and release contract 1.0.0

Frozen locally on 2026-11-08. Contract ID: `tree-atlas-search-release-v1`.
This defines the pilot's catalogue interface for remote and complete offline
adapters. It does not implement an inventory API, import records into PostgreSQL,
or change the current application. The accepted test interfaces remain source
import, published catalogue and user journeys. Reference checks in this folder
cover the catalogue semantics and release evidence; future adapters must pass
them at those same public interfaces.

## 1. Pinned cohort

| Inventory | Release | Records | Located |
| --- | --- | ---: | ---: |
| London | london-316fa121a19059da | 1,111,784 | 1,111,784 |
| Vienna | vienna-2925984ab1dd6276 | 233,102 | 233,102 |
| Geneva | geneva-a3456b2d943dc57d | 240,827 | 240,827 |
| Porto | porto-6be0471b6c303ac2 | 71,634 | 71,634 |

Total: **1,657,347 records**. `baseline.lock.json` binds the existing app commit,
manifest, descriptor and provenance bytes. `evidence/source-asset-audit.json`
enumerates the stored assets, hashes and byte sizes. Neither a matching count nor
the 16-character release suffix alone establishes content equivalence.

These are published inventory partitions, not all physical trees in four cities.
London excludes the 24,265 `LB Camden` contributor rows from the 1,136,049-row
compilation; this pilot does not silently reintroduce that partition. Geneva is
canton-wide, not just municipal. Bounds are source extents, not administrative
coverage polygons. Source acquisition dates are not tree observation dates.
Keep the pinned attribution, coverage, source URL and licence evidence in every
release and offline pack. This freeze does not revalidate current upstream terms.

## 2. Identity, order and canonical records

Lookup identity is the tuple `(dataset, release, sourceId)`. Source IDs stay exact
strings, including leading zeros and punctuation. Display tags are not keys.
Do not split a composite source ID on colons. A detail lookup uses an exact ID,
not a normalized search. Return a missing-record result only within a valid,
available pinned release; release failure must not become `null` detail.

Preserve every canonical row exactly once, including coincident trees and
unlocated records. Do not deduplicate by coordinates, names or proximity. Preserve
per-record `idScope`; release-scoped IDs do not promise continuity across releases.
London/Vienna/Porto IDs are release-scoped. Geneva usually uses stable `ID_ARBRE`;
the repeated-ID exceptions have object-qualified release-scoped identities.

Persist the zero-based prepared ordinal from the pinned detail-shard sequence.
The legacy preparation uses JavaScript UTF-16 string comparison of source IDs.
Do not substitute numeric, SQL locale or species order. Ordinals are unique and
contiguous within a release. New source releases must publish their ordering
rule explicitly; preserving an existing release's ordinal takes precedence.

Canonical content includes position, nullable names/tag/location, identity scope,
measurements, planting information, age, observation date, status and quality
notes. Position is WGS84 `[longitude, latitude]`, two finite numbers or `null`.
Do not round coordinates during import. Keep measurement variants `unknown`,
`value`, `range`, `over` and their units; unknown is not zero, range is not a
midpoint, and age text is not a planting year. Preserve status; no implicit
existing-only filter. Source import rules and search normalization are different
versioned concepts. The legacy publications do not declare an authoritative
import-normalizer version; do not infer one from today's preparation script.

## 3. Text normalization and search membership

Search normalizer ID: `nfd-diacritic-unicode17-default-lower-trim-v1`.
In order: Unicode NFD; remove code points with Unicode 17.0 `Diacritic=Yes`;
Unicode default full lowercase with context, independent of user locale;
ECMAScript end trimming. Do not use NFKD, transliteration, general `Mn` removal,
case folding, SQL unaccent or locale collation as substitutes. Keep internal
spaces, punctuation, ligatures, variation selectors, `ß`, `ł` and dotless `ı`.
The reference runtime is pinned in the lock. A later Unicode version is a
contract change until equivalence is demonstrated and explicitly versioned.

Examples: ` İstanbul ` → `istanbul`, `Łódź` → `łodz`, `Straße` → `straße`,
`ΟΣ` → `ος`; `A  B` keeps two internal spaces. U+02B0 is removed as a diacritic;
U+FE0F remains. `reference/fixtures.json` contains literal expected cases.

Normalize both the query and each field separately. A row matches if the term
is a literal contiguous substring of at least one of `sourceId`, `tag`,
`scientificName`, `commonName`, `location`. Null fields cannot match. Empty
normalized query matches all rows. One-character queries work. No cross-field
concatenation, token AND/OR, fuzzy search or wildcard/regex interpretation.
`%`, `_`, backslash and quotes are literal data. SQL implementations must escape
LIKE metacharacters or use an equivalent literal operation. Do not search height,
dates or quality notes unless a later contract adds them.

Search is inventory text search. It does not geocode an address or landmark not
recorded in those fields. Any future geocoder is a separate, labelled operation;
it must not alter record membership or falsely report no matching trees.

Input limit is 500 UTF-16 code units before normalization, preserving the worker
limit. Reject malformed Unicode, invalid types or overlength input; do not
silently truncate service queries. Existing app URLs truncate to 160 code units:
this is a documented legacy UI limitation, not the new service rule. A future
client migration must preserve accepted saved links and reject/handle longer
input explicitly rather than silently change a request.

## 4. Spatial scope, pagination and suggestions

`area` is null or `[west,south,east,north]`. Coordinates are finite, within
[-180,180]/[-90,90], with west < east and south < north. Degenerate and
antimeridian-wrapping boxes are rejected in v1. Containment is inclusive on all
four edges. An area filter excludes unlocated rows. Without it, unlocated rows
remain searchable and count toward results.

`viewport` has the same validation but affects map selection/counts only, never
list membership. It is not an implicit area filter. `zoom` is finite in [0,24].
`offset` is a nonnegative safe integer; `limit` is an integer in [1,100]. No
implicit cap on the full match set. Return the exact total and the ordinal slice
`[offset, offset+limit)`. Offset at/past total yields an empty page with the same
exact total. The existing UI page size of 30 is not a service requirement.
Every page belongs to the same pinned release and normalized query.

Suggestions are inventory-wide, independent of area and viewport. Fewer than
two normalized UTF-16 units gives no suggestions. Visit dictionary values in
their prepared order: source ordinal, then tag/scientific/common/location, first
occurrence of each exact non-null string. Return the first eight raw distinct
values containing the normalized term. Normalization-equal original labels may
both appear. Source IDs are searchable but are not added to this dictionary.
This is the canonical dictionary rule for v1. The independent reader rebuilds
it from canonical records; it does not decode legacy binary dictionaries to
prove historical byte-for-byte suggestion-order equivalence.

## 5. Query result and map semantics

The frozen logical input is `{dataset, release, q, area, viewport, zoom, offset,
limit}`. Transport endpoints and attempt reservations do not define membership.
The logical result includes:

- `contractVersion`, `dataset`, `release`, `queryKey`, and the caller's `requestKey`;
- `total`: exact text-and-area match count, including eligible unlocated rows;
- `locatedTotal`: located members of that same match set;
- `viewportLocatedTotal`: located members additionally inside viewport;
- `items`: the requested ordinal page of summaries;
- `markers`, `representedLocatedCount`, and `mapAggregated`.

Counts and offsets are nonnegative safe integers. `representedLocatedCount`
does not include unlocated rows. Page summaries include the exact source ID,
dataset and canonical position/name/tag/location fields; release is inherited
from the required response envelope, not inferred from the active catalogue.

`queryKey` is SHA-256 of UTF-8 JSON for the array
`["tree-atlas-search-release-v1",dataset,release,normalizedQ,area,viewport,zoom,offset,limit]`.
Encode finite numbers with ECMAScript JSON number serialization, normalize -0
to 0, and use no extra whitespace. This is a cache/correlation key, not an
authorization capability. Bind the release fingerprint separately. A response
must echo the exact key and request key; clients discard older requests after a
city, query or release change, including successful cancellation races.

Markers come from the full located match set, never the list page. At most
1,000 marker objects are returned; aggregate or report an explicit density
error, never drop records silently. Tree markers have exact release-qualified
identity; clusters have opaque handles scoped to release/query/viewport and
report expansion zoom or a paged exact member-list operation at maximum zoom.
Coincident trees remain separately reachable through that member list.

Preserve the legacy distinction: clusters may represent members beyond the
viewport when their display position lies inside it. `representedLocatedCount`
is the exact union of the returned markers' member IDs; each represented member
must match text/area, be located, and appear once. It can differ from the exact
point-in-rectangle `viewportLocatedTotal`. Never label cluster count as an exact
visible-tree count. Every exact in-viewport match must be reachable by the
viewport-results page operation using the same predicate, even if aggregation
places its cluster center outside the viewport. This operation is just ordinal
paging over the viewport-filtered located match set, not a new fuzzy search.
Marker positions, clustering pixels, numeric cluster IDs and exact grouping are
not frozen; counts, membership and click access are. The independent oracle
checks exact viewport sets; future adapter checks expand marker memberships.

## 6. Readiness, errors and detail

Complete query success means both list and map work completed against one
release. The pilot retains combined completion; measure the list and aggregation
costs separately without declaring the full request complete early. A local
bootstrap may show complete text results while geometry is pending, but must
label spatial readiness false and positions pending. Pending coordinates are
not unknown coordinates, and zero markers are not evidence of zero located
trees. Area queries wait or return an explicit not-ready state until geometry
is complete. Complete offline packs never advertise ready with pending geometry.

Invalid input, unsupported contract, missing pinned release, hash mismatch,
not-ready geometry, overload, deadline and cancellation are distinct errors.
None becomes an empty or partial successful result. Missing release never
silently falls back to latest. Cancel is best effort; the latest-request guard
is still mandatory. C1's local reset/deadline/token handling remains transport
evidence, not a proof of this future inventory contract.

## 7. Immutable release publication

New release metadata must bind: contract/search-normalizer/import-normalizer
versions; source identity, checksums, CRS and acquisition evidence; coverage,
licence and attribution; full canonical content and ordered-ID digests; row,
located and unlocated counts; ordinal rule; every required asset's path, stored
byte count, SHA-256 and encoding; detail availability; offline pack compatibility.
Distinguish upstream count, retained partition and rejected rows, with reasons.
No unlocated record may vanish because the map cannot draw it.

Lifecycle: acquire → validate → immutable staging → full conformance → verify
all assets/database visibility → ready → catalogue compare-and-swap last.
Only one expected predecessor may advance the catalogue; concurrent losers
cannot overwrite a newer pointer. Readers pin one catalogue/release snapshot.
An interrupted refresh keeps the last ready catalogue. Re-importing identical
payload is idempotent; any differing content under the same identity is rejected.
Do not mutate or delete an advertised pilot release, including after refresh.
Saved links stay pinned. Rollback moves the catalogue pointer, not release bytes.
Monthly acquisition is an intended schedule, not proof a release changed; source
deletions are release differences, not in-place destruction of the old snapshot.

Legacy baseline IDs remain aliases of their exact locked assets and derived
canonical fingerprints. Backend metadata may describe those bytes; it must not
rewrite the legacy public descriptors. A newly normalized payload needs a new
release identity and versioned compatibility evidence.

## 8. Complete offline support

Offline support is required future work, not implemented by the current cache.
A city pack pins one dataset/release/contract and contains the complete searchable
summary set, exact geometry, ordinal/suggestion data and compatible app shell.
Every record remains searchable offline, including records without locations.
Area filtering and map selection use the same predicates and counts as online.
Only explicitly saved full details are guaranteed offline. An unsaved detail
reports unavailable offline, not a missing tree or fabricated data.

Show required stored bytes before download; reserve/check space and verify every
asset before activation. Download into staging and commit a ready pointer only
after complete verification. Interrupted, cancelled, mixed-release or corrupt
packs never become ready. Preserve the previous complete pack on update failure.
Quota denial, browser eviction and incompatible app versions require an explicit
not-ready/re-download state. Never silently label an evicted pack complete.
Source/attribution/licence evidence travels with the pack. Basemap imagery is
separate: do not promise offline street tiles or bulk-download OSM tiles.

Online and offline parity is evaluated for the same pinned release, not against
whichever release happens to be latest. A new online catalogue cannot overwrite
an offline pin. The current evictable 32 MiB verified cache is not a city pack.

## 9. Reference checks and acceptance

Hand-authored literal fixtures cover normalization, field boundaries, leading
zeros, literal punctuation, nulls, status, inclusive spatial edges, coincident
trees, pagination and suggestion order. Mutation sentinels must reject plausible
wrong semantics. The standalone reference code imports no application functions,
SQL, adapters or packed-index codecs. It reads canonical detail JSON directly.

For each locked release, independently enumerate every canonical row in ordinal
order, verify shard hashes/identities/counts and compute complete ordered-ID and
content digests. Reference query cases retain exact counts, ordered ID digests
and page evidence. The source-asset audit separately verifies all stored map,
index, geometry, detail and metadata assets. Neither audit proves upstream data
completeness, raw-source correctness or physical-tree coverage.

Digest encoding is fixed. Each identity line is compact UTF-8 JSON for
`[dataset,release,sourceId]` followed by LF. Hash the complete ordered stream
with SHA-256. Each content line is compact UTF-8 JSON for
`[ordinal,dataset,sourceId,idScope,position,tag,scientificName,commonName,location,height,crown,circumference,plantingYear,plantingEstimated,age,observedAt,status,qualityNotes]`
followed by LF. Recursively sort object keys by UTF-16 code-unit order before
serialization; preserve array order. An absent optional `qualityNotes` is null
in this semantic digest; raw asset hashes still bind exact original bytes.
Use ECMAScript JSON string/number serialization. The same framing defines query
membership and viewport membership digests; never hash an unordered SQL set.

`lifecycle-cases.json` records literal expected outcomes for publication races,
immutable collisions, missing pins, offline interruption/eviction/quota, saved
details and stale responses. These are future adapter/browser acceptance cases,
not executed state-machine or offline implementation tests.

Future adapters must enumerate all empty-query pages exactly once, reconcile
ordered membership/content and compare full matching sets for the frozen corpus.
Counts alone do not pass. Compare viewport sets separately from cluster unions;
expand clusters to validate count/membership/click access. Run the same suite
against remote and complete-offline adapters, with interrupted publication,
stale response, missing release, failed download and airplane-mode journeys.
Full PostgreSQL/PostGIS and browser conformance remain NOT RUN in this freeze.

Version policy: membership, normalization, identity/order, count scope, errors,
release selection and offline completeness changes require a new contract major
version or explicitly additive compatible revision. Regenerating expected values
from a candidate implementation is not review. The freeze manifest hashes the
contract, lock, literal fixtures, reference code, results and review record.
