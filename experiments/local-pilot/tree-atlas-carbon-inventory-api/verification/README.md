# Independent Carbon inventory HTTP checks

These tests launch the actual local `build/service`, read the validated releases
through HTTP, and compare responses with the sealed canonical reference. They
do not import the native adapter, its SQL functions or its Unicode helper.
Credentials stay in the private WSL reader config and child environment.

After building the service and installing its read-only SQL functions, run from
this folder's parent in WSL with Node 26.13.0:

```sh
NODE=/home/david/.nvm/versions/node/v26.13.0/bin/node
"$NODE" verification/http-conformance.mjs --quick
"$NODE" verification/http-conformance.mjs
```

Both modes check 192 selected HTTP pages across all 48 frozen query cases,
including exact ordered IDs, full/located/viewport counts, query keys, release
fingerprints and caller correlation. They check all 16 frozen suggestion cases,
eight complete canonical detail records, small filtered full ID sets, and exact
cluster-member/viewport paging for three small nonempty queries. World viewports
force those small sets into clusters, allowing complete member union checks.

The default mode additionally enumerates every 100-row unfiltered page for all
four inventories and recomputes the full ordered identity digest from actual
returned IDs. This proves all 1,657,347 records are reachable through unfiltered
HTTP pagination. Quick mode explicitly reports that enumeration as not run.
Neither mode claims full enumeration of every broad filtered HTTP match set or
every city cluster; the staged SQL verifier separately covers those query sets.

Run the smaller input/error/correlation tests separately:

```sh
python3 -m unittest discover -s tests -v
```

Real active-query cancellation, deadlines, resets and legitimate half-close use
owned local table locks. They require explicit opt-in and WSL root peer access:

```sh
sudo env TREE_ATLAS_HTTP_FAULTS=1 python3 -m unittest discover -s tests -v
```

Do not run these lock faults alongside index builds, SQL profiling or another
HTTP suite. The helper locks `atlas.records` in a transaction, waits until actual
API SQL is blocked, then verifies cancellation/timeout/reset behavior. It never
changes canonical records. Cleanup rolls back the owned lock transaction and
checks service/pool shutdown. Half-close coverage deliberately holds a detail
response for 250 ms before unlocking, so a false abandonment decision is visible.

`http-conformance-quick.json` / `http-conformance.json` under `../evidence/` start
with `passed:false`; success is written only after comparisons and clean process
shutdown. Recorded HTTP latencies include attempt reservations and report raw
samples. They are local, warm-database observations, not physical-phone, shaped
network, hosted cold-start or offline-browser evidence. Service startup time is
reported separately. No deployment or upstream source access is performed.
