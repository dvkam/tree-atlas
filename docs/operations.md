# Data operations

## Refresh and validate

Use the Node and pnpm versions in the README. Run `pnpm data:download`, then `pnpm data:prepare`. Preparation of the London inventory can require several gigabytes of memory. If Node reaches its heap limit, run `node --max-old-space-size=8192 scripts/prepare.ts` on a machine with enough free memory.

The downloader writes evidence for three acquisition groups. It replaces the combined provenance only after all ten sources are present. London retains an original CSV cache in `data/raw/london-original.csv`; rename or remove that cache when you intend to retrieve a fresh export. Do not treat the time of a cached import as a new source survey date.

Check each new release's `report.json`, `dataset.json` and `provenance.json`. Compare upstream counts, exclusions, missing coordinates and identity rules with the previous release. London excludes the exact `LB Camden` contributor; this is the only cross-source partition. Nottingham is not an input until an applicable redistribution licence is verified.

Run `pnpm check`, `pnpm build` and `pnpm test:e2e`. Inspect the map, a known source record and a search outside the initial viewport. Browser tests use Chromium and block external map tiles. They do not test the availability of OpenStreetMap or Copernicus.

## Failed preparation

Preparation writes immutable assets one source at a time. It replaces the manifest only after every source succeeds. A failure may leave unreferenced release files. The previous manifest remains active. Fix the input or failure and rerun preparation. Identical files are accepted; changed bytes at an existing immutable path cause an error.

Do not overwrite a published release to repair data. Publish a new release. Do not delete old releases as routine cleanup: saved URLs reference them.

## Deploy and recover

Push reviewed commits to `main`. The GitHub workflow checks types, lint, formatting, unit and conformance tests, builds the app and runs browser journeys. Deployment starts only after those checks pass.

Verify the workflow result and the live manifest. Open a city, select a record and check its release. A successful local build alone does not confirm deployment.

To roll back application code, revert the faulty change and pass the same workflow. To restore a previous data selection, restore its manifest from a known commit while retaining all published release assets. Never create a second version of an existing release path.

There is no automatic refresh schedule. API availability, licences and schemas can change. The city pages in [source-apis](source-apis/index.md) identify the endpoints and evidence to check.

Diagnostic reports include the total number of records with quality notes and at most 1,000 examples. Full notes remain in every record's detail assets. This bounds report size without discarding searchable records or their evidence.
