# Complete-city offline browser and memory checks

The original checkpoint appears under Recorded execution. The later Memory
reduction section records the current implementation and matched comparison.
Its five-run medians and the earlier single journeys are different workloads.

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

On **19 November 2026**, all **four browser journeys passed**: London (38.1 s), Vienna (16.0 s), Geneva (15.7 s), and the existing Porto regression (5.7 s). Each added city retained its complete record count and matched the frozen first-page IDs for the selected full-city/genus/leading-zero/area queries. Saved and unsaved details, refresh, eviction, and zero offline API requests passed. All owned browser processes exited. This final rerun includes the reviewed startup-ownership cleanup and post-eviction/page-error success guards. The earlier cohort remains in the ignored prior-run directory; the dated summary now binds this final raw report.

| City   |   Records | Download + validate + commit | Offline initialize | Offline refresh ready | Sampled browser-tree RSS peak | Sampled browser-tree PSS peak | Browser storage estimate |
| ------ | --------: | ---------------------------: | -----------------: | --------------------: | ----------------------------: | ----------------------------: | -----------------------: |
| London | 1,111,784 |                       3.98 s |             6.08 s |                5.33 s |                     1,294 MiB |                     1,036 MiB |         17,016,771 bytes |
| Vienna |   233,102 |                       1.05 s |             2.06 s |                2.39 s |                       856 MiB |                       588 MiB |          6,506,435 bytes |
| Geneva |   240,827 |                       1.06 s |             2.02 s |                2.30 s |                       815 MiB |                       550 MiB |          6,260,675 bytes |

These are **one journey per city**, not latency percentiles. There were 128/53/53 memory samples respectively; the largest observed sampling gaps were 310/296/303 ms. PSS was readable for every observed process in every sample. The browser/renderer/worker tree is included; API, PostgreSQL and test-runner memory are excluded. Storage estimates include shell overhead and browser accounting; they are separate from the immutable compressed package sizes.

London already reached about **1,011 MiB PSS during first offline initialization**, before the repeated deep-link navigations. Its overall sampled PSS peak was 1,036 MiB. This is a material unresolved large-city memory risk, not a physical-phone acceptance pass. Allocation/heap profiling and representative memory-constrained devices are the next checks; do not reduce complete search coverage to make a test pass.

The accepted three-second target applies to complete **online** first search including backend wake-up. These offline initialization/refresh timings are a different operation and do not pass or fail that hosted target.

A concise dated summary is versioned at [validation/offline-memory-2026-11-19.json](../../validation/offline-memory-2026-11-19.json). Full process samples and failure diagnostics remain in the ignored raw reports. This run does not prove a full browser-process restart with a retained profile, physical Android/iOS behavior, shaped-network latency, or a hard phone-memory budget.

## Memory reduction, 19 November 2026

The current implementation keeps every pinned record searchable. It replaces
whole-city GeoJSON objects and the multi-zoom Supercluster index with a bounded
map grid. Grid dimensions use the existing viewport and zoom, with about 60
projected pixels per cell and at most 30 cells on each axis. A representative
phone camera uses 54 possible cells. Every cell reports its exact count and
supports prepared-order member pages. Map grouping and marker IDs can change;
search membership, positions and list order do not.

The loader now normalizes IDs and dictionary strings once, then invalidates only
its query caches when exact geometry arrives. Match ordinals use a reusable
typed array. Geometry installation uses indexed loops and skips the cached-detail
scan when there are no cached details. It still checks existing cached details
before writing coordinates.

### Matched end-to-end comparison

The final comparison used five alternating fresh-browser runs per build. The
baseline was `991a2fc6`; the final implementation was `ebcd6dcf`. Each run opened
London, downloaded and checked its complete pack, initialized offline search,
refreshed offline, searched a common genus and all records, then zoomed and panned
the map. It checked all 1,111,784 records in the displayed count and frozen
first-page IDs. Every camera action had to produce a busy-to-ready transition
before two animation frames and a DOM marker count completed the measurement.
All ten runs passed, with no page errors or offline API requests.

| Observation                        | Baseline median and range |  Final median and range |
| ---------------------------------- | ------------------------: | ----------------------: |
| Sampled browser-tree PSS peak      | 1,192 MiB, 1,174 to 1,235 |     709 MiB, 698 to 739 |
| Offline initialize and first query |   4.930 s, 4.920 to 4.935 | 2.919 s, 2.915 to 2.949 |
| Offline refresh ready              |   5.249 s, 5.178 to 6.274 | 3.247 s, 3.228 to 3.295 |
| Zoom action to updated map         |        360 ms, 354 to 367 |      330 ms, 325 to 345 |
| Pan action to updated map          |        321 ms, 318 to 344 |      312 ms, 308 to 313 |

The primary result is a **40.5% reduction in median sampled browser PSS**. Camera
measurements showed no slowdown in these runs. They include Leaflet animation,
React rendering and actionability checks. They are not isolated worker timings.
The complete pack still contains 16,139,261 bytes. No record or field was removed
from the pack to reduce memory.

These runs used the same pinned dependencies and Chromium version, local static
assets, blocked external basemap tiles and a 390 by 844 touch viewport. They did
not use a profiler or explicit garbage collection. OS caches were uncontrolled.
The WSL machine was shared with unrelated builds; the five alternating pairs and
exact ranges are retained. Final load averages were lower than during an earlier
comparison. These observations do not establish cold-OS latency, phone memory
limits or the hosted three-second online-search target.

