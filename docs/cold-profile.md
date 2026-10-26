# Cold map profile

The complete search index blocks the first inventory map. Reduce that dependency before tuning React renders.

## Baseline

Measured production revision `63a438d` on 26 October 2026. One cold Vienna → Geneva → Vienna sequence:

| Phase                                       | Vienna cold | Geneva first switch |
| ------------------------------------------- | ----------: | ------------------: |
| Map and complete search ready               |   14,370 ms |           11,324 ms |
| Compressed index response body              |    9,972 ms |            9,361 ms |
| Index inflate                               |       46 ms |               31 ms |
| Decode and schema validation                |      465 ms |              499 ms |
| Identity validation                         |       61 ms |               55 ms |
| Search preparation                          |       51 ms |               62 ms |
| Initial cluster build                       |      487 ms |              369 ms |
| React render duration, all measured commits |       91 ms |               22 ms |

The return to Vienna took 984 ms and transferred no inventory bytes. Vienna's decode and validation includes 116 ms of JSON decoding and parsing. Geneva uses the column encoding. These timings are not additive: some work overlaps, and the table omits startup, query processing, messaging and paint.

## Decision

Publish a small, release-bound spatial catalogue. Fetch bounded leaves for the visible map. Each leaf carries tree details, so a visitor can select a tree before the full search index arrives. Load the complete search index after the initial map is available. State explicitly when complete search is still preparing.

A small overview alone would shorten the first picture, but would leave individual tree selection blocked. It does not meet the requirement. Keep the complete index for global search, including records with no coordinates. Never present the visible spatial subset as complete search results.

Validate the catalogue release, counts and bounds. Verify every downloaded asset hash. Bound leaf retention and concurrent requests. Cancel obsolete viewport work. Aggregate excess markers instead of dropping records.

## Reproduce and limits

Run `node scripts/profile-cold.mjs`. The script copies sources into an ignored temporary directory, adds phase timers, and builds a production profiling bundle. It does not change the deployed entry point. The default report is `.tmp/cold-profile-baseline.json`. Use `COLD_PROFILE_RUNS`, `COLD_PROFILE_CITIES` and `COLD_PROFILE_OUTPUT` to select repetitions, cities and output.

The baseline uses Chromium 156, a 390 × 844 viewport, touch emulation, device scale 2, page CPU slowdown 4, 100 ms server delay and 500,000 bytes per second per response. Worker CPU is not throttled. Bandwidth is per response, not a shared mobile radio budget. External basemap tiles are blocked. JavaScript and CSS are not HTTP compressed. Each repetition has a new browser context; return visits can use browser caches. This is a diagnostic desktop simulation, not a physical phone result or a statistical performance claim.

React profiling adds overhead. Its render duration excludes Leaflet effects and browser paint. The observed render cost does not justify React memoization as the first cold-load fix. See the [React Profiler documentation](https://react.dev/reference/react/Profiler).

The app already enables Strict Mode. Keep it: its extra development checks help reveal missing cleanup and impure rendering. Those checks do not run in production. See [React Strict Mode](https://react.dev/reference/react/StrictMode).

Measure first usable map separately from complete search readiness in the follow-up comparison. Include a click on a visible tree while the full index is delayed, a rapid city switch, cancellation, and a search for a record outside the initial viewport.

## Follow-up measurements — 27 October 2026

Three production runs used the same 390 × 844 emulation, 4× page CPU slowdown, 100 ms server delay and 500,000 bytes/second per response. Each run started with an empty browser context. The sequence was Vienna, Geneva, London, then Vienna again. These measurements use the ordinary production bundle, without React Profiler overhead.

| Journey                  | First map, median (range) | Complete search, median | Bytes served before first map |
| ------------------------ | ------------------------: | ----------------------: | ----------------------------: |
| Vienna, cold application |        2.87 s (2.86–3.04) |                 15.17 s |                       754,837 |
| Geneva, first switch     |        0.69 s (0.62–0.69) |                 11.85 s |                       102,259 |
| London, first switch     |        1.65 s (1.60–1.70) |                 48.91 s |                       456,943 |
| Vienna, return           |        0.25 s (0.20–0.31) |                  1.61 s |                             0 |

The baseline Vienna map waited about 14.37 seconds for complete search. The new path displays map aggregates about 80% earlier in this diagnostic comparison. Complete search is slightly later because map data takes priority. London shows the remaining cost clearly: a usable early map does not make a million-record search index small.

“First map” means the correct city's non-empty markers have rendered and the map is no longer busy. It does not mean a specific individual tree has been selected. A separate browser regression holds the complete index indefinitely, opens a known tree with a real canvas click, and verifies its details before releasing that download. Search stays visibly pending throughout.

One short publication-test run overlapped part of the third repetition. Treat the ranges as diagnostic observations, not controlled statistical results. The first two repetitions had no competing browser tests. Workers are not CPU-throttled, bandwidth is per response rather than shared, and external tiles are blocked. Real-phone and shared-bandwidth testing remain useful next measurements.

Reproduce with `pnpm build`, then `node scripts/mobile-benchmark.mjs`. Set `MOBILE_BENCH_CITIES=vienna,geneva,london`, `MOBILE_BENCH_RUNS=3` and `MOBILE_BENCH_OUTPUT` to choose the output file. The runner records first-map and complete-search times separately. Background cache writes no longer block either display path; their queue is bounded.
