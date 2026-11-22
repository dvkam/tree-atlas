# Check a published catalogue

These two readers compare the release files in a Tree Atlas checkout. They use Python 3.9+ and Node.js 24+ with their standard libraries. Run them from the repo root. The commands below select Camden, Porto and London to exercise all three search-index formats.

```sh
run_dir=$(mktemp -d)
scripts=experiments/local-pilot/scripts/catalogue-audit

python3 "$scripts/audit_records.py" --repo . --output "$run_dir/records" \
  --city camden --city porto --city london
node "$scripts/audit-map.mjs" --repo . --output "$run_dir/map" \
  --city camden --city porto --city london
```

Omit all `--city` arguments to read every inventory in the manifest. Each command needs a fresh output directory outside the checkout. Its parent must exist. Both readers refuse to reuse an earlier run. Keep the output in local storage.

- **Search and details.** The Python reader checks asset hashes, dataset and release IDs, every search row, detail ID, detail shard, coordinate and dictionary field. It reads JSON rows (v2), binary columns with embedded geometry (v3) and text columns with separate geometry (v4). It also compares the detail totals with the map catalogue. See `records/records.json`.
- **Map.** The Node reader independently reads every detail and walks the map from its root. It checks asset hashes, release IDs, tree membership, coordinates, leaf bounds, node counts and unreachable nodes. Each located detail must appear in exactly one leaf. Each detail without coordinates must stay off the map. See `map/map.json`.

Both readers write the manifest SHA-256, selected inventories and completed release IDs. A successful run exits with status 0 and sets `finished` to `true`. A structural mismatch exits with status 1. A report with `finished: false` is incomplete, even when some cities passed. Match the manifest hash and release IDs before comparing counts across runs.

`sourceQualityFlags` counts facts that need investigation, such as possible encoding damage, dates in an unexpected order or unusual dimensions. A flagged measurement can be correct. The readers compare files within a published release. Source coverage, current municipal records and front-end search behavior need separate checks. Reports contain aggregate counts. The [November 20 baseline](../../validation/public-catalogue-2026-11-20.json) has the manifest hash and per-city totals for that release.

The following test runs both commands against a one-tree fixture. One case has correctly hashed files whose IDs disagree.

```sh
python3 -B -m unittest discover -s "$scripts" -v
```
