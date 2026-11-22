# Local browser checks

The browser suite checks the local production preview and the real local Carbon API. It does not start either service. The runner must start them first and set `TREE_ATLAS_LOCAL_URL` if the preview does not use `http://127.0.0.1:4199`.

From `outputs/tree-atlas-local` in WSL:

```sh
node node_modules/@playwright/test/cli.js test --config verification/playwright.local.config.ts
```

Use the pinned Node installation recorded in the main setup guide. Chromium must be installed for the pinned Playwright version. This suite uses `@playwright/test` directly; a separate `playwright-core` import is not needed.

The tests use the frozen contract files in `../tree-atlas-contract-v1`. Their expected counts and record IDs come from those independent checks, not from the frontend's own data model.

| Check                                                                                 | Evidence                                             |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Four cities, pinned releases, complete counts, genus queries and a selected detail ID | `online.spec.ts`                                     |
| An older successful search cannot replace a new city's results                        | Held real API response in `online.spec.ts`           |
| API outages and unavailable releases remain explicit errors                           | `online.spec.ts`                                     |
| Two coincident Geneva trees can each open their details                               | Real API cluster and member list in `online.spec.ts` |
| A complete Porto pack supports offline refresh, search and area filtering             | `offline.spec.ts`                                    |
| Saved details work offline; unsaved details remain unavailable                        | `offline.spec.ts`                                    |
| Browser storage eviction cannot appear as a complete empty city                       | Chromium storage eviction in `offline.spec.ts`       |
| Loading and switching do not download full inventory indexes online                   | `online.spec.ts` and `performance.spec.ts`           |

The loading profile runs five fresh browser contexts for each of two viewports. Each context opens London, then switches to Porto, Geneva, Vienna and London. It records 50 timings, API requests, advertised response lengths and browser long tasks in `browser-loading.json`. The timed endpoint is a visible record list with the expected total and a map that is no longer busy, has actual markers and has completed its filter.

The final profile uses the default service worker. It includes app-shell preparation in the startup workload. Map readiness is timed separately from shell readiness. Each cold sample waits for the shell to finish before it records the response ledger. Page and service-worker requests are both included.

These are local bundled Chromium measurements. The mobile viewport is emulated. The suite does not control PostgreSQL caches, operating-system caches or unrelated machine activity, and it blocks external basemap imagery. It does not establish physical phone, public hosting, slow-network or cold-database performance. Browser-cold means a fresh browser context; it does not mean a cold database.

`browser-results.json` records the latest test invocation. The final six correctness journeys are preserved separately in `browser-journeys-results.json` and `browser-journeys-final.log`. Failed checks retain traces and screenshots in `../test-results/local-browser`. A populated loading report alone does not prove the correctness suite passed. A partial loading report must not be reported as a completed run.

On 8 November 2026, all six correctness journeys passed against the final local production build in 21.5 seconds. Both final loading tests passed in 27.1 seconds, with all 50 samples complete and no full-inventory index, geometry or detail-shard download. Test discovery and the isolated strict TypeScript check also passed.

| Default service worker enabled | Samples | p50 map ready | p95 map ready | Maximum |
| ------------------------------ | ------: | ------------: | ------------: | ------: |
| Desktop, browser cold          |       5 |        593 ms |        687 ms |  687 ms |
| Desktop, city switch           |      20 |        253 ms |        314 ms |  360 ms |
| Emulated mobile, browser cold  |       5 |        527 ms |        596 ms |  596 ms |
| Emulated mobile, city switch   |      20 |        225 ms |        262 ms |  264 ms |

Percentiles use nearest rank. Five cold samples give only a small local estimate. The maximum shell-ready time was 700 ms on desktop and 607 ms on the emulated mobile viewport. Seven browser long tasks were observed across all 50 samples; the largest was 62 ms. No city-switch sample recorded a long task.

The response ledger uses advertised `Content-Length` values. These are not measured network transfers. Most cold JavaScript and precache responses omitted this header: 74 missing lengths across the five desktop cold samples and 75 across the five mobile cold samples. **Do not use the cold advertised-byte sums as total startup downloads.** City-switch API responses had complete advertised lengths, ranging from 22,280 to 59,413 body bytes. The request paths still establish that normal online use did not fetch the complete inventory assets.

The earlier service-worker-blocked profile is preserved in `browser-loading-sw-blocked.json` and its log. It recorded p95 cold/switch times of 1,323/543 ms on desktop and 1,309/511 ms on emulated mobile. It is a different measurement scope; neither run proves a speed improvement over the other. The first attempt to measure the enabled worker stalled while awaiting Chromium request-size instrumentation. That run was stopped and retained as `browser-loading-sw-instrumentation-incomplete.json` and its log. It is incomplete and is not evidence of an application failure. The final instrumentation reads response headers without waiting for that protocol operation and persists each sample.

The reviewed UI screenshots are `local-desktop.png` and `local-emulated-mobile.png`. Their basemap warning is expected because this suite blocks external tiles. The narrow layout had no horizontal overflow.

The first browser run found a real HTTP 504 on the initial online Porto query `0007`, before any offline download. The request took 2,518.5 ms. Its trace and error context are retained in `initial-offline-failure`; the first-run log is `browser-journeys-initial.log`. The final run passed after the startup query and offline query handling fixes. This successful rerun does not establish a cold-database latency guarantee. See [the Porto timeout review](./porto-timeout-review.md) for the query and follow-up evidence.
