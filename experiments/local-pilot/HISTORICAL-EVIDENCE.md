# Historical evidence and fresh runs

This branch retains selected original reports from the local work on **7–8 November 2026** under [historical/](historical/). They are a historical snapshot, not a claim that the relocated branch has just passed those checks. [historical/index.json](historical/index.json) lists all 42 retained report files and their SHA-256 digests. Original source copies and unselected raw logs remain outside Git.

The sealed contract is the exception: all 22 files in `tree-atlas-contract-v1` remain in place and byte-for-byte unchanged. Its reference evidence and one-time seal must not be moved, edited or resealed to update progress.

## Where reports live

For each unsealed component, an old report path now maps to the same path below `historical/`:

| Historical result | Retained report |
| --- | --- |
| Carbon lifecycle and cancellation | [historical/tree-atlas-carbon-poc/evidence/verification.json](historical/tree-atlas-carbon-poc/evidence/verification.json) |
| Verified-TLS cancellation fault | [historical/tree-atlas-carbon-poc/evidence/cancel-transport-tls.json](historical/tree-atlas-carbon-poc/evidence/cancel-transport-tls.json) |
| Complete canonical PostgreSQL comparison | [historical/tree-atlas-postgres-pilot/evidence/postgres-independent-verification.json](historical/tree-atlas-postgres-pilot/evidence/postgres-independent-verification.json) |
| Final inventory HTTP binding | [historical/tree-atlas-carbon-inventory-api/evidence/http-final-binding.json](historical/tree-atlas-carbon-inventory-api/evidence/http-final-binding.json) |
| Local HTTP performance | [historical/tree-atlas-carbon-inventory-api/evidence/http-performance.json](historical/tree-atlas-carbon-inventory-api/evidence/http-performance.json) |
| Native Unicode parity | [historical/tree-atlas-carbon-inventory-api/unicode/parity-results.json](historical/tree-atlas-carbon-inventory-api/unicode/parity-results.json) |
| Frontend source checks | [historical/tree-atlas-local/verification/source-checks.json](historical/tree-atlas-local/verification/source-checks.json) |
| Six browser correctness journeys | [historical/tree-atlas-local/verification/browser-journeys-summary.json](historical/tree-atlas-local/verification/browser-journeys-summary.json) |
| Browser loading observations | [historical/tree-atlas-local/verification/browser-loading.json](historical/tree-atlas-local/verification/browser-loading.json) |

Fresh builds/tests continue to write to their normal `evidence/` and `verification/` paths. Those generated reports and logs are ignored, so rerunning tests cannot silently replace the committed historical snapshot. Empty runtime evidence directories have a tracked `.gitkeep`. Source files, fixture JSON, browser TypeScript configuration, frontend public configuration and generated Unicode runtime tables remain versioned.

Two reports were reduced to explicit summaries without changing the originals:

- [HTTP conformance summary](historical/tree-atlas-carbon-inventory-api/evidence/http-conformance-summary.json) records the original full report's SHA-256 and selected comparison counts. The original 3.5 MB, 16,576-page ledger remains outside Git. The final binding/summary retain its historical identity and counts. A fresh full `verification/http-conformance.mjs` run generates a new ledger; quick mode is not full enumeration.
- [Browser journey summary](historical/tree-atlas-local/verification/browser-journeys-summary.json) records the original six-pass report's SHA-256, date, aggregate stats and errors without its machine-specific Playwright config/paths. The raw original report and failure trace remain outside Git.

Historical binding files refer to some omitted build/log files. Their hashes describe the original execution, not the relocated build. They are not instructions to commit binaries or claims that all referenced files are stored here. The original setup READMEs and review notes may mention runtime report paths: consult the archive mapping above for recorded results.

Workstation build command logs, screenshots, traces, duplicate failed-run ledgers, downloaded packages and compiled artifacts were excluded. The existing private WSL database configurations remain external prerequisites; no password contents, environment dumps, private certificates, PostgreSQL data directory or database backup is included.

`tools/record_run.py` binds a complete prior API run, including its detailed HTTP ledger and compiled binary. It cannot run from historical summaries alone. The PoC's `tools/record-service-status.py` and `tools/update-plan-status.py` are one-off historical HTML-plan updaters, not required build/test/start commands; the old sibling HTML plan is not part of this import.
