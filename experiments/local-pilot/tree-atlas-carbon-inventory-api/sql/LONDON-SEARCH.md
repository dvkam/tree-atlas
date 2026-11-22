# London search deadline investigation, 19 November 2026

The fresh branch checks reproduced 504 responses for London's `one-character`
(`a`) and `rare-genus` (`torreya`) cases under the unchanged 2,500 ms SQL-work
budget. A later quick run also exposed the one-character filtered midpoint page
at offset 555,892. The result set was not reduced and the deadline was not raised.

## Observed work

The old summary separately scanned matching records for full counts and for
viewport groups. The page operation scanned again. Even the zero-result London
query therefore performed two summary scans and another page scan.

Initial direct SQL observations, in fresh PostgreSQL sessions with uncontrolled
OS/database caches:

| Case | Original summary | Original first page |
| --- | ---: | ---: |
| London `a` | 1,798 ms | 11 ms |
| London `torreya` | 1,244 ms | 703 ms |

These are individual phase observations, not latency percentiles. A separate
first Porto no-match observation took 2,976 ms and read about 17,885 heap blocks;
its repeat took 88 ms. This established that reading wide canonical heap rows
was also an I/O risk, even for a small inventory. No global cache flush was used.

## Changes

1. The summary scans the matching narrow projection once. Visible cells supply
   markers; a private `-1` bucket retains unlocated and outside-viewport matches
   in the exact full totals without displaying them. Global empty-query totals
   still use the immutable validated metadata, retaining the existing spatial
   covering-index path for the viewport.
2. The native query adapter does not execute the page SQL when the exact summary
   proves `offset >= total`, including zero-result queries. It still checks
   cancellation and the deadline before returning. A valid empty page remains a
   complete successful page; missing releases and errors are not hidden.
3. A covering B-tree holds the query projection:
   `(dataset,release,ordinal) INCLUDE(lon,lat,search_id,search_tag,search_scientific,search_common,search_location)`.
   It avoids reading canonical JSON merely to test membership. The inspected
   Porto plan used `inventory_search_cover`, zero heap fetches and about 1,172
   initial index-page reads instead of the earlier wide heap scan.
4. Filtered list, viewport and cluster-member pages materialize only the selected
   identities/ordinals, then fetch canonical JSON for those requested records.
   This prevents a deep OFFSET from loading the canonical JSON of every skipped
   record. Ordering, literal matching, counts, missing positions and statuses
   remain the frozen contract's rules.

The new search index occupies **262,094,848 bytes**. Total database size was
about **2.00 GB** afterwards, excluding WAL/temp/backup peaks. The measured
normalized projection was at most 173 bytes before installation. The installer
checks validity/readiness, relation, method, exact key/include columns, predicate
and expressions; it refuses an invalid or differently defined existing index.
Ordinary VACUUM/ANALYZE maintains visibility/statistics without changing records.

## Measurement and regression checks

After the single summary scan, before the search-cover index, direct summary
observations were about 1,000 ms for `a` and 612 ms for `torreya`. With the narrow
cover, valid once-per-phase measurements observed `a` at 771 to 1,045 ms and
`torreya` at 409 to 427 ms. The absent page is now skipped entirely for `torreya`.
These are small local observations, not cold-database or hosted guarantees.

An intermediate compact profiler mistakenly projected three fields from a
STABLE function subquery; PostgreSQL could inline and execute that function three
times. `profile_search.py` now uses a MATERIALIZED measurement wrapper so each
phase is called once. That intermediate run is not a valid speed comparison.

New local `/stats` counters record query-summary/page SQL call counts and
aggregate microseconds, plus aggregate pool wait. They contain no query text,
record identifiers or locations. They are diagnostics, not public authentication
or per-request tracing; concurrent callers share the aggregate counters.

Meaningful checks added:

- Five literal temporary-record SQL cases run the actual summary implementation,
  substituting only temporary data/metadata providers. They cover unlocated,
  outside-viewport, explicit area, removed/coincident, empty-global and no-match
  count behavior. No persistent object or canonical row is changed.
- The index-definition validator rejects unready/invalid, wrong-table,
  wrong-column/key, partial, expression, unique and wrong-method definitions.
- HTTP regressions inspect diagnostic call deltas to prove exact empty/out-of-
  range pages skip page SQL, while an existing last record still fetches it.
- Seven distinct uncached summary keys per London term must return the exact
  frozen first-page IDs and full/located/viewport totals under the existing
  server deadline. Varying fractional zoom changes the summary cache key without
  changing the list predicate; this does not substitute cached successes.
- The existing 192 selected-page conformance checks include the deep filtered
  midpoint that exposed the remaining wide-heap page scan.

The revised quick HTTP run passed all 48 frozen cases/192 selected pages, 16
suggestions, eight details and sampled member/viewport checks in 17.8 seconds.
The HTTP regression invocation ran 24 tests successfully with four opt-in lock
faults skipped; all 14 uncached London attempts passed. Full HTTP enumeration
and later clean-room/offline results are separate parent-run evidence.

## Install and rerun

From this inventory API directory in WSL, after the staging database exists:

```sh
sudo python3 tools/install_sql.py
sudo python3 sql/apply_spatial_index.py
sudo python3 sql/apply_search_index.py
python3 tools/build.py
sudo python3 sql/test_summary_counts.py
python3 sql/test_search_index.py
python3 -m unittest discover -s tests -v
```

Use `sudo python3 sql/profile_search.py --label current --repeat 3` for read-only
phase comparisons. Its queries run as the restricted reader. Do not profile
alongside imports, lock faults, dumps, builds or other heavy work. The installer
is idempotent and refuses a conflicting index rather than dropping it.

The previous source-control import omitted `.sql` files. This follow-up restores
the API SQL/install/profile sources; the staging schema is restored by the
clean-setup work. The old optional trigram candidate is retained as a candidate,
not installed or required by this fix. No canonical records, immutable release
fingerprints, public application files or deployment workflow changed.
