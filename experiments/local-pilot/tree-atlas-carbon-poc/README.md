# Local Carbon feasibility PoC

> **Versioned pilot branch:** Start with [the workspace guide](../README.md). This copy is under `experiments/local-pilot/tree-atlas-carbon-poc`. Original dated sections below describe earlier checkpoints; use [branch validation](../BRANCH-VALIDATION.md) for the current relocation checks. Historical reports are archived separately; see [the evidence policy](../HISTORICAL-EVIDENCE.md). No public app or deployment changes are included.

**Current status:** the local checkpoints add persistent libmicrohttpd
HTTP handling, a two-connection PostgreSQL pool, reset/deadline cancellation,
absolute HTTP phase limits and bounded server-issued attempt tokens. See [SERVICE.md](SERVICE.md) for the current
contract, native package changes and blockers. The cancellation follow-up uses
an isolated libpq 17.11 client and retains PostgreSQL server 16.15. Its fault
regressions check bounded HTTP completion and pool recovery while plaintext or
verified-TLS cancellation EOF is withheld. Remaining limits and expansion gates
are listed in SERVICE.md. The setup
history below records the first stage.

This isolated experiment proves that the pinned Carbon compiler can build and run
a program that accepts localhost HTTP, parses UTF-8 JSON, calls real PostgreSQL
with bound parameters, and returns JSON. It uses synthetic data only.

The application lives in Carbon. `src/poc_support.h` provides C/C++ compatibility
helpers for POSIX sockets, a deliberately restricted one-request HTTP envelope,
json-c and libpq. It is not a pure-Carbon HTTP library or a production backend.
No existing Tree Atlas application files were changed. Nothing was deployed.

## PostgreSQL setup: exactly what was done in WSL

1. Checked WSL: Ubuntu 24.04, x86-64. No PostgreSQL server, libpq development
   library or database cluster existed. Docker's engine was stopped. We used
   native Ubuntu packages after the user explicitly requested native WSL setup.
2. Updated the configured package indexes, then installed these packages from
   Ubuntu repositories, using WSL root:

   ```sh
   apt-get update
   DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
     postgresql-16 postgresql-client-16 libpq-dev libjson-c-dev
   ```

   The transaction installed ten packages, about 176 MB; it upgraded no existing
   packages and removed none. PostgreSQL/client/libpq version: 16.15. json-c: 0.17.
   Package-manager prerequisites include PostgreSQL common tools and LLVM runtime.
3. Ubuntu's package setup initialized and started cluster `16/main`. Its data is
   in `/var/lib/postgresql/16/main`, configuration in `/etc/postgresql/16/main`,
   and log in `/var/log/postgresql/postgresql-16-main.log`. We also invoked
   `pg_ctlcluster 16 main start` and checked cluster state.
4. Verified `SHOW listen_addresses` returns `localhost` and `ss -lnt` shows the
   actual listener at `127.0.0.1:5432`. No public listen address was enabled.
   Local socket authentication uses peer; TCP authentication uses SCRAM-SHA-256.
5. Ran `tools/setup_postgres.py` as WSL root. It created database and login
   `tree_atlas_poc`, a generated password, a four-connection limit, a two-second
   SQL statement timeout and a one-second lock timeout. A single synthetic
   `public.poc_probe` row contains ID `0007` and label `Platane – Zürich 🌳`.
   This first-create script refuses to overwrite an existing role/database/config.
6. Tightened the initial role using `tools/restrict_postgres.py`: database and
   table owner is `postgres`; the application role gets CONNECT, schema USAGE
   and fixture SELECT. PUBLIC database privileges and public schema CREATE were
   revoked for this new dedicated database. Tests prove INSERT and CREATE TABLE
   fail for the runtime role. The fresh-setup script now creates these restricted
   grants directly.
7. Saved credentials outside the Windows workspace at
   `/home/david/.config/tree-atlas-carbon-poc/postgres.json`, owned by `david`,
   mode `0600`, within a `0700` directory. Passwords are not in source, command
   arguments, result JSON or this document.
8. Verified authenticated reads, denied writes, and the complete Carbon HTTP
   path. PostgreSQL remains running locally for follow-up work. HTTP probe
   processes shut down after their one request; no HTTP server is left running.

PostGIS has not been installed. It is unnecessary for this first connectivity
proof and belongs to a later, separately scoped inventory/spatial stage.

Run these inside WSL to inspect/start/stop the local cluster:

```sh
pg_lsclusters
pg_isready -h 127.0.0.1 -p 5432
sudo pg_ctlcluster 16 main start
sudo pg_ctlcluster 16 main stop
sudo -u postgres psql -X -d tree_atlas_poc
```

Ubuntu enabled its normal PostgreSQL service. It can start when this WSL distro
starts under systemd. The files persist when WSL stops. No Windows PostgreSQL
service or Docker container was created. Avoid running the creation script again
to manage an already-created database; it deliberately refuses that operation.