### Profile and review evidence

The separate CDP diagnostic attached to the actual dedicated worker before it
started. Allocation sampling and CPU profiling located the whole-city feature
construction, clustering work, duplicate normalization and geometry iterator
allocations. The final profile no longer contains the clustering or geometry
iterator hotspots. Estimated cumulative sampled allocation fell from 990,725,980
to 535,665,612 bytes. Those estimates include objects collected during the run;
they are not retained memory or exact allocation totals.

After explicit diagnostic garbage collection, the baseline worker reported
179,423,608 bytes of JavaScript heap use and 188,529,685 bytes of backing storage.
The final worker reported about 151.7 MB and 4.7 MB respectively. These traced,
forced-GC values explain the change. They are excluded from the comparison
above, which measures ordinary execution without forced collection.

The first fixed 30 by 30 prototype passed correctness checks and reduced memory,
but rendered about 800 cluster elements on the phone viewport. Its five-run pan
median rose from 321 to 491 ms. The responsive layout corrected that regression
and rendered about 30 cluster elements in the final camera exercise. An
intermediate responsive checkpoint also passed. The final indexed-loop revision
removed another observed temporary allocation path. Earlier reports remain
ignored local checkpoints; the final dated summary identifies the chosen source.

Independent session checks enumerated every matching ID for all 48 frozen query
sets, including full ordered identity and viewport digests. All 1,657,347 pinned
records, 192 selected pages and 16 suggestion cases passed. Strict TypeScript,
type-aware Oxlint, Oxfmt and all 70 regressions passed. New interface cases cover
unlocated records, inclusive edges, tiny and polar viewports, stale handles,
mobile marker density and coincident member pagination. MSW cases hold geometry
loading until a detail is cached, then prove both matching geometry acceptance
and conflicting geometry rejection.

### Final four-city browser check

The final production build passed all four offline journeys in 59.1 seconds.
London took 26.1 seconds, Vienna 10.4, Geneva 10.4 and Porto 5.5. Each added city
passed full counts, frozen selected queries/order, saved and unsaved details,
offline refresh, eviction and zero API fallback. All owned browsers exited.

The longer journeys sampled PSS peaks of 785 MiB for London, 533 MiB for Vienna
and 533 MiB for Geneva. Porto retained its existing desktop correctness journey
without a process-memory measurement. This longer workload differs from the
matched London comparison above. Its higher London peak illustrates why 709 MiB
is not a hard memory bound. About 0.7 to 0.8 GiB remains a material phone risk.
Physical Android/iOS testing and retained-profile browser restart remain open.
Choose a device memory/storage budget before a larger decoded-index rewrite.
The remaining row objects, validation lookup and normalized strings still cost
memory.

The [comparison evidence](../../validation/offline-memory-improvement-2026-11-19.json)
binds the source, raw report hashes, exact ranges, phase samples and profile.
The [four-city browser evidence](../../validation/offline-browser-after-memory-2026-11-19.json)
binds the separate final cohort. Raw profiles, process samples, logs, screenshots
and preserved builds remain ignored local artifacts.

### Run the checks yourself

Use the WSL setup and pinned Node instructions in [the workspace guide](../../README.md).
From this frontend directory, start the documented production launcher:

```sh
python3 scripts/run-local.py
```

In another WSL terminal in the same directory:

```sh
node --import tsx verification/offline-conformance.mjs
node_modules/.bin/playwright test --config verification/playwright.local.config.ts offline-large.spec.ts offline.spec.ts
```

Run these sequentially. The first command exercises the actual inventory session
over checksum-verified local assets. It has no IndexedDB or browser claim. The
second command exercises installed packs and the app shell in real Chromium.

For a separate allocation diagnostic against the running production preview:

```sh
node verification/profile-offline.mjs current
```

Before starting the comparison, stop the single frontend launcher above with
Ctrl+C. It owns port 4199 and its API child. Do not run it alongside the two
previews below, which reuse that port.

For a before/after comparison, build the two recorded revisions separately with
the same dependencies. Preserve each `dist` in an ignored directory. Keep both
builds unchanged during measurement. Start the local API with
`python3 ../tree-atlas-carbon-inventory-api/tools/run.py` and use its announced
port for both previews. In separate terminals, replace the example port 12345
below with that announced port:

```sh
TREE_ATLAS_API_PORT=12345 node_modules/.bin/vite preview --host 127.0.0.1 --port 4199 --strictPort --outDir ../.verification/memory-baseline-dist-991a2fc6
TREE_ATLAS_API_PORT=12345 node_modules/.bin/vite preview --host 127.0.0.1 --port 4202 --strictPort --outDir ../.verification/memory-candidate-dist-3
```

Then run the five alternating pairs:

```sh
node verification/benchmark-offline-memory.mjs http://127.0.0.1:4199 http://127.0.0.1:4202
```

The retained directories above belong to this local run. A new checkout must
build its own baseline and candidate; the directories are not committed. For
example, build each checkout with `node_modules/.bin/vite build --outDir` pointing
to its separate comparison directory. Do not replace an active preview's output.
Do not run allocation diagnostics, imports or other test suites alongside the
comparison. Keep failures in the report. Do not treat a partial run as five pairs.
Stop the previews and API with Ctrl+C when finished.
