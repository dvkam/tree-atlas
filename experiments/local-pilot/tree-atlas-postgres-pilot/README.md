# Local PostgreSQL inventory staging

> **Versioned pilot branch:** Start with [the workspace guide](../README.md). This copy is under `experiments/local-pilot/tree-atlas-postgres-pilot`. Original dated sections below describe earlier checkpoints; use [branch validation](../BRANCH-VALIDATION.md) for the current relocation checks. Historical reports are archived separately; see [the evidence policy](../HISTORICAL-EVIDENCE.md). No public app or deployment changes are included.

All four frozen releases are imported and independently verified in native WSL
PostgreSQL database **tree_atlas_pilot**. They are marked `validated` locally.
There is no active catalogue, new HTTP inventory API, app connection or deployment.
The existing `tree_atlas_poc` database and both public applications are unchanged.

| Inventory | Release | Records |
| --- | --- | ---: |
| London | london-316fa121a19059da | 1,111,784 |
| Vienna | vienna-2925984ab1dd6276 | 233,102 |
| Geneva | geneva-a3456b2d943dc57d | 240,827 |
| Porto | porto-6be0471b6c303ac2 | 71,634 |

Total: **1,657,347**, all located in these particular snapshots. The actual SQL
tests also preserve a synthetic unlocated record and removed/coincident trees.
These are available inventory partitions, not every physical tree in four cities.
London retains the frozen Camden exclusion. No upstream downloads were made.

## What was done in WSL

1. Checked PostgreSQL 16.15, loopback access and available disk/RAM. No new
   package, server upgrade, PostGIS extension or server configuration was needed.
2. Ran `setup_database.py` as local WSL root. It created a separate PostgreSQL-owned
   database/schema and three nonsuperuser roles with four connections each.
   Private credentials are under `/home/david/.config/tree-atlas-postgres-pilot/`:
   directory mode 0700, files 0600, owned by david. They never enter command
   arguments or evidence files.
3. Tested constraints, roles, sealing and rollback. A deliberate Porto producer
   failure after ten canonical rows were sent retained no release or record
   prefix. During review, the seal guard was strengthened with parent-row locks
   and a deferred check that prevents any `loading` release from committing.
   The empty-database correction was applied once before the real imports;
   fresh setup already includes it. Do not rerun `harden_empty_database.py`.
4. Ran `import.mjs` under pinned Node 26.13.0 / Unicode 17.0. Each release used
   one transaction for metadata, all canonical records and its suggestion
   dictionary. Only a complete load could transition to `staged` and commit.
5. Ran the independent read-only verifier. It read every stored row and compared
   full identity/content/dictionary digests with the
   [frozen contract](../tree-atlas-contract-v1/CONTRACT.md), then checked exact SQL
   query membership and literal adversarial cases.
6. Repeated the import. All four releases returned `unchanged`, with no duplicate
   rows. Ran `validate_staged.py` as local peer administrator; it checked the
   successful report and atomically changed all four stages to `validated`.
7. Checked all records through the restricted reader and confirmed no loading
   releases or owned import/verification sessions remained. The original Carbon
   PoC fixture still contains its unchanged single synthetic row.

## Data ownership and immutability

`atlas.records` stores canonical JSONB plus exact string identity, prepared ordinal,
float8 coordinate projections and five normalized search columns. No numeric ID
conversion, deduplication, coordinate rounding, status filtering or measurement
reinterpretation is applied. `atlas.dictionary` preserves canonical first-seen
raw values in prepared order. Metadata binds the contract seal, baseline lock,
reference hashes and source evidence. Legacy import-normalizer versions remain
unknown; the search normalizer is explicitly versioned.

The loader is an acquisition/preparation tool written with Node built-ins. It
does not import reference matching/normalization helpers. This does not replace
the Carbon backend language: the Carbon HTTP experiment remains separate, and
an inventory query adapter has not been implemented yet.

| Role/config | Access |
| --- | --- |
| tree_atlas_loader / loader.json | Insert only while loading; finish a complete stage; no UPDATE/DELETE or validation privileges |
| tree_atlas_verify / postgres.json | Read staging tables in a read-only snapshot; no write or validation privileges |
| tree_atlas_reader / reader.json | Read validated views only; no base-table access or writes |
| Local postgres peer administrator | Own schema; perform guarded validation after independent checks |

