# Local branch validation, 19 November 2026

Branch: `pilot/carbon-postgres-local`. Public base: `8fb090145c0852a83dec1038fa663e7ba15e0de3`.

This branch contains the local Carbon/native, PostgreSQL and separate frontend pilot. Both public application implementations, release assets and deployment workflows remain unchanged. New root lint/format exclusions keep pilot checks separate. There has been no push, hosting purchase or deployment.

## London query fixes

The initial branch checkpoint reproduced 504 responses for London's `a` and `torreya` searches. Investigation found repeated summary scans, a redundant zero-result page scan and deep OFFSET pages reading skipped records' full JSON. A first no-match Porto query also exposed wide-heap I/O. The fixes use one exact summary scan, a validated covering search index and narrow ordinal paging before canonical-row retrieval. The native adapter skips page SQL only when the exact total proves the page empty.

The 2,500 ms SQL-work budget, complete membership, order, status and missing-position rules are unchanged. The new index occupies 262,094,848 bytes; measured database size is about 2.00 GB, excluding WAL/temp/backups. No canonical records or sealed reference files were changed. [London investigation, measurements and reproduction](tree-atlas-carbon-inventory-api/sql/LONDON-SEARCH.md) records the alternatives and limits.

## Executed checks

| Check | Result |
| --- | --- |
| API source setup | Restored the omitted API/staging SQL inputs. Missing/empty schema fails before setup actions; a missing user config parent is created with correct ownership/modes. Five setup regressions pass. |
| Summary and index regressions | Five literal summary cases pass against the actual SQL body; index-definition validation rejects conflicting, invalid and unready definitions. |
| Actual HTTP regressions | All 24 tests pass with zero skips, including 14 distinct uncached London attempts and the four opt-in administrative lock/cancel/deadline/disconnect faults. |
| Full HTTP conformance | All **1,657,347 records** reconcile with independent ordered identity digests across **16,576 pages**. All 48 frozen cases/192 selected pages, 16 suggestions, eight details and sampled viewport/member unions pass. |
| Complete offline browser journeys | **4/4 pass**: London, Vienna, Geneva and Porto. Full counts, selected frozen IDs/order, genus/leading-zero/area searches, saved/unsaved details, offline refresh, eviction and zero offline API fallback pass. |
| Complete offline session conformance | All 48 frozen queries enumerate their full ordered matching IDs and viewport digests. All 1,657,347 records, 192 selected pages and 16 suggestion cases pass. |
| Matched London browser memory | Five alternating runs per build show median sampled PSS **1,192 to 709 MiB**, a **40.5% reduction**. Final ranges are 1,174 to 1,235 MiB before and 698 to 739 MiB after. No profiler or forced GC ran during the comparison. |
| Final four-city browser memory | The longer offline journeys sampled peaks of **785 MiB PSS** for London, 533 MiB for Vienna and 533 MiB for Geneva. Porto passed its existing desktop correctness journey without process-memory sampling. |
| Fresh frontend source checks | Strict TypeScript, type-aware Oxlint, Oxfmt, 70 regressions, production build and 1,132,086 normalizer reference cases passed. All four final offline browser journeys passed in 59.1 seconds. |
| Preserved inputs | The source-import checker verifies unchanged public baseline paths, 20 sealed contract blobs and 42 archived report hashes. All 10,961 public asset hashes passed at relocation. |

The first full HTTP rerun completed in 153.1 seconds. After correcting a stale hard-coded report date, the final full run completed in **168.2 seconds**, with actual execution time, source commit and runtime versions recorded. London `a` first page took about **834 ms**, midpoint 195 ms and a late page 363 ms; the initial `torreya` response took about **369 ms**. The frozen London rare-genus case has zero matches: it still scans complete membership and returns an exact empty result. The workload contains many cheap unfiltered pages, so its aggregate percentile is not a filtered-search performance claim. Caches were warm/uncontrolled; no cold-OS, physical-phone or hosted guarantee follows. [Concise HTTP evidence](validation/http-conformance-2026-11-19.json) retains complete-inventory digests and the raw report hash.

