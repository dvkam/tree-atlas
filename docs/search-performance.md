# Complete search before exact map filtering

London has 1,111,784 published records. The previous client downloaded every coordinate before it could search a species name or tree ID. The compressed index was 15,821,942 bytes. Coordinates accounted for about 13.03 MB; the compressed ID and dictionary header accounted for about 2.42 MB. Most of this transfer was unnecessary for a text query.

## Options checked

| Option                                   | Measured result or constraint                                                                                                                                                                                                      | Decision                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stronger lossless compression            | Brotli quality 6 reduced the old index to 14,112,418 bytes, about 11%. Native Brotli streams are not supported in Chrome in the checked compatibility data.                                                                        | Do not add a decompression dependency for this small gain.                                            |
| Reorder exact coordinate byte planes     | Sorting by longitude increased the experimental compressed size to 18,585,413 bytes, even before accounting for reordered IDs. Decimal longitude text alone used 9,549,142 bytes, compared with 7,048,709 bytes for binary planes. | Keep the existing lossless coordinate format.                                                         |
| Complete text index, then exact geometry | Final text is 2,784,317 bytes. Geometry is 13,034,179 bytes. Combined size is 15,818,496 bytes, slightly below the previous index.                                                                                                 | Use this split. Initial search-index transfer falls by 82.4%.                                         |
| Server search or indexed query shards    | Can avoid downloading all coordinates, but introduces a service or a new query planner, deployment and failure boundaries.                                                                                                         | Consider when full geometry transfer is no longer acceptable. This change does not require a backend. |

Compression measurements use the same published London rows and gzip level 9. No coordinate is rounded. Size reduction is not a claim about elapsed browser time. See the browser measurements below when available.

The final `text-columns-v1` encoding removes the unused coordinate planes. Its compressed text asset is 2,784,317 bytes, and its decoded payload falls from 50,097,894 to 32,309,350 bytes. Combined with exact geometry, this is 15,818,496 bytes: slightly below the former combined index. Initial search-index transfer falls by 82.4%.

## Decode review

An intermediate production profile on London measured 6.93 seconds for text transfer, 3.30 seconds for column decoding and schema validation, 1.78 seconds for identity checks, and 0.32 seconds for ID normalization. React rendering across all measured commits took 185 ms. This justified a decoder change rather than React memoization.

The text decoder now checks integer values as it reads them and constructs absent coordinate fields directly. Header strings and IDs still pass runtime validation. The public loader still checks unique identities, dictionary references, shard membership, hashes and release metadata. It does not clone a million already validated rows through a second schema pass.

Three local Node runs on all London rows measured the previous text decoder at 2,182 / 1,746 / 2,021 ms and the new decoder at 534 / 527 / 508 ms. Garbage collection ran before each sample. These are decoder measurements, not browser loading times. Final production measurements must use the same city-switch sequence as the previous report before claiming an end-to-end percentage improvement.

The Brotli support check uses [MDN's browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/DecompressionStream.json). HTTP Brotli support does not imply that JavaScript can decode a stored Brotli asset through `DecompressionStream`.

## Behaviour and publication contract

Descriptor version 3 contains a complete text index, a separate exact geometry asset, and detail shards. It does not retain a duplicate combined index. Version 2 releases remain readable.

The worker verifies and loads all text records first. IDs, species, street labels, result totals and suggestions cover the complete inventory. A query is never limited to downloaded map tiles and does not fetch detail shards. Before geometry is ready, summaries carry an explicit `positionPending` flag. The list does not display coordinates. Selecting a record loads its exact detail shard; a coordinate that has not loaded is never presented as an unlocated tree. A failed detail download affects that selection, not complete text search.

Exact area queries wait for the complete geometry asset. The interface shows a pending state without a partial count. Until geometry is ready, the map uses its spatial catalogue and states that its trees are unfiltered. A completion event refreshes the query and transfers map control to exact filtered results.

Geometry is verified against its hash, row count, coordinate pairing, bounds and located count before it changes active search rows. A geometry failure leaves complete text search available and offers a retry. A city change closes the worker and cancels its transfer. Detail retention remains bounded.

The initial split does not reduce the eventual geometry download. Broad exact map filtering still waits for those bytes. This is an explicit product state, not a hidden restriction on searchable records.

## Verification

`tests/split-search.test.ts` holds geometry behind a gate and verifies that a record outside the initial viewport remains searchable, suggestions cover it, and its exact details load. It then releases geometry and checks exact area membership. Other cases cover failed geometry and session cancellation. Existing inventory and publication tests check version 2 compatibility and immutable release publication.

Use `scripts/mobile-benchmark.mjs` for the production browser comparison. Keep first usable map, complete text search and exact map filtering as separate measurements. Network simulation is diagnostic; it is not a physical phone measurement.

Browser tests run the production preview server. Run `pnpm build` before `pnpm test:e2e`; CI uses this order. The development watcher excludes raw acquisitions and immutable published data. Reload the page after replacing the manifest during local data preparation.

## Review rounds

The Pocock standards review found that automatically fetching details for each result page delayed complete text search and could multiply requests during rapid typing. Queries now perform no detail I/O. A browser regression rejects all detail downloads and verifies that repeated text searches still work.

The separate specification review found that changing the query could briefly restore an early map detail after the exact index had checked it. Detail ownership now stays with the exact index after handoff. Area queries remain disabled until geometry resolves, so panning during the download does not queue obsolete searches. Version 2 releases emit the same readiness event.

The Pstack comparison favoured the split index over a new backend for this change: it removes the largest dependency from text search without introducing a service. The eventual coordinate transfer and worker memory remain costs. Rebuilding the search engine at geometry handoff also retains temporary buffers; further work should measure peak worker memory on representative phones before changing that path.

Independent reviews used the available model in separate review roles. They are not claims of review by other model providers.

## Final production comparison

Three fresh browser contexts used the same Vienna → Geneva → London → Vienna sequence as the [previous report](cold-profile.md). The production bundle ran at 390 × 844, with 4× page CPU slowdown, 100 ms request delay and 500,000 bytes per second per response. Workers were not CPU-throttled. External map imagery was blocked. Preparation, tests and Git data processing had finished before these runs.

| London milestone       | Previous median | New median |     New range |
| ---------------------- | --------------: | ---------: | ------------: |
| First usable map       |          1.65 s |     1.57 s |   1.56–1.58 s |
| All-record text search |         48.91 s |    11.71 s | 11.68–11.72 s |
| Exact map filtering    |         48.91 s |    47.06 s | 47.01–47.47 s |

Complete text search is available 76.1% sooner in this comparison. The early map remains fast. Exact spatial filtering still waits for the large coordinate transfer and its index; this change does not remove that cost. Before geometry is ready, map markers are explicitly unfiltered.

For context, Vienna's cold application reached its map at 3.09 s and complete search at 15.44 s, compared with 2.87 s and 15.17 s previously. Geneva's first switch reached its map at 0.60 s and complete search at 12.28 s, compared with 0.69 s and 11.85 s. These unchanged combined-index releases do not receive the London transfer reduction. The three runs do not establish that these small differences are statistically significant.

The [raw measurement report](search-performance-results.json) records each run, bytes, requests and method limitations. It excludes local workspace paths. Desktop mobile emulation is not a physical-phone result. Per-response bandwidth does not model a shared mobile radio, and page heap measurements exclude workers. The measurements cover first inventory loads in an already-open app for Geneva and London; Vienna includes cold application startup.

All 170 unit and conformance tests and 19 production Chromium journeys passed before this measurement. Strict Mode remains enabled for development; the measured bundle uses production React without profiling overhead.