Row guards lock the parent release while accepting inserts. After sealing,
record and dictionary INSERT/UPDATE/DELETE are rejected. Release metadata is
immutable; state only moves `loading → staged → validated`. A deferred constraint
rejects committing a loading release. Thus a loader cannot change data between
independent readback and validation. Trusted local superusers can override
database protections; these guards are not a defence against the administrator.

The staging loader is single-writer. Sequential identical reruns are idempotent.
Concurrent identical writers may cause the second to fail a unique constraint;
they cannot overwrite a sealed release. There is no publisher or catalogue CAS
implementation in this stage.

## Verification evidence

The full readback used one **read-only repeatable-read** transaction and passed:

- All 1,657,347 canonical records, contiguous ordinals, IDs, exact coordinate
  projections and every stored normalized field.
- Complete identity/content digests and raw/normalized suggestion dictionaries.
- All 48 frozen SQL query membership/order sets and exact viewport digests.
- 192 page slices derived from the full matching streams and 16 suggestions.
- 22 literal SQL cases, including missing positions, boundaries, punctuation,
  field separation and removed/coincident records.

There were 17 distinct database/import regressions across two invocations:
16 standard checks and the separately run intentional real-import failure. The
default suite skips that failure test once Porto is already staged. The
readback comparator also rejected 11 corrupted-output variants. The CSV fixture
checks PostgreSQL's input boundary; full actual readback proves this loader's
TEXT COPY output. These are distinct pieces of evidence.

Important files:

- `evidence/import-results.json`: initial committed staging counts/timings.
- `evidence/interrupted-import.json`: intentional producer-failure rollback.
- `evidence/idempotency-results.json`: all four identical reruns unchanged.
- `evidence/postgres-independent-verification.json`: complete independent result.
- `evidence/validated-stages.json`: guarded local transition and storage sizes.
- `evidence/final-state.json`: actual reader counts, roles and cleanup.
- `evidence/review.md`: review findings, corrections and scope.

Initial imports took about 70 seconds total. Independent full export and SQL
comparison took 80.96 seconds, reading about 9.57 million events. Database size
after validation was **1,613,061,143 bytes** (about 1.61 GB), including about
1.58 GB for records/indexes and 28.94 MB for the dictionary/indexes. This excludes
cluster WAL, temporary peaks, source files and other databases. These local
batch timings are not interactive query, mobile, hosted or cold-load benchmarks.

## Rerun locally

From this folder in WSL:

```sh
NODE=/home/david/.nvm/versions/node/v26.13.0/bin/node
"$NODE" import.mjs
"$NODE" verification/verify-postgres.mjs
"$NODE" verification/selftest.mjs
sudo python3 validate_staged.py
sudo python3 check_final_state.py
```

Existing stages are not overwritten. The loader refuses an inconsistent identity
or metadata match; errors are not empty successful imports. Database state is
immutable, but a new verification run intentionally invalidates older success
evidence until the new run completes. Logs/reports are local run evidence and
may be replaced by a rerun; preserve them first if needed.

To run rolled-back constraint/permission tests without faulting an existing city:

```sh
sudo python3 -m unittest discover -s tests -v
```

Do not rerun first-create setup against the existing database. Do not run Python
validation with `-O`: optimized execution is explicitly refused. Administrative
tools force the local Unix socket/port and discard inherited PG settings.
No credentials belong in Git or reports.

## Remaining work

The subsequent [local Carbon/native adapter](../tree-atlas-carbon-inventory-api/README.md)
now supplies pinned HTTP list/count/viewport, suggestion, detail and cancellation
operations against these validated views, with separate HTTP evidence. This SQL
verifier remains the full canonical-record evidence. The subsequent
[isolated local frontend](../tree-atlas-local/README.md) adds remote search/map
queries, complete offline city packs, saved details, a cached app shell, and
browser journeys. Its runbook explains how to start and test the local app.
PostGIS, monthly source refresh, catalogue publication, backup/restore,
encrypted cancellation faults, physical-device testing, and hosted cold-start
validation remain separate work. Local browser timings do not prove the
accepted three-second hosted performance gate.

No hosting, purchase, repository push or deployment was performed.