The [offline method and measurements](tree-atlas-local/verification/offline-memory.md) distinguish package bytes, browser storage and process memory. The current implementation removes whole-city GeoJSON/Supercluster structures, duplicate normalization and geometry iterator allocations. Its responsive grid keeps every record reachable through exact member pages. A fixed 900-cell prototype reduced memory but slowed camera updates; the responsive layout corrected that measured regression. Final zoom/pan medians showed no slowdown in the matched comparison.

The [matched comparison](validation/offline-memory-improvement-2026-11-19.json) and [separate final browser cohort](validation/offline-browser-after-memory-2026-11-19.json) bind their own raw hashes and tested source. The comparison uses a shorter workload than the four-city journeys. About 0.7 to 0.8 GiB remains a material phone-memory risk, not a hard bound. Offline refresh does not prove a complete browser-process restart with a retained profile. The accepted three-second first-search target applies to online search including backend wake-up, which has not been tested on hosting.

## Clean setup and restore

[CLEAN-ROOM.md](CLEAN-ROOM.md) defines the fresh-dependency setup and independent restore check. It uses a checked official Ubuntu image, fresh pinned downloads, a committed Git archive and a private PostgreSQL cluster in separate mount/PID/network namespaces. The existing database is read only for its backup. This is fresh userspace on the shared WSL kernel, not a new VM or physical server.

The executed clean-userspace qualification **passed** from commit `06015e5d21e9a0cf16f2a14f8f53618a223abcb8`. Fresh Node, Carbon, libpq, ICU and frontend dependencies installed without the original tools, caches or credentials. Restore, current SQL/index installation and VACUUM took 47.255 seconds. Independent readback took 78.222 seconds and checked all canonical records, normalized fields, identity/content/dictionary digests, 48 query sets, 192 slices, 16 suggestions and 22 literal SQL cases.

The fresh Carbon/native build, quick HTTP conformance, all six frontend source checks, 63 regressions, Vite build and documented launcher passed. The private cluster stopped with zero reader sessions. A separate host process scan found no surviving test-owned runtime process. The existing database remains online with all 1,657,347 records and zero reader sessions after cleanup. [Recovery evidence](validation/clean-room-2026-11-19.json) binds the source archive and raw report hashes. Full HTTP enumeration and browser memory tests are separate runs documented above.

This exercise found and fixed two setup defects. WSL Git repeatedly re-read the Windows-mounted checkout; source export now uses fixed-path Windows Git there with bounded checks and the recorded commit SHA. A fresh user home lacked `.config`; setup now creates the missing private parent with correct ownership and preserves an existing real parent. Twenty bootstrap/path/timeout regressions and five staging setup regressions pass. The failed attempt stays labelled as failed evidence. The successful run used another new filesystem and fresh downloads.

The completed private directory occupies about 7.08 GiB, including retained inputs, tools, logs, backup and stopped database. The restored database occupies 1,914,035,223 bytes. These are disk checkpoints. Peak WAL/temp space and whole-service memory remain unmeasured. Native package versions are recorded; future apt resolution is not fully version-locked. The independent verifier's embedded legacy date is labelled in the summary; the outer report supplies actual execution timestamps.

## Reproduce

From the repository root in WSL, prepare the data-only link and selected dependencies as described in [README.md](README.md). Build/install the query path with the commands in [LONDON-SEARCH.md](tree-atlas-carbon-inventory-api/sql/LONDON-SEARCH.md). Run:

```sh
python3 experiments/local-pilot/scripts/verify-source-import.py
node experiments/local-pilot/tree-atlas-carbon-inventory-api/verification/http-conformance.mjs
```

With the separate frontend launcher running, execute from `tree-atlas-local`:

```sh
node_modules/.bin/playwright test --config verification/playwright.local.config.ts offline-large.spec.ts offline.spec.ts
```

Run ordinary source checks with `python3 verification/check-local.py` there. Run heavy checks sequentially; do not profile latency beside imports, dumps, lock faults or package builds. Current raw logs, build products, database dumps, credentials and browser traces stay ignored/private. Concise dated evidence belongs in `validation/`. Historical snapshots retain their original labels and hashes.

Not established: physical-device memory acceptance, shaped-network performance, hosted cold start, monthly refresh/release activation, peak restore/WAL/temp space under production load, or recovery/retention objectives. No new inventory is imported by this work.
