# Mobile-like loading and switching measurements

Lossless index compression reduced first-switch readiness by about 24% for Geneva and Porto in this setup. Vienna cold loading was essentially unchanged, and returning to Vienna remained about one second. Every source record remains searchable. The new inventories are measured separately below; they have no previous-version baseline.

This is desktop Chromium emulation, not a physical-phone certification. The benchmark measures the production build with a 390 × 844 touch viewport, four-times slower page CPU, and a local server that delays responses by 100 ms and streams each response at 500,000 bytes/second (4 Mbps). The per-response limit is not a shared cellular bandwidth budget. Worker CPU is not throttled by this page-level CDP setting. The server does not add HTTP compression to JavaScript or CSS; inventory `.bin` assets are already gzip-compressed. Initial application transfer is therefore larger than on a host that compresses scripts, including GitHub Pages.

The server gives assets a ten-minute HTTP cache lifetime. External basemap and canopy requests are blocked through CDP, which leaves the browser HTTP cache enabled. Each of three repetitions starts a new browser context and visits Vienna, Geneva, Porto, then Vienna again. The initial Vienna step includes application loading; Geneva and Porto measure their first inventory load within an already-open app. Readiness requires the exact complete inventory count, a 30-record result page and a nonempty map with at most 1,000 markers. It does not wait for external map imagery.

## Reproduce

Build first, then run:

```sh
pnpm build
node scripts/mobile-benchmark.mjs
```

Optional environment variables select the build directory (`MOBILE_BENCH_ROOT`, default `dist`), report path (`MOBILE_BENCH_OUTPUT`, default `.tmp/mobile-performance.json`), repetition count (`MOBILE_BENCH_RUNS`, default `3`) and comma-separated cities (`MOBILE_BENCH_CITIES`, default `vienna,geneva,porto`). The first selected city is visited again at the end to measure returning to an inventory. Counts and button labels come from the build's manifest.

## Baseline

Recorded 26 October 2026 with Chromium 156.0.8078.4 and the production build at commit `175a584`. Three repetitions:

| Journey                | Median readiness |   Observed range | Inventory bytes served |
| ---------------------- | ---------------: | ---------------: | ---------------------: |
| Cold app, Vienna       |        14,575 ms | 14,230–14,946 ms |              4,092,517 |
| First switch to Geneva |        14,886 ms | 14,848–14,947 ms |              5,240,338 |
| First switch to Porto  |         4,642 ms |   4,590–4,671 ms |              1,388,705 |
| Return to Vienna       |         1,038 ms |   1,020–1,117 ms |                      0 |

Browser HTTP caching already avoided transferring the Vienna index on return in all three repetitions. Keeping additional parsed inventories alive would therefore increase memory to save roughly one second of reconstruction in this desktop-worker scenario. It would not address the cold transfer cost. This evidence supports keeping one active worker and reducing cold payload size before retaining multiple workers.

The cold page produced six or seven main-thread tasks of at least 50 ms, totaling 647–877 ms; the longest was 273–327 ms. First-city switches produced zero or one such task, at most 96 ms. Return visits produced zero or one, at most 54 ms. Worker parsing and indexing are excluded from main-thread long-task observations, but included in end-to-end readiness.

## Limits

These measurements omit actual radio behavior, browser cache eviction, background-tab limits, thermal throttling, Safari and physical-device touch responsiveness. The page heap API returned a quantized 10 MB reading and excludes worker heaps; it is not used as evidence of application memory consumption. Separate engine memory measurements are documented in [performance.md](performance.md).

All records remain searchable; map clustering and pagination bound presentation rather than the inventory. These timings are observations from a repeatable setup, not performance guarantees or test pass thresholds.

## Lossless transfer alternatives

The cold-load measurements motivated a smaller index format. A byte-shuffled column representation groups equal-significance bytes before gzip: coordinates remain Float64, reference columns remain signed 32-bit integers, and source identifiers remain strings in a JSON header. Nothing is rounded or removed. Missing coordinates use a paired sentinel and remain searchable through the list. Header identity, exact payload length, coordinate validity and dictionary references are checked before use.

Publication compresses both the existing JSON rows and the column representation, then selects the smaller result per inventory. This is necessary because the column representation is not always smaller: preliminary actual-data probes reduced Geneva by about 27% and Porto by 25%, while increasing Vienna by 12%. Vienna therefore retains JSON rows. The descriptor identifies the encoding; older releases require no changes.

