# Branch validation — 19 November 2026

Branch: `pilot/carbon-postgres-local`. Base: `8fb090145c0852a83dec1038fa663e7ba15e0de3`.

This is a source-control and relocation checkpoint. It does not activate the backend publicly or certify production readiness. Both existing public application implementations, release assets and deployment workflows remain byte-identical to the base. The only new root files are pilot-specific `.eslintignore` and `.prettierignore` exclusions; pilot checks run separately.

## Fresh checks

| Check | Result |
| --- | --- |
| Asset-input and explicit tool-reuse setup | **9 regression tests passed**; idempotency, collisions, symlink parents and missing prerequisites checked |
| Frozen reference | **99 literal assertions**, 9 search mutation sentinels, 7 bad-response sentinels and 3 independent wire hashes passed |
| Frozen public assets | **All 10,961 asset hashes passed** through the relocated data-only input link |
| Relocated native build | Carbon/native inventory executable rebuilt successfully in this branch's own `build/` directory |
| Frontend source checks | Strict TypeScript, type-aware Oxlint, Oxfmt and **63 regression tests passed** |
| Browser normalizer | **1,132,086 reference cases passed**, using pinned Unicode 17 rules |
| Production frontend build | Passed; existing >500 kB bundle advisory remains |
| Real browser journeys | **6/6 passed**, including four-city online search/details, stale response rejection, API outage, saved-release error, coincident cluster selection, complete Porto offline refresh/search/area/saved details/eviction |
| Public lint isolation | Actual `oxlint --debug=files` excludes the pilot |
| Public formatting check | Passed with the new root exclusion; no sealed or experimental source formatted by the public command |
| Committed source inspection | `scripts/verify-source-import.py` checks the Git blobs, preserved reference/archive hashes, unchanged baseline paths and absence of symlink/binary artifacts |

Installed dependencies were reused through explicit ignored links on this WSL machine; source/reference inputs use the versioned branch layout. A fresh-machine toolchain installation and restore are **not** established by these checks. The database schema, query functions, canonical records and private configs were not changed or reimported. Test-owned HTTP services were stopped after the browser run.

## HTTP conformance is currently red

Two fresh invocations of `verification/http-conformance.mjs --quick` did **not** complete successfully:

1. London `one-character`, first page: **504 timeout**.
2. London `rare-genus`, first page: **504 timeout**.

The first invocation overlapped the final source-asset audit. The second started after that audit finished. This does not establish the cause; do not attribute the failures to relocation or machine contention without phase evidence. Do not call the quick suite passed because browser journeys or historical full enumeration passed.

The runtime/source semantics and 2,500 ms query budget were retained. No deadline was relaxed, result set truncated or SQL optimized to hide the failures. The historical full HTTP conformance and timing results remain labelled as 8 November evidence in `historical/`; they are not fresh results for this branch.

The first next engineering task is controlled London query profiling: distinguish connection wait, summary construction, page fetch, plan selection, cold database/cache state and cancellation. Compare the original and branch executable under the same conditions if attribution is needed. Retain counts/order/release identity and bounded errors while investigating.

## Reproduce and inspect

From the repository root in WSL:

```sh
export PATH=/home/david/.nvm/versions/node/v26.13.0/bin:$PATH
python3 experiments/local-pilot/scripts/prepare-workspace.py
python3 -m unittest discover -s experiments/local-pilot/scripts -p 'test_*.py' -v
python3 experiments/local-pilot/scripts/verify-source-import.py
node experiments/local-pilot/tree-atlas-contract-v1/verify-freeze.mjs --assets
```

After dependency setup, run `python3 verification/check-local.py` from the isolated frontend directory. Start the local launcher in another terminal and run:

```sh
node_modules/.bin/playwright test --config verification/playwright.local.config.ts --grep-invert 'loading profile'
```

This runs the six correctness journeys; it deliberately does not claim a fresh 50-sample performance run. Current raw logs/reports are ignored under `.verification/` and the component runtime report locations. Historical snapshots are separately archived with SHA-256 inventories. Do not commit fresh machine-specific build logs or raw browser traces.

Not rerun at this relocation checkpoint: full 16,576-page HTTP enumeration, synthetic held-EOF/TLS faults, staged database imports/full readback, physical-phone tests, shaped network tests, restore, hosted cold start or monthly source refresh. No push, hosting, purchase or deployment occurred.
