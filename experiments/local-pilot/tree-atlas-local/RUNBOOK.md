# Local test runbook

## Before starting

Use WSL and the pinned Node installation from the README. The launcher needs PostgreSQL on local port 5432 and the existing read-only service build. It reads the private reader configuration through the backend launcher; never paste that file or its credentials into logs, Git, or a browser URL.

Run `python3 scripts/run-local.py`. Open exactly `http://127.0.0.1:4199`: a different hostname or port has different browser storage. Use `--skip-build` only when you deliberately want to reuse the last build. A development server is useful for editing, but the production preview is the offline test target.

## Check online search and the map

1. Select each city. Clear the search. The totals should be London 1,111,784, Vienna 233,102, Geneva 240,827, and Porto 71,634.
2. Search a genus, part of a location, or an ID. Follow result pages and select a record. Compare its source ID and details with the pinned release.
3. Pan and zoom. The map changes its visible count; the full-city result list stays complete unless you set an area filter. A cluster represents multiple records. Open its members and inspect their details.
4. Switch city while a search is pending. Results from the old city must not appear in the new city.
5. In browser developer tools, inspect Network requests. Online city startup must not fetch the full `text-index` or `geometry` inventory files. It should use small `/api/` responses and frontend assets.

This search matches inventory fields. It does not provide a new address/geocoding service in this pilot.

## Check offline support

1. Stay online and select Porto for a short first test.
2. Choose **Download city for offline use**. The interface shows the planned download size. Wait for **Offline pack ready**. This requires both a verified city pack and the cached app shell. Storage usage is larger than the transfer size.
3. Open a tree while the API is available. Choose **Save details for offline use** and wait for the saved confirmation.
4. Choose **Use downloaded city**. Turn your browser offline, then refresh the page.
5. Search and move the map. All 71,634 Porto records remain searchable. Open the saved tree: its full details should work. Open an unsaved tree: the interface should explain that those details were not saved.
6. Return online and choose **Use local API** to switch back. Offline mode is explicit; an API failure does not silently fall back to a partial cache.

For a reproducible offline check in Chromium, open Developer Tools, select **Network → Offline**, and then reload. The catalogue and worker searches must still run: the app configures TanStack Query to allow local work while the browser reports no connection. Leave the tools open while testing. Return the Network setting to **No throttling** afterwards.

A downloaded city includes complete searchable fields and coordinates, not every full detail record. Basemap tiles require their own connection/cache and may be blank offline. Tree geometry and filtering still work. No bulk basemap cache is included.

The pack sizes are London 16,139,261 bytes; Vienna 4,092,520; Geneva 3,845,514; and Porto 1,042,189. Validation and search run in dedicated workers. A failed or cancelled replacement leaves the prior verified pack intact. Cancelling from the final saving step must also prevent activation. A successful redownload can repair damaged local metadata or bytes.

Browser storage can be cleared or evicted. If a city pack is missing or incomplete, download it again. Do not interpret an evicted pack as an empty city. Private browsing may restrict storage. Check available browser storage before downloading London.

## Updating and clearing local storage

The local service worker keeps a coherent version of the shell. After rebuilding, close **all tabs for this local origin**, then reopen it so a waiting worker can activate. A hard refresh alone may leave the old active worker in control. The interface must not mix the old cached shell with a different catalogue.

To reset this experiment, clear site data for **127.0.0.1:4199 only** in your browser settings or developer tools. That removes downloaded city packs, saved details, mode preference, and the local service worker. It does not alter PostgreSQL or either public app. Do not clear unrelated sites.

## Automated checks

With Node on PATH, from this folder:

Run the complete recorded source checks with `python3 verification/check-local.py`. It saves individual logs and an overall result in `verification/source-checks.json`. Browser checks remain a separate command and require the running local preview.

```sh
node_modules/.bin/tsc --noEmit
node_modules/.bin/oxlint --type-aware --deny-warnings
node_modules/.bin/oxfmt --check
node_modules/.bin/vitest run
```

To rerun only offline storage, download-plan, and normalization regressions:

```sh
node_modules/.bin/vitest run tests/offline-storage.test.ts tests/offline-plans.test.ts tests/offline-normalizer.test.ts
```

To compare the pinned browser normalizer with the reference runtime, including every Unicode scalar and contextual cases:

```sh
node_modules/.bin/tsx scripts/check-frozen-normalizer.ts
```

This writes `evidence/browser-normalizer-parity.json`. Use Node 26.13.0 with Unicode 17; the script rejects another Unicode version. It verifies the generated runtime tables without changing them. Regenerate tables only when deliberately reviewing a normalizer change: `scripts/generate-frozen-normalizer.mjs` also needs the existing official ICU 78.3 files beside the Carbon pilot. A changed normalizer requires contract review rather than a silent table update.

Start the launcher in another WSL terminal before browser checks:

```sh
node_modules/.bin/playwright test --config verification/playwright.local.config.ts
```

For correctness journeys alone, append `online.spec.ts offline.spec.ts`. The separate `performance.spec.ts` run performs repeated loading measurements and can take longer. Avoid running heavy database checks or other browser profiles concurrently with a timed run.

Browser tests use the production preview, one worker, and isolated contexts. Reports are written under `verification/` and `test-results/`. Traces and screenshots are retained for failures. Test output is local evidence, not a hosted or physical-phone speed claim.

The backend has separate full HTTP-ID enumeration and PostgreSQL canonical-record checks. See its README before rerunning long checks. A browser journey does not replace those independent checks.

## Performance interpretation

Measure a fresh browser context with empty HTTP cache. Record navigation-to-correct-result time, transfer bytes, and main-thread long tasks. Repeat across cities and city switches. Report medians and p95, not just the fastest run. Keep the query, city pin, browser version, viewport, CPU/network settings, database state, and basemap treatment with each report.

The agreed first-search target is three seconds, including an idle service wake-up. Local tests with an already-running database and service do not prove that hosting target. Desktop mobile emulation is not a physical phone. Blocked external map tiles exclude basemap loading from measured results. Offline download/validation time is a separate operation from online first search.

## If startup fails

- Port 4199 in use: stop the earlier local launcher, or choose `--port 4200` and use the matching URL. Browser test base URL can be set with `TREE_ATLAS_LOCAL_URL`.
- API unavailable: inspect the launcher terminal, confirm PostgreSQL is running, and check the backend's private configuration permissions without displaying its contents.
- Missing dependency binary: reinstall this folder's Linux dependencies in WSL. Do not modify the public checkout.
- Old UI after build: close all local tabs to activate the waiting service worker.
- Download fails or is cancelled: keep the previous verified pack; retry online after checking storage. A partial download must not be labelled ready.

To verify the documented build/start/health/stop sequence automatically, stop your manual launcher first, then run `python3 verification/check-launcher.py`. It uses port 4199, stops its own child services, and saves `verification/launcher.json` and `verification/launcher.log`. It leaves PostgreSQL running.