Other lossless candidates were measured and rejected: plain column JSON saved only 4–7%; unshuffled binary columns made Vienna 25% larger; longitude ordering made all three indexes 4–8% larger. Coordinate rounding was not used because it changes source values. A separate spatial-partitioned search architecture remains an option for substantially larger inventories, but is not required to retain complete search in this update.

## Published transfer sizes

| Inventory | Previous index bytes | Current index bytes |                         Change | Encoding              |
| --------- | -------------------: | ------------------: | -----------------------------: | --------------------- |
| Vienna    |            4,025,362 |           4,025,364 | +2 bytes from release identity | JSON rows             |
| Geneva    |            5,170,978 |           3,776,130 |                  27.0% smaller | Byte-shuffled columns |
| Porto     |            1,368,146 |           1,021,606 |                  25.3% smaller | Byte-shuffled columns |
| Amsterdam |                    — |           4,797,213 |                  New inventory | Byte-shuffled columns |
| Hamburg   |                    — |           4,222,496 |                  New inventory | Byte-shuffled columns |
| Zürich    |                    — |           1,454,847 |                  New inventory | JSON rows             |

Only compressed immutable bytes are retained across city switches. The application keeps one parsed inventory worker, preventing six parsed inventories from accumulating in memory. Its persistent byte cache is bounded to 32 MiB and 18 assets, with an 8 MiB per-asset limit. It rechecks hashes on reads, does not rewrite a valid cache hit merely to update recency, and falls back to the network if storage is denied or corrupt. A warm HTTP cache already helped the baseline, so this added cache is not presented as the cause of every loading improvement.

## After the changes

The final production build was measured in isolation after development servers and other browser tests stopped. An earlier exploratory run overlapped with browser regression tests and is excluded from these results. Use the same isolation when reproducing measurements.

Three final repetitions with the same original-inventory sequence:

| Journey                | Before median | After median |      After range | Interpretation                    |
| ---------------------- | ------------: | -----------: | ---------------: | --------------------------------- |
| Cold app, Vienna       |     14,575 ms |    14,382 ms | 14,337–15,095 ms | No substantial change established |
| First switch to Geneva |     14,886 ms |    11,314 ms | 11,310–11,317 ms | 24.0% faster in this setup        |
| First switch to Porto  |      4,642 ms |     3,545 ms |   3,510–3,548 ms | 23.6% faster in this setup        |
| Return to Vienna       |      1,038 ms |       985 ms |       952–991 ms | Remains about one second          |

All repetitions returned exact inventory counts, 30 list records and bounded map markers. The returning Vienna step transferred zero inventory bytes in both versions. The measurable first-switch gains come primarily from smaller lossless indexes, not from keeping a second parsed inventory alive. Vienna's cold load still depends on its approximately 4 MB index; the update does not make every cold load faster.

The final cold page produced four to six main-thread long tasks, totaling 419–732 ms; its longest task was 223–289 ms. Geneva first switches had one 77–86 ms task, Porto zero or one of 55 ms, and Vienna returns had none. These observations cover loading and switching, not every pan, zoom or touch gesture.

## New inventories

A separate three-repetition sequence opened Amsterdam, switched to Hamburg and Zürich, then returned to Amsterdam. These are first measurements, not before/after improvements.

| Journey                 | Median readiness |   Observed range | Inventory bytes served |
| ----------------------- | ---------------: | ---------------: | ---------------------: |
| Cold app, Amsterdam     |        16,473 ms | 16,382–16,515 ms |              4,893,069 |
| First switch to Hamburg |        12,381 ms | 12,308–12,858 ms |              4,289,098 |
| First switch to Zürich  |         4,626 ms |   4,606–4,662 ms |              1,478,342 |
| Return to Amsterdam     |         1,516 ms |     990–1,525 ms |                      0 |

All runs returned the complete published counts: 326,518 Amsterdam, 229,876 Hamburg and 81,142 Zürich records. The default mobile views showed 24, 19 and 22 map clusters respectively; those are display objects, not record totals. Records without coordinates remain searchable and accessible in the list.

Amsterdam's initial page produced four to six main-thread long tasks, totaling 449–560 ms, with a longest task of 221–225 ms. First switches produced one task of at most 77 ms; returning to Amsterdam produced zero or one, at most 58 ms. Large cold loads still take several seconds on the simulated connection. The interface now names the inventory being opened and keeps the map usable during the wait; it does not imply that all records are ready before validation finishes.
