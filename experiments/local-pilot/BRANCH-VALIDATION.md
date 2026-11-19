# Local branch validation — 19 November 2026

Branch: `pilot/carbon-postgres-local`. Public base: `8fb090145c0852a83dec1038fa663e7ba15e0de3`.

This branch contains the local Carbon/native, PostgreSQL and separate frontend pilot. Both public application implementations, release assets and deployment workflows remain unchanged. New root lint/format exclusions keep pilot checks separate. There has been no push, hosting purchase or deployment.

## London query fixes

The initial branch checkpoint reproduced 504 responses for London's `a` and `torreya` searches. Investigation found repeated summary scans, a redundant zero-result page scan and deep OFFSET pages reading skipped records' full JSON. A first no-match Porto query also exposed wide-heap I/O. The fixes use one exact summary scan, a validated covering search index and narrow ordinal paging before canonical-row retrieval. The native adapter skips page SQL only when the exact total proves the page empty.

The 2,500 ms SQL-work budget, complete membership, order, status and missing-position rules are unchanged. The new index occupies 262,094,848 bytes; measured database size is about 2.00 GB, excluding WAL/temp/backups. No canonical records or sealed reference files were changed. [London investigation, measurements and reproduction](tree-atlas-carbon-inventory-api/sql/LONDON-SEARCH.md) records the alternatives and limits.

## Executed checks

| Check | Result |
| --- | --- |
| API source setup | Restored the omitted API/staging SQL inputs. Missing/empty staging schema fails before database or private-config actions; two regressions pass. |
| Summary and index regressions | Five literal summary cases pass against the actual SQL body; index-definition validation rejects conflicting, invalid and unready definitions. |
| Actual HTTP regressions | All 24 tests pass with zero skips, including 14 distinct uncached London attempts and the four opt-in administrative lock/cancel/deadline/disconnect faults. |
| Full HTTP conformance | All **1,657,347 records** reconcile with independent ordered identity digests across **16,576 pages**. All 48 frozen cases/192 selected pages, 16 suggestions, eight details and sampled viewport/member unions pass. |
| Complete offline browser journeys | **4/4 pass**: London, Vienna, Geneva and Porto. Full counts, selected frozen IDs/order, genus/leading-zero/area searches, saved/unsaved details, offline refresh, eviction and zero offline API fallback pass. |
| Browser memory | Owned Chromium process-tree RSS/PSS includes renderer and worker allocations. The final rerun peaked at **1,036 MiB PSS** for London, 588 MiB for Vienna and 550 MiB for Geneva. These are sampled desktop mobile-emulation observations. |
| Fresh frontend source checks | Strict TypeScript, type-aware Oxlint, Oxfmt, 63 regressions, production build, 1,132,086 browser-normalizer cases and six online/offline journeys passed. |
| Preserved inputs | The source-import checker verifies unchanged public baseline paths, 20 sealed contract blobs and 42 archived report hashes. All 10,961 public asset hashes passed at relocation. |

The first full HTTP rerun completed in 153.1 seconds. After correcting a stale hard-coded report date, the final full run completed in **168.2 seconds**, with actual execution time, source commit and runtime versions recorded. London `a` first page took about **834 ms**, midpoint 195 ms and a late page 363 ms; the initial `torreya` response took about **369 ms**. The frozen London rare-genus case has zero matches: it still scans complete membership and returns an exact empty result. The workload contains many cheap unfiltered pages, so its aggregate percentile is not a filtered-search performance claim. Caches were warm/uncontrolled; no cold-OS, physical-phone or hosted guarantee follows. [Concise HTTP evidence](validation/http-conformance-2026-11-19.json) retains complete-inventory digests and the raw report hash.

The [offline method and measurements](tree-atlas-local/verification/offline-memory.md) distinguish package bytes, browser storage and process memory. London's first offline initialization already reached about 1,011 MiB PSS. This is an unresolved mobile risk. Offline refresh is not a complete browser-process restart with a retained profile. The accepted three-second first-search target applies to online search including backend wake-up, which has not been tested on hosting.

## Clean setup and restore

[CLEAN-ROOM.md](CLEAN-ROOM.md) defines the fresh-dependency setup and independent restore check. It uses a checked official Ubuntu image, fresh pinned downloads, a committed Git archive and a private PostgreSQL cluster in separate mount/PID/network namespaces. The existing database is read only for its backup. This is fresh userspace on the shared WSL kernel, not a new VM or physical server.

The procedure and its input/timeout regressions are implemented. Actual installation, restore and application proof is pending completion; a prepared image or passing bootstrap unit tests alone must not be called a recovery pass. The completed report must establish exact restored release digests, source/tool identities, HTTP/source/launcher results, zero remaining readers and a stopped private cluster.

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
