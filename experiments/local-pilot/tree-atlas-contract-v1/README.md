# Frozen local pilot contract

[CONTRACT.md](CONTRACT.md) freezes search, identity, release publication and
complete-offline requirements for London, Vienna, Geneva and Porto. The baseline
is **1,657,347 existing records** at app commit
`8fb090145c0852a83dec1038fa663e7ba15e0de3`. No source acquisition, database import,
application change or deployment is part of this folder.

The contract preserves field-by-field literal substring search, prepared order,
offset pages, exact selected-area counts and saved-release links. It explicitly
requires locale-independent Unicode 17 matching and separates exact viewport
counts from cluster representation. These are frozen requirements for the new
adapters; the untouched legacy app does not yet implement every v1 field or
offline capability.

## Files and evidence

- `baseline.lock.json`: release identities, metadata, source commit and hashes.
- `freeze-v1.json`: one-time content seal of the contract, reference code,
  literal fixtures, baseline evidence and review results.
- `reference/fixtures.json`: hand-authored answers, including missing positions,
  punctuation, multilingual text, boundaries, removed and coincident records.
- `reference/reference-results.json`: complete canonical-record digests and
  independent real-release search, pagination and suggestion expectations.
- `evidence/source-asset-audit.json`: 10,961 asset hashes and byte sizes, totalling
  130,283,815 stored bytes; shared global manifest/provenance are pinned separately.
- `lifecycle-cases.json`: future catalogue/offline/browser expected outcomes.
  These cases have not been run against an implemented adapter.
- `evidence/review-results.json` and `evidence/review.md`: findings and decisions.

The reference interpreter uses Node built-ins only. It does not import the app's
matcher, normalizer, SQL, source importer or binary index decoder. Literal
expected answers and mutation sentinels guard the specification. A separate
reader verifies existing detail JSON shards and derives full-set expectations;
it does not claim the upstream acquisition itself was complete or correct.

## Run locally in WSL

The available reference runtime is Node **26.13.0**, Unicode **17.0**, ICU **78.3**.
The default Windows Node is older and must not be used for this frozen oracle.
From this folder in WSL:

```sh
NODE=/home/david/.nvm/versions/node/v26.13.0/bin/node
"$NODE" verify-freeze.mjs
"$NODE" verify-freeze.mjs --assets
```

The first command verifies sealed local artifacts and reruns the literal and
candidate-checker self-tests. The second also reads and hashes all pinned
inventory assets. Python 3 verifies three literal query-key hashes independently.
Neither command connects to PostgreSQL or the network.

To rerun the full canonical audit without overwriting frozen evidence:

```sh
"$NODE" reference/audit-baseline.mjs baseline.lock.json \
  ../tree-atlas/public/data /tmp/tree-atlas-reference-rerun.json
```

Compare semantic digests/counts/cases with the frozen report; elapsed time is
observational and can differ. Query pages labelled `cohort-midpoint-offset` use
half the cohort size as their offset and can be empty for filtered queries.
They do not claim to be the midpoint of that filtered match set. Later performance
benchmarks must also exercise actual matching-set middle pages.

Do not rerun `freeze-baseline.mjs` or `seal-freeze.mjs` to bless a changed source
silently. A revised contract/baseline gets explicit review and a new version.
The seal is local integrity evidence, not a digital signature or proof against
an attacker who can replace the entire directory.

## Future adapter checks

`reference/compare-candidate.mjs` accepts the frozen report and an NDJSON export
of actual paginated responses:

```sh
"$NODE" reference/compare-candidate.mjs \
  reference/reference-results.json /tmp/candidate-responses.ndjson
```

Each line is `{dataset, release, case, request, response}`. `case` is the exact
reference query name. `request` carries q/area/viewport/zoom/offset/limit plus a
nonempty requestKey. Enumerate every matching row from offset zero with limits
1–100; cases may interleave but each case's pages must be ordered and contiguous.
Include one empty page for zero-result cases. `response` carries contractVersion,
dataset/release, echoed requestKey, queryKey, exact total/locatedTotal/
viewportLocatedTotal and items with dataset/sourceId. The checker recomputes
the full ordered identity digest from actual returned IDs. It does not trust a
candidate's claimed digest or matching count alone.

This comparator proves only the list/count/correlation portion of the interface.
Details, exact geometry, cluster member expansion, release staging and browser
offline journeys need their own interface checks. Its synthetic negative tests
are not a backend conformance pass.

Offline remains required: complete text/geometry search and filtering for a
pinned city release, compatible app shell, atomic pack activation, and saved
full details. No offline basemap imagery is promised. The existing cache is not
a complete pack.

Next: implement isolated staging imports against this freeze, then validate
complete identity/content and public query behavior before connecting the app.
PostgreSQL/PostGIS inventory, remote adapter, offline pack and browser checks are
**not run** in this contract-freeze step. No deployment is included.
