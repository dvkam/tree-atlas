# Full-inventory engine benchmark

The app searches complete published inventories: **233,102 Vienna records, 240,827 Geneva records and 71,634 Porto records**. It downloads a compact city index first, builds the search and clustering index in a worker, and fetches tree details in small shards when requested.

Run the benchmark from the repository root:

```sh
pnpm exec tsx scripts/benchmark.ts
```

For a garbage-collection pass before each dataset measurement:

```sh
pnpm exec node --expose-gc --import tsx scripts/benchmark.ts
```

The script reads the current published manifest and uses the same `loadInventory` interface as the worker. MSW answers requests from local files; it does not start a server or contact external services. The `.bin` assets contain gzip-compressed JSON. The engine verifies their stored-byte hashes before decompressing them.

The script refuses to report success if the full query count differs from the catalogue, a world-view cluster loses or duplicates records, the marker count exceeds 1,000, a selected record cannot be loaded, or a compressed asset reaches 100 MiB. It measures five cached queries and reports their median. The nearby query uses a 0.02° × 0.02° box around the dataset's measured centre; it is not a fixed-distance radius.

## One desktop measurement

Recorded **26 October 2026, 21:37:53 UTC**, Windows x64, Node **24.19.0**, with the second command above. These are observed engine timings on one machine, not performance guarantees.

| Dataset | Load and validate | First full query | Cached median, five queries | Nearby query | Nearby records | First detail |
| ------- | ----------------: | ---------------: | --------------------------: | -----------: | -------------: | -----------: |
| Vienna  |            820 ms |           427 ms |                     0.34 ms |        21 ms |          3,360 |        16 ms |
| Geneva  |            828 ms |           546 ms |                     0.09 ms |        20 ms |          3,672 |        11 ms |
| Porto   |            240 ms |           127 ms |                     0.02 ms |         9 ms |          3,605 |        13 ms |

Loading includes local file reads through MSW, hash verification, gzip decompression, JSON parsing and schema validation. The first full query includes building the clustering index. Cached measurements repeat the same full query; a changed text or area filter may rebuild that index. The nearby query is a changed-area query, so its time includes filtering and rebuilding clusters for that area.

World views produced 28, 20 and 2 markers respectively, with their individual and clustered counts summing to the complete inventory count. Nearby views produced 129, 112 and 105 markers. Each measured session made three requests: the descriptor, the compact index and one detail shard.

| Dataset | Compressed index bytes | Detail shards | All compressed inventory bytes | Bytes requested by this benchmark |
| ------- | ---------------------: | ------------: | -----------------------------: | --------------------------------: |
| Vienna  |              4,025,362 |           456 |                     12,352,543 |                         4,110,751 |
| Geneva  |              5,170,978 |           471 |                     12,627,944 |                         5,255,521 |
| Porto   |              1,368,146 |           140 |                      3,325,434 |                         1,402,729 |

The largest compressed asset is Geneva's approximately 5.17 MB index. The complete detail set is not downloaded when opening a city. Total compressed sizes omit descriptors, attribution and reports. The recorded releases are `vienna-48cade6b5cfba9ce`, `geneva-0e78b7755592354c` and `porto-cf3a80e876ac8824`.

## Memory and limits of this measurement

The observed JavaScript heap changes were **190.82 MiB for Vienna, 146.85 MiB for Geneva and 46.05 MiB for Porto**. Baselines were 18.75, 89.66 and 160.19 MiB respectively. The script runs datasets in one process; garbage collection and earlier allocations affect these readings even when an explicit collection is available. These changes are neither peak-memory measurements nor isolated retained-memory estimates. The JSON output includes the baseline and whether explicit collection was available so runs are not compared without that context.

This memory use requires testing on real mobile devices. Moving work to a worker avoids doing that work on the page's main thread, but does not remove its memory cost. A fast cached engine query does not prove that map rendering, city switching or initial loading feels fast on a phone.

The benchmark excludes network latency, download throughput, HTTP cache behavior, worker startup, message serialization, React rendering, Leaflet rendering, basemap requests and browser-specific memory limits. It is useful for catching engine regressions with the actual inventories. It cannot establish a browser responsiveness or mobile performance claim.

Before extending this approach to much larger inventories, measure cold browser loads and interactions on representative phones. If full indexes exceed acceptable download or memory budgets, use spatially partitioned indexes or a hosted search service rather than loading progressively larger indexes into each client.
