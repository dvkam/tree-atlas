# Data operations

## Refresh and validate

Use the Node and pnpm versions in the README. Run `pnpm data:download`, then `pnpm data:prepare`. Preparation of the London inventory can require several gigabytes of memory. If Node reaches its heap limit, run `node --max-old-space-size=8192 scripts/prepare.ts` on a machine with enough free memory.

The downloader writes evidence for five acquisition groups. It replaces the combined provenance only after all 49 registered locations are accounted for: 44 acquired inventories and five explicit blockers. London retains an original CSV cache in `data/raw/london-original.csv`; rename or remove that cache when you intend to retrieve a fresh export. Do not treat the time of a cached import as a new source survey date.

Check each new release's `report.json`, `dataset.json` and `provenance.json`. Compare upstream counts, exclusions, missing coordinates and identity rules with the previous release. London excludes the exact `LB Camden` contributor; this is the only cross-source partition. Nottingham is not an input until an applicable redistribution licence is verified.

Run `pnpm check`, then `pnpm build`, then `pnpm test:e2e`. Browser journeys use the production preview, so rebuild after source changes before running them. Inspect the map, a known source record and a search outside the initial viewport. Browser tests use Chromium and block external map tiles. They do not test the availability of OpenStreetMap or Copernicus.

## Failed preparation

Preparation writes immutable assets one source at a time. It replaces the manifest only after every source succeeds. A failure may leave unreferenced release files. The previous manifest remains active. Fix the input or failure and rerun preparation. Identical files are accepted; changed bytes at an existing immutable path cause an error.

Do not overwrite a published release to repair data. Publish a new release. Do not delete old releases as routine cleanup: saved URLs reference them.

## Deploy and recover

Push reviewed commits to `main`. The GitHub workflow checks types, lint, formatting, unit and conformance tests, builds the app and runs browser journeys. Deployment starts only after those checks pass.

Verify the workflow result and the live manifest. Open a city, select a record and check its release. A successful local build alone does not confirm deployment.

To roll back application code, revert the faulty change and pass the same workflow. To restore a previous data selection, restore its manifest from a known commit while retaining all published release assets. Never create a second version of an existing release path.

There is no automatic refresh schedule. API availability, licences and schemas can change. The city pages in [source-apis](source-apis/index.md) identify the endpoints and evidence to check.

Diagnostic reports include the total number of records with quality notes and at most 1,000 examples. Full notes remain in every record's detail assets. This bounds report size without discarding searchable records or their evidence.

## Expansion review

Review [north and east source findings](expansion-north.md) and each [source API page](source-apis/index.md). Turin has an unresolved difference between its returned GeoJSON rows and the advertised count. Frankfurt retains three records with invalid native UTM northings as unlocated records. Do not silently replace these disclosures with a completeness claim.

The country picker exposes only entries in the final manifest. Compare its 44 entries and aggregate count with the prepared reports before deployment. Check text search while geometry is delayed, then exact area filtering after geometry loads.

For a publication that only adds sources, `node --max-old-space-size=8192 scripts/prepare.ts --reuse-unchanged` can retain existing releases. Reuse requires identical source evidence, matching immutable metadata and a valid raw checksum. London is rebuilt unless it already uses the separate text-column encoding. Omit the flag when changing normalization for existing sources.

The build checks the size of public assets against a 995 MB data budget, leaving room for application code below the GitHub Pages 1 GB site limit. Keep published snapshots. Move data hosting before exceeding that budget.
The 27 October expansion uses 893.0 MB of public assets. A future full refresh will need a storage review before publication; the size check does not remove old releases to make room.