### Preliminary files that are not used

Before the native-WSL clarification, an environment agent downloaded/extracted
Ubuntu packages into `tools/debs` and `tools/sysroot`. No portable cluster was
initialized. These unused copies remain local; builds now use the native
`/usr/include/postgresql` and system json-c/libpq, not that extracted sysroot.

## Carbon installation and reproducibility

Only the official Carbon toolchain was downloaded into this PoC directory.
It was not added to system PATH. The pinned release is
`v0.0.0-0.nightly.2026.11.07`, reported compiler revision `ca18985`.

Archive SHA-256:

```text
5ba8e554dfec058bdad8eace18591125d1f06857005de6f4ed3706a735245c22
```

The archive hash matched the GitHub release asset digest before extraction.
`evidence/releases.json` retains the official release metadata.

Inside WSL:

```sh
cd "$(git rev-parse --show-toplevel)/experiments/local-pilot/tree-atlas-carbon-poc"
python3 tools/verify.py
```

The verifier builds and runs the hello program twice, compares binary hashes and
output, checks rejection of invalid Carbon source, then exercises real JSON,
parameterized PostgreSQL and the HTTP test suite. It reads credentials privately.
It writes reproducible evidence under `evidence/`.

## What the HTTP probe does

The compiled `http_probe` binds an ephemeral IPv4 loopback port and announces
`PORT <number>`. It accepts one request, closes the listener, handles the request,
and exits. Tests start a fresh process for each case.

`POST /probe` accepts a JSON object containing a string `value`. Carbon selects
the literal SQL statement; a narrow pointer-array adapter calls `PQexecParams`.
The response returns the exact database-echoed value, database name and fixture
label. No input is concatenated into SQL. Body limit: 2,048 bytes; received frame
limit: 4,096 bytes. Transfer encoding and pipelining are deliberately unsupported.

Receive and send phases each have a 1.5-second monotonic deadline. These are
phase deadlines, not a single deadline across connection establishment and SQL.
PostgreSQL connection and statement timeouts are separate. This is not evidence
that the planned complete application meets its three-second target.

## First checkpoint results and limits, retained as history

See `evidence/verification.json`, `evidence/tests.log` and
`evidence/postgres-setup.json`. Twenty HTTP tests and three actual PostgreSQL
permission/read checks passed. The JSON and direct parameterized-query probes
also run independently. Unicode, escaped strings, leading zeros, SQL-looking
text, invalid JSON, bad credentials and unavailable database paths are covered.

Two independent reviewers found a per-read timeout gap and an initially
overprivileged fixture owner. Both were fixed. The slow-client test failed
against the old binary (`evidence/deadline-regression-before.log`) and passed
after rebuilding. Both reviewers reported no remaining blocker for this limited
feasibility scope; they did not establish production readiness.

Resolved compiler limitations: inferred `auto` is unimplemented; nullable C
pointers require explicit `Core.Optional`; libpq enum casts need integer-returning
helpers; adjacent string literals were replaced with one literal. These are
documented compatibility costs, not reasons to silently switch languages.

At that first checkpoint, before expanding we needed to select/validate a real HTTP stack and concurrency model,
connection pooling and SQL cancellation, bounded end-to-end requests, complete
release imports, spatial queries and inventory-scale performance. Those C1/pilot
acceptance items were unverified. The second checkpoint now covers the local
HTTP, pooling and concurrency cases described in SERVICE.md; its remaining
blocking cancellation-transport result is explicit. No city inventory or offline
pack was added in either checkpoint.

## Later source refresh design

A monthly acquisition job can fetch official files/APIs, using conditional
requests where providers support them. The adapter validates the complete
candidate snapshot, retains source dates/identity/licence evidence and computes
new/changed/missing records. Missing entries do not automatically establish
felling. Stage the data and publish one release pointer only after all checks
pass. Visitors query our database; upstream outages affect the refresh rather
than each search. Immutable release IDs keep map, query and offline packs in
agreement. Incremental writes require trustworthy source IDs; release-scoped
identities may require rebuilding that source's snapshot.

This PoC creates no schedule, automation or monthly import job.

## Sources

- https://github.com/carbon-language/carbon-lang/releases/tag/v0.0.0-0.nightly.2026.11.07
- https://github.com/carbon-language/carbon-lang/blob/trunk/examples/interop/cpp/socket.carbon
- https://github.com/carbon-language/carbon-lang/blob/trunk/examples/interop/cpp/hello_world.carbon
- https://www.postgresql.org/docs/16/libpq-exec.html
- https://json-c.github.io/json-c/json-c-0.17/doc/html/index.html

Upstream example files retained under `evidence/` include their original licence
notices. The Carbon compiler remains experimental. No hosting or deployment was
performed, and the existing Tree Atlas and Vienna applications were not modified.
