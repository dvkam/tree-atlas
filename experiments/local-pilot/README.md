# Local Carbon / PostgreSQL / frontend pilot

This directory versions the isolated four-inventory pilot without changing the
public Tree Atlas application. The public application still uses its existing
static releases. This pilot runs locally in WSL and has no deployment step.

The five sibling directories retain their original interfaces:

- `tree-atlas-contract-v1`: sealed search/release contract and independent oracle.
- `tree-atlas-carbon-poc`: pinned compiler/native integration and synthetic tests.
- `tree-atlas-postgres-pilot`: staging schema, importer and independent SQL checks.
- `tree-atlas-carbon-inventory-api`: read-only Carbon/native query application.
- `tree-atlas-local`: separate frontend, remote client and complete offline packs.

Read [the current branch validation](BRANCH-VALIDATION.md) and [next steps](NEXT-STEPS.md). London query fixes pass full four-city HTTP conformance. Complete offline browser journeys pass for all four cities, with a substantial London memory risk. The [clean userspace and restore procedure](CLEAN-ROOM.md) tests fresh dependencies separately from the tool-reuse setup below.

The pilot preserves London, Vienna, Geneva and Porto: **1,657,347 records**.
Offline city downloads contain complete searchable fields and exact positions;
full details work offline only when explicitly saved. Street tiles are separate.

## Prepare the asset input

From the repository root, in WSL:

```sh
python3 experiments/local-pilot/scripts/prepare-workspace.py
python3 -m unittest discover -s experiments/local-pilot/scripts -p 'test_*.py' -v
```

Preparation creates only the ignored compatibility input
`experiments/local-pilot/tree-atlas/public/data`, a relative directory symlink to
this checkout's `public/data`. Existing code and the sealed reference expect this
sibling path. The script refuses unexpected existing files/directories/links; it
does not delete or replace them. No inventory is copied, fetched or republished.

Only the data directory is linked, not the entire repository. This avoids a
recursive checkout alias. Treat the input as read-only: imports and offline
preparation read it; no source-acquisition or public refresh is part of this task.

Keep every sealed contract file byte-identical. Do not rerun `freeze-baseline.mjs`
or `seal-freeze.mjs` against the branch to regenerate the original baseline.
Verify it with the pinned runtime instead:

```sh
export PATH=/home/david/.nvm/versions/node/v26.13.0/bin:$PATH
node experiments/local-pilot/tree-atlas-contract-v1/verify-freeze.mjs --assets
```

## Start and test

Native WSL PostgreSQL, the validated pilot database, the private reader
configuration, and the pinned Carbon/libpq/ICU dependencies must already exist.
They are not installed or recreated by asset preparation. Private credentials
stay outside Git under the existing user's WSL configuration directory.

On this machine, the installed compiler, libpq, ICU and Linux frontend dependencies
can be reused explicitly without copying them into Git. From the repository root:

```sh
python3 experiments/local-pilot/scripts/reuse-local-tools.py \
  /mnt/c/Users/David/Documents/Codex/2026-10-26/i-ve-carefully-studied-the-provided-9/outputs
```

This optional command creates only ignored links to four preinstalled dependency
directories. It preflights every target and refuses existing different installs or
links. It does not link source code, build outputs, private configuration or data.
The original installed tools remain external runtime dependencies of this reuse
mode. A clean machine instead needs the pinned fetch/build and dependency-install
recipes in the component documentation.

After preparing dependencies, build the branch's inventory executable in its own
folder; do not reuse an older executable:

```sh
cd experiments/local-pilot/tree-atlas-carbon-inventory-api
python3 tools/build.py
cd ../tree-atlas-local
```

The frontend command from its directory is:

```sh
python3 scripts/run-local.py
```

It builds the isolated frontend and starts its read-only Carbon child and local
preview. Open `http://127.0.0.1:4199`; keep the terminal open. Ctrl+C closes both
HTTP processes and leaves PostgreSQL running. The original sibling source experiments
outside this repository are retained as earlier local artifacts. Source/reference
inputs use the versioned layout; only the explicitly selected installed dependency
directories can be external in reuse mode.

The component runbook explains source, HTTP, browser, offline and loading checks.
Historical evidence is not a fresh branch verification result. Use the branch's
new test evidence to distinguish rerun checks from preserved reports. Local
measurements do not prove physical-phone or hosted cold-start performance.

The public root's new `.eslintignore` and `.prettierignore` exclude this pilot
from the public application's lint/format program. The pilot has its own checks.
TypeScript, Vitest and the public build already use explicit public source paths.
This also prevents a public format command from rewriting the sealed oracle.

These local run instructions do not publish source or data, refresh municipal
sources, purchase hosting, or deploy the app. A successful push to public `main` would trigger Pages;
keep this experiment on its separate local branch until publication is requested.
