# Work record and evidence map

## Scope

The original Vienna application and public Tree Atlas remain separate from this local experiment. This folder has its own source copy, Linux dependencies, build, browser storage, and loopback preview. No deployment or hosting changes are part of this work.

## Work completed before this frontend step

1. Compared a release-based backend with direct municipal API forwarding. The plan uses source adapters to import spreadsheet/download/API records into validated releases. Browser queries then use our database. This reduces repeated upstream calls and makes search reproducible.
2. Planned a self-hosted pilot within a EUR 30 monthly budget. No server was purchased. Carbon was selected for a feasibility experiment; it still relies on native C++ libraries and libpq rather than a mature standalone Carbon web ecosystem.
3. Set up PostgreSQL in WSL with dedicated import and read-only roles. Staged London, Vienna, Geneva, and Porto, then compared all canonical records with independent reference checks. See [the PostgreSQL pilot](../tree-atlas-postgres-pilot/README.md).
4. Froze the search/release contract, release identities, normalization, counts, pagination, viewport rules, offline requirements, and independent checks. See [the frozen contract](../tree-atlas-contract-v1/README.md). This frontend does not rewrite the freeze.
5. Built the local Carbon/native API with bounded HTTP parsing, connection pooling, cancellation, request identifiers, and read-only queries. Added disconnect/time-limit/fault tests. Plaintext localhost cancellation was exercised; encrypted cancellation faults remain a separate gate.
6. Added pinned inventory queries, exact counts, viewport results, suggestions, details, cluster members, and release metadata. Full HTTP enumeration checked 1,657,347 IDs across 16,576 pages. SQL checks provide separate full canonical-record evidence. See [the API evidence](../tree-atlas-carbon-inventory-api/README.md).

## This frontend step

- Created `tree-atlas-local` as an isolated copy. The public app and source history are unchanged.
- Added a same-origin local proxy to the read-only Carbon service. No database credential reaches the browser.
- Added a validated remote client. It checks release fingerprints, request/query identity, response shape, counts, and pagination; cancels obsolete work; and reports failures explicitly. MSW tests cover transport boundaries and stale/cancelled work.
- Reused the existing React/TanStack interface. Online city selection uses the API; it does not need a complete city index first.
- Added explicit offline packs with complete searchable fields and coordinates, worker-side verification/search, atomic storage, and separately saved full details.
- Added pinned Unicode 17 normalization tables. A reference sweep compares every Unicode scalar plus contextual probes; this avoids browser Unicode-version drift.
- Added a versioned app-shell service worker. It bypasses API requests and external basemap tiles. Updates wait for old local tabs to close.
- Added exact offline cluster-member paging and a regression fixture with coincident trees and a nearby non-member.
- Added the local launcher, README, manual runbook, browser journeys, and loading measurements. Final measured outcomes belong in [browser proof](verification/browser-proof.md) and the evidence reports, not in a promise about hosting speed.

## Evidence and limits

The three public test interfaces remain source import, published catalogue, and user journeys. A passing frontend journey does not prove upstream completeness. The inventory contains only records in the pinned municipal exports, including their known gaps and missing coordinates.

The native API, browser transport, offline pack, and UI each have separate checks. Test reports identify what actually ran. Local browser timing with a running database is not a cold hosted-server result. Emulated mobile is not a physical handset. Offline search/map support does not include a licensed offline street basemap or every unsaved full detail record.

### Correctness evidence recorded on 8 November 2026

