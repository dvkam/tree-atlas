# Complete-city offline browser and memory checks

`tests/local-browser/offline-large.spec.ts` extends the existing Porto journey to London, Vienna and Geneva. Each case launches a browser it owns, uses a fresh context, and checks the local production preview. The frontend/API launcher must already be running. Nothing in this suite deploys or imports municipal data.

From the isolated frontend directory, with pinned Node on PATH:

```sh
node_modules/.bin/playwright test --config verification/playwright.local.config.ts offline-large.spec.ts offline.spec.ts
```

The three added journeys verify:

- The complete pinned city count, with independent frozen first-page IDs in prepared order.
- An explicit complete package download, verified ready state and browser storage estimate.
- A saved canonical detail, downloaded mode and offline page refresh using the app shell.
- Complete-city, common-genus, leading-zero and central-area counts, plus independent first-page identities.
- Exact map filtering readiness and positive markers, saved detail availability, explicit unsaved-detail errors, and no requests to the local API while using the offline city.
- IndexedDB eviction while retaining the app shell, followed by an explicit unavailable/incomplete state rather than a successful empty city.

These are selected independent query/identity checks, not enumeration of every possible query or all browser result pages. Full source-record/HTTP identity reconciliation has separate checks.

## Memory method

The harness launches its own Chromium server and reads its actual Linux PID. `browser-memory.ts` enumerates that process and its descendants through `/proc`. It samples resident memory across the browser, renderer, GPU, utility and other child processes. Dedicated-worker memory resides in these owned processes, so this covers native/worker allocations that page JavaScript heap metrics alone omit. `page.workers()` and worker creation events separately establish that the offline worker was present.

RSS sums double-count shared mappings. PSS is recorded only for a sample where every observed process's proportional memory is readable. The report includes missing-PSS counts, sample process roles, actual start/end/duration, maximum observed sample gap and phase peaks. Sampling requests a 250 ms interval, but `/proc` traversal adds time and short peaks can be missed. These are sampled process-tree observations, not exact per-worker heaps or a hard memory bound.

The report covers package validation/commit, offline worker initialization, refresh, queries, details and eviction. It separately records complete package content bytes, browser storage estimates and readiness timings. Estimates include app-shell/browser overhead and are not just compressed package size.

Each city uses a fresh owned browser and a 390×844 mobile/touch viewport. This is local desktop Chromium emulation with warm/uncontrolled system caches, blocked external basemap imagery, no shaped network and no physical handset. It excludes PostgreSQL/API/OS memory. No device memory budget has been chosen, so a successful journey is a correctness pass, not an acceptance claim for every phone.

Raw evidence is regenerated at `verification/offline-cities.json` and dated per-city `verification/offline-city-<id>.json` files, which remain ignored. Per-city files retain diagnostics if Playwright restarts a worker after a failure; do not combine stale files from different invocations as a successful cohort. It starts incomplete and is marked complete only after all three city journeys and memory observations succeed. A partial or failed report must not be presented as a completed run.

## Recorded execution

On **19 November 2026**, all **four browser journeys passed**: London (35.6 s), Vienna (15.3 s), Geneva (13.9 s), and the existing Porto regression (5.6 s). Each added city retained its complete record count and matched the frozen first-page IDs for the selected full-city/genus/leading-zero/area queries. Saved and unsaved details, refresh, eviction, and zero offline API requests passed. All owned browser processes exited.

| City   |   Records | Download + validate + commit | Offline initialize | Offline refresh ready | Sampled browser-tree RSS peak | Sampled browser-tree PSS peak | Browser storage estimate |
| ------ | --------: | ---------------------------: | -----------------: | --------------------: | ----------------------------: | ----------------------------: | -----------------------: |
| London | 1,111,784 |                       3.48 s |             5.05 s |                5.29 s |                     1,327 MiB |                     1,066 MiB |         17,016,771 bytes |
| Vienna |   233,102 |                       1.01 s |             2.01 s |                2.15 s |                       874 MiB |                       608 MiB |          6,506,435 bytes |
| Geneva |   240,827 |                       0.97 s |             2.00 s |                2.21 s |                       810 MiB |                       547 MiB |          6,260,675 bytes |

These are **one journey per city**, not latency percentiles. There were 120/52/47 memory samples respectively; the largest observed sampling gaps were 342/285/315 ms. PSS was readable for every observed process in every sample. The browser/renderer/worker tree is included; API, PostgreSQL and test-runner memory are excluded. Storage estimates include shell overhead and browser accounting; they are separate from the immutable compressed package sizes.

London already reached about **1,011 MiB PSS during first offline initialization**, before the repeated deep-link navigations. Its overall sampled PSS peak was 1,066 MiB. This is a material unresolved large-city memory risk, not a physical-phone acceptance pass. Allocation/heap profiling and representative memory-constrained devices are the next checks; do not reduce complete search coverage to make a test pass.

The accepted three-second target applies to complete **online** first search including backend wake-up. These offline initialization/refresh timings are a different operation and do not pass or fail that hosted target.

A concise dated summary is versioned at [validation/offline-memory-2026-11-19.json](../../validation/offline-memory-2026-11-19.json). Full process samples and failure diagnostics remain in the ignored raw reports. This run does not prove a full browser-process restart with a retained profile, physical Android/iOS behavior, shaped-network latency, or a hard phone-memory budget.
