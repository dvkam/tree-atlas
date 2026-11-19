# Local Tree Atlas frontend pilot

> **Versioned pilot branch:** Start with [the workspace guide](../README.md). This copy is under `experiments/local-pilot/tree-atlas-local`. Original dated sections below describe earlier checkpoints; use [branch validation](../BRANCH-VALIDATION.md) for the current relocation checks. Historical reports are archived separately; see [the evidence policy](../HISTORICAL-EVIDENCE.md). No public app or deployment changes are included.

This copy connects the Tree Atlas interface to the local Carbon/native HTTP service and the validated PostgreSQL releases. It is separate from the public app. Nothing in this folder deploys, publishes data, or changes the public repository.

The pilot includes London (1,111,784 records), Vienna (233,102), Geneva (240,827), and Porto (71,634): **1,657,347 records**. These are frozen releases, not live municipal feeds. API adapters and spreadsheet imports feed validated releases first; the browser does not forward searches to municipal services.

## Start it yourself

Open **Ubuntu/WSL**, then run:

```sh
cd "$(git rev-parse --show-toplevel)/experiments/local-pilot/tree-atlas-local"
export PATH=/home/david/.nvm/versions/node/v26.13.0/bin:$PATH
python3 scripts/run-local.py
```

Open <http://127.0.0.1:4199> in your Windows browser. Keep the WSL terminal open. Press **Ctrl+C** to stop the frontend and Carbon process. PostgreSQL remains running. The launcher builds a production frontend, starts the dedicated read-only API, discovers its port, and starts a loopback-only preview. It does not install PostgreSQL or alter inventories.

If dependencies are missing:

```sh
npm exec --yes --package=pnpm@11.25.0 -- pnpm install --frozen-lockfile --ignore-scripts
```

This folder has Linux dependencies of its own. Do not share the public app's Windows `node_modules` folder. Node 26.13.0 is pinned for reproducible builds and Unicode checks. The existing Carbon executable, local PostgreSQL cluster, validated records, and private reader configuration are prerequisites. See [PostgreSQL setup and evidence](../tree-atlas-postgres-pilot/README.md) and [Carbon API setup](../tree-atlas-carbon-inventory-api/README.md). Do not rerun initial database creation against the existing database.

Read [the test and offline runbook](RUNBOOK.md) for manual checks, automated checks, and limitations. Read [the work record](WORK-RECORD.md) for what was built and what remains.

## Data paths

- **Local API:** The browser requests counts, small result pages, map clusters, suggestions, and selected details. PostgreSQL holds the full inventory. Starting a city does not download its complete browser index.
- **Downloaded city:** An explicit download contains every searchable record and coordinate in that pinned city. A worker verifies and searches the pack. The app saves a ready marker only after the complete pack passes validation and its storage transaction commits.
- **Saved details:** Full detail records are saved separately when you choose to save them. Unsaved details have an explicit offline error. Search results and map membership remain complete.
- **App shell:** A service worker caches this local build. It does not cache API POST responses or bulk-download OpenStreetMap tiles. City-pack readiness and shell readiness are separate checks.

The complete pack downloads are London **16,139,261 bytes**, Vienna **4,092,520 bytes**, Geneva **3,845,514 bytes**, and Porto **1,042,189 bytes**. Each includes its descriptor, complete search index, and exact coordinates. It excludes full detail shards and basemap tiles. The interface quotes the download size before starting; browser storage and decoded worker memory need more space.

The local Vite server reads only assets for the four pinned releases from the existing public checkout. It cannot serve arbitrary inventory paths. This avoids another copy of the large releases while keeping public source files unchanged.

TanStack Query handles request state; TanStack Router keeps city/search/selection in the URL. React Strict Mode remains enabled. Abort/dispose handling prevents development remounts or city switches from applying stale responses. The React compiler remains enabled in the Vite configuration.

## Release and correctness rules

Each online response must match the requested city, release, content fingerprint, request key, and independently calculated query key. Errors remain errors. A stale release is not replaced with a newer release without a user action. API and offline modes have separate sessions and query keys; a cached API result is not presented as an offline search.

Search uses the frozen Unicode 17 rules. The browser includes pinned normalization tables instead of relying on its own Unicode version. The result list covers the full city or selected area. Map viewport counts and cluster membership have separate meanings: moving the map does not silently reduce the full-city search list.

No hosting, deployment, monthly refresh, upstream source change, or production authentication is included in this local experiment.

The current correctness evidence is **63 unit/integration tests**, including **12 focused offline tests**, **six browser journeys**, and **1,132,086 normalization comparisons**. See [the evidence table](WORK-RECORD.md#correctness-evidence-recorded-on-8-november-2026) for scope and reports. These checks do not establish cold hosted-server latency or municipal data completeness.
