# Porto search timeout review

Reviewed locally on 8 November 2026. This is a read-only diagnosis, not a SQL change or a performance acceptance result.

## Reported failure

The first browser run received HTTP 504 after about **2,518 ms** for the Porto search below. The service has a 2,500 ms absolute query deadline. The browser failure was reported by the browser review agent; this review did not independently reproduce that failed response. See the browser test output and retained trace for the first offline journey.

```json
{
  "contractVersion": "1.0.0",
  "dataset": "porto",
  "release": "porto-6be0471b6c303ac2",
  "q": "0007",
  "area": null,
  "viewport": [-8.697566986083986, 41.12152148675267, -8.548221588134767, 41.204489413961504],
  "zoom": 13,
  "offset": 0,
  "limit": 30
}
```

The browser uses its own fresh request key. The diagnostic calls used a diagnostic request key and a separately reserved attempt token per call.

## HTTP repeat checks

Three sequential requests through the same local preview proxy (`http://127.0.0.1:4199/api`) returned HTTP 200, exact total **5**, and all **5** page items:

| Repeat | Elapsed time |
| ------ | -----------: |
| 1      |     74.24 ms |
| 2      |     53.30 ms |
| 3      |     65.45 ms |

Times include reserving a fresh attempt token and receiving the query response. These samples used the existing API process and warm or uncontrolled database and operating-system caches. They are not cold-start measurements. The summary may already have been cached.

## PostgreSQL checks

A fresh reader connection ran `EXPLAIN (ANALYZE, BUFFERS, SETTINGS)` for the equivalent page SELECT, then the actual `atlas_api.page` and `atlas_api.summary` functions with the same frozen request. Credentials were loaded from the private WSL reader configuration and were not printed.

| Check                  | Execution time |
| ---------------------- | -------------: |
| Equivalent page SELECT |     108.342 ms |
| `atlas_api.page`       |      83.959 ms |
| `atlas_api.summary`    |     134.864 ms |

The page plan used a bitmap index scan on `records_dataset_release_ordinal_key`, then a bitmap heap scan, a validated-release join, and an ordinal sort. It tested **71,634** Porto records and retained **5**, visiting **16,806** heap blocks. Its estimated total cost was about **12,002**. JIT was enabled with a cost threshold of **100,000**; the observed page plan did not compile JIT code. The page function and summary function were inspected as function calls, so their inner plans are not shown by those two outer EXPLAIN results.

The equivalent SELECT reported 5,040 shared-buffer hits and 12,700 reads. The page function reported 4,267 hits and 13,788 reads. The summary function reported 70,440 hits and 18,054 reads. Reads can be served by the operating-system cache; these numbers do not establish physical disk latency.

Only a session-local statement timeout was set for this diagnostic connection. No persistent settings, SQL functions, indexes, data, or permissions were changed.

## Finding and next step

The timeout was **not reproducible in these repeat checks**. Its cause remains **unconfirmed**. The initial browser run overlapped repository verification work, and other WSL work was observed. Those observations do not establish the cause.

Do not increase the deadline or change SQL on the strength of this one failure. If a controlled fresh-process repeat fails, capture phase times for connection acquisition, summary-cache wait/build, and page execution. Correlate those times with database waits and host contention. Keep the original failed observation in the evidence even if the later browser run passes.

No more profiling was run while the separate 50-sample browser loading run was in progress.
