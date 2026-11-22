# Local summary profiling findings

These are SQL measurements against the real validated pilot, not browser or
hosted performance evidence. Fresh sessions mean new PostgreSQL backends; OS
and database caches were not reset. Some final nested-plan captures overlapped
the timing sampler, so the earliest final sample is not an isolated benchmark.

## Observed mechanism

Initial London summaries took about 2,004–2,399 ms on new backends with JIT
enabled, and about 1,702–1,738 ms on following calls. JIT-disabled samples were
about 1,651–1,737 ms. Vienna was about 282–317 ms fresh and 240–263 ms warm.

Nested auto_explain identified work hidden by EXPLAIN of the wrapper function:

- London scanned roughly 1.16 GB of heap buffers and spilled an approximately
  80.5 MB external sort. The planner expected hundreds of thousands of grid
  groups, while the actual result had 596.
- A Gather Merge plan expected two parallel workers but launched zero inside
  the function execution. Session-only serial plans avoided this overhead.
- London JIT generation/inlining/optimization/emission added about 262 ms in
  the captured plan. This is startup overhead rather than useful compilation
  amortized over a long batch.

## Applied changes

Only the summary function disables JIT and parallel workers locally. The server
configuration is unchanged. A 128,090,112-byte covering index on
`(dataset,release,lon,lat,ordinal)` was built concurrently and checked valid.

The first index-only plan still fetched every Vienna heap tuple because the
newly loaded table's visibility map had not been populated. Ordinary post-load
VACUUM (ANALYZE), not VACUUM FULL, allowed true index-only reads: Vienna went
from 233,102 heap fetches to zero; the captured London plan needed two heap
fetches instead of touching every matching heap row.

The sixth-call test found a second issue that a short benchmark would miss:
PL/pgSQL switched to a generic plan. London increased from about 1.1–1.3 seconds
to 5.2–6.1 seconds; Vienna increased from about 335–359 ms to 1.2–1.3 seconds.
The summary and parameter-sensitive filtered page/member/suggestion functions
now use function-local `plan_cache_mode=force_custom_plan`.

After these corrections, two seven-call sessions retained stable output:

| Inventory | Observed SQL summary times |
| --- | --- |
| Vienna | about 120–168 ms for most final calls; earliest overlapping sample 605 ms |
| London | about 891–1,160 ms across first through seventh calls |

London still has an approximately 45.8 MB aggregate sort spill. Its final
captured plan used the covering index and no JIT; further grouping changes
remain a measured optimization opportunity rather than a claim of optimality.

`require_release` now builds only the counts, fingerprints and metadata needed
by the API. It does not serialize the large `source.descriptor` on every small
page. `release_info` already omitted that descriptor publicly, so its public
metadata shape is unchanged. Per-page end-to-end gains need separate timing;
the summary measurements above do not isolate that change.

## Reproducible evidence

- `evidence/sql-summary-profile.json`: original JIT on/off fresh/warm samples.
- `evidence/sql-planner-profile.json`: session-only planner counterfactuals.
- `evidence/sql-summary-profile-after.json`: captures the sixth-call regression.
- `evidence/sql-summary-profile-final.json`: corrected seven-call sessions.
- `evidence/sql-nested-*.log`: actual nested plans, buffer/temp work and JIT.
- `evidence/spatial-index.json`: index validity and bytes.
- `evidence/post-load-vacuum.log`: ordinary visibility/statistics maintenance.

No canonical row, source identity, ordinal, normalized field or release metadata
was changed. No GIN indexes were applied during this profiling round. Text and
deep filtered-page costs still need their own measurements; a fast empty-query
summary does not prove the entire frozen corpus meets the HTTP deadline.