| Check                                              | Recorded result                                               | Evidence and scope                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit/integration suite                             | 63 tests passed, including the 12 focused offline tests below | [`verification/source-checks.json`](verification/source-checks.json) and [`verification/check-regression.log`](verification/check-regression.log); test sources in `src/` and `tests/`. Rerun with `python3 verification/check-local.py`. Transport tests use MSW; they do not replace a real API journey.                                                                                                                                                               |
| Offline storage, plans, and normalizer regressions | 12 tests passed                                               | `tests/offline-storage.test.ts`, `tests/offline-plans.test.ts`, and `tests/offline-normalizer.test.ts`. Covers atomic rollback, injected quota failures, last-step cancellation, corruption/eviction detection, repair, release isolation, null detail fields, package byte totals, and fixed normalization cases. IndexedDB transactions use fake-indexeddb; these tests substitute the parser worker boundary. They do not establish a browser's actual storage quota. |
| Pinned normalization parity                        | 1,132,086 comparisons passed                                  | [`evidence/browser-normalizer-parity.json`](evidence/browser-normalizer-parity.json): all 1,112,064 Unicode scalars, 20,000 contextual probes, and 22 explicit cases against pinned Node Unicode 17. Runtime code uses generated tables instead of browser normalization properties. This sweep does not enumerate every possible multi-character string.                                                                                                                |
| Real browser correctness journeys                  | Six journeys passed                                           | [`verification/browser-journeys-results.json`](verification/browser-journeys-results.json), [`verification/browser-journeys-final.log`](verification/browser-journeys-final.log), and [browser proof](verification/browser-proof.md). Exercises the production shell, real Carbon API, complete Porto offline refresh/search/area filter, saved and unsaved details, eviction, and real cluster members.                                                                 |
| Local browser loading profile                      | 50 timings recorded; report marked complete                   | [`verification/browser-loading.json`](verification/browser-loading.json). Five fresh contexts per viewport, each opening London and switching through the four cities. Zero full inventory asset requests online. Desktop and mobile viewport emulation; running service and uncontrolled database/OS caches; external basemap imagery blocked.                                                                                                                          |

The default service worker was enabled in the final 50-sample profile. London browser-cold p95 was **687 ms desktop** and **596 ms at the mobile viewport** (five cold samples each). City-switch p95 was **314 ms desktop** and **262 ms at the mobile viewport** (20 switch samples each). All samples made zero complete inventory asset requests online. These measurements use a running API and warm or uncontrolled database/OS caches, unshaped networking, and blocked external map tiles. They do not validate hosted wake-up or a physical phone.

Network byte totals are incomplete: some responses omit Content-Length, and Chromium's asynchronous service-worker size measurement stalled. The report records advertised lengths and missing-length counts; do not use those partial cold-start sums as total transfer sizes. The earlier service-worker-blocked profile and incomplete instrumentation run are retained separately.

The first browser attempt also recorded a Porto `0007` search timing out at the server's 2.5-second work limit. It did not recur in the final six journeys. Three direct repeats returned all five expected records in 53–74 ms. [The timeout review](verification/porto-timeout-review.md) retains the request, trace link, and SQL observations. The original cause remains unconfirmed; no SQL or timeout limit was changed to conceal it.

The documented build/start/health/stop workflow also passed: see [`verification/launcher.json`](verification/launcher.json). It took 12.8 seconds including TypeScript and the production build; this is setup time, separate from browser loading. The local HTTP listener closed, no API reader sessions remained, and PostgreSQL stayed running: [`verification/cleanup.json`](verification/cleanup.json). Both original app checkouts remained clean; the public Tree Atlas commit stayed `8fb090145c0852a83dec1038fa663e7ba15e0de3`. No commit, push, or deployment was made.

The 12 focused tests are part of the 63-test suite, not an additional 12. Loading profiles have separate reports and completion criteria; the six correctness journeys do not establish a latency percentile.

### Review findings resolved in this step

- A cancellation callback could abort at the final saving progress update before the transaction listener attached. The store now checks cancellation again at that boundary, with a regression proving the prior pack remains intact.
- Damaged pack metadata could prevent the recommended repair download. Replacement now uses the authoritative frozen package plan and activates only after a complete validated transaction.
- TanStack Query could pause local work when the browser reported no network. Query configuration now permits the cached catalogue and offline worker queries to run; an actual offline browser refresh passed afterwards.
- Catalogue preparation now takes complete city metadata from the frozen lock. Bounds, located counts, and attribution cannot drift merely because the original checkout's manifest later changes.

## Remaining work after the local pilot

- Evaluate measured local results and fix any failures before considering a hosted pilot.
- Run shaped network/CPU and physical-device tests; validate the three-second target with real service wake-up conditions.
- Add encrypted cancellation fault coverage and production ingress/authentication/operations design.
- Design refresh scheduling and release publication. A monthly refresh is plausible, but additions, changed fields, deletions, source timestamps, and licence changes need explicit rules and new validation before activation.
- Test backup/restore and rollback before deployment. This frontend launcher is not a production process manager.

No monthly source fetch, new inventory import, hosting, push, purchase, or deployment was performed by this frontend step.
