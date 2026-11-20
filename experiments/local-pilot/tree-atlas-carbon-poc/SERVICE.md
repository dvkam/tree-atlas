# Persistent Carbon service: local C1 extension

The service uses GNU libmicrohttpd 1.0.0 for HTTP, a bounded PostgreSQL pool,
asynchronous libpq queries, absolute HTTP phase limits and server-issued attempt
tokens. Observable resets cancel queued or active work. The pinned Carbon nightly
executes application handlers concurrently. This remains a local synthetic-data PoC.

## Ownership

| Owner | Responsibility |
| --- | --- |
| Carbon, `src/service.carbon` | Routes, method/media-type/input validation, literal SQL selection, error mapping and response contents |
| Private C++ runtime, `src/service_runtime.cpp` | HTTP lifecycle adaptation, pool synchronization, libpq polling, cancellation state and resource ownership |
| libmicrohttpd | HTTP parsing, keep-alive, chunked uploads, connection lifecycle and response framing |
| json-c / PostgreSQL | UTF-8 JSON parsing/serialization and parameterized query execution |

The native runtime is a substantial implementation module, not merely a type
cast. Opaque request/result pointers keep its standard-library types out of the
Carbon interface. Actual callback and overlapping-thread experiments are retained
in `experiments/callbacks/`. This does not demonstrate an all-Carbon HTTP framework.

## Native WSL changes in this step

Installed `libmicrohttpd-dev` from Ubuntu's configured signed repositories:

```sh
sudo apt-get install -y --no-install-recommends libmicrohttpd-dev
```

The package transaction added ten packages (about 11.2 MB) and upgraded
`libidn2-0`. The native PostgreSQL 16.15 cluster, dedicated database and restricted
fixture grants are unchanged. There is no Docker, hosting or deployment step.

The first link attempt exposed a GCC/libstdc++ versus Carbon runtime mismatch.
The build now uses the pinned Carbon toolchain's bundled Clang for the private
C++ implementation as well as the Carbon handler. No compiler upgrade was needed.

## Run the checks

Inside WSL, from this directory:

```sh
python3 tools/verify.py
```

This rebuilds the old one-shot probes and the persistent service before running
the suites. Credentials remain in the private WSL configuration described in
`README.md`. Tests create and stop their own service processes; PostgreSQL stays
running locally. Do not run multiple complete suites simultaneously: the PoC
database role has a four-connection limit, including observers.

The persistent service requires an isolated newer client library. Build it first:

```sh
python3 tools/build_libpq.py
```

This builds only libpq 17.11 from the official source archive, checks both the
pinned SHA-256 and the published checksum, and installs under `tools/libpq-17.11`.
The build uses a temporary WSL directory. Bison and Flex were installed as build
tools (two packages, about 3.5 MB, no upgrades). No server executable is built or
installed. PostgreSQL server and system libpq remain 16.15. The persistent service
uses the isolated headers and library with an explicit local runtime path; older
one-shot probes still use the system client. `verify.py` checks the actual loaded
library path and version. This local absolute path is not deployment packaging.

## HTTP contract

The service binds an ephemeral `127.0.0.1` port and prints `PORT <number>`.

- `GET /health`: local liveness response without a SQL query.
- `POST /attempt`: reserve a single-use token, returned as `{"id":"..."}`.
- `POST /probe`: application/json with string `value`, optional `sleep_ms`
  (0–1500, default 0), and `timeout_ms` (100–1500, default 1200).
- `POST /cancel`: application/json with the target request's `id`.
- `GET /stats`: local diagnostic counters, not an inventory interface.

Reserve a token with `POST /attempt`, then send it as `X-Request-ID` on one probe.
Tokens contain a fresh 128-bit cryptographic nonce and a nonwrapping 64-bit
counter. Arbitrary IDs, expired reservations and replayed tokens receive 409.
Each retry needs a new reservation. Pending reservations expire after 30 seconds
using a monotonic clock. Active attempts do not expire while work owns them.
Completion removes tracking; an absent reservation can never be claimed again.
There are at most 4,096 live pending/active entries, rather than a lifetime cap.
Capacity or entropy failure receives 503. Cancelling an unused token consumes
its reservation, so delayed submission cannot start work. Cancellation of a
finished or unknown token receives 404. This is a local protocol change: older
clients that supplied arbitrary UUIDs must reserve tokens first.

Success returns `echo`, `pid` and `fixture`. The SQL is a Carbon literal with
separately bound values. The sleep field exists only to test concurrency and
cancellation locally; it is not a proposed public Tree Atlas capability.

Keep-alive, chunked JSON and mixed-case headers are tested. Duplicate lengths and
length/transfer-encoding conflicts are rejected through parsed-header policy.
Bodies are capped at 2,048 bytes; connection memory is limited to 16 KiB and
concurrent HTTP connections to 32. Known-size overflow receives 413. Overflow or
age violations during an unfinished upload cause immediate terminal response or
connection closure, not continued intake until an attacker ends the upload.

The library uses bounded thread-per-connection mode. Its fixed worker-pool mode
could assign simultaneous blocking handlers to the same worker; the initial
real-concurrency test caught that serialization. No claim of optimal production
threading or scheduling is made.

## Pool and cancellation

Two PostgreSQL connections are exclusively leased. Up to four requests may wait,
for at most 250 ms or their shorter remaining deadline. Extra load gets an
explicit busy response. Connecting/replacing a slot remains inside its capacity.
Network polling and SQL run without holding the pool mutex.

Healthy results are completely drained before reuse, and the transaction must
be idle. Failed sessions are closed. After ANY cancellation attempt, the session
is closed and replaced on a later borrow. This prevents a late cancel from
reaching the next query on that PostgreSQL session.

Explicit cancellation only sets a request-owned flag. The worker that owns its
connection dispatches PostgreSQL cancellation. Cancelling a waiting request
prevents it from submitting SQL. A cancel response acknowledges the request; it
cannot undo work that already finished. Tests separately verify SQLSTATE 57014
and actual disappearance of the active query from `pg_stat_activity`.

Cancellation uses `PQcancelCreate`, `PQcancelStart` and `PQcancelPoll`, with a
fresh socket descriptor after each transition. Transport polling stops after
150 ms; result draining allows up to another 300 ms. Every created cancel handle
is freed, even after failure or abandonment. These are cleanup allowances after
the query deadline, not a promise to return within that original deadline. OS
scheduling can add latency. Dispatch success does not guarantee cancellation
took effect; the session is always retired. If dispatch fails before reaching
PostgreSQL, server work may continue until it detects the closed connection or
its statement timeout expires.

Deadline errors are 504, explicit cancellation 409, queue overload/database
failure 503, and invalid input 400. No failure becomes an empty successful result.
Error responses close the HTTP connection. A legitimate TCP write-half-close
still receives its response.

## Evidence and reviews

The service and attempt-policy suites extend the 23 earlier checks. They observe
real PostgreSQL sessions, simultaneous active sleeps,
stable backend PIDs for normal reuse and new PIDs after cancelled/failed slots.
It also tests queue cancellation, overload, stale IDs, denied ID reuse and
termination of idle database sessions followed by recovery.

Evidence includes:

- `evidence/service-tests.log`: extended service suite.
- `evidence/tests.log`: complete rerun.
- `evidence/service-observations.jsonl`: database observations, without credentials.
- `evidence/reused-id-before.log`: ID reuse regression failed before enforcement.
- `evidence/upload-regression-before.log`: unfinished uploads failed before termination fix.
- `evidence/verification.json`: current executable/compiler and check results.

Two independent available-model reviewers found the streaming-upload defect;
both accepted the corrected behavior after the red/green regressions. Earlier
review also identified cancellation-ID reuse. This is scoped local evidence,
not a proof of production readiness or cross-provider model consensus.

## Connection lifecycle and absolute limits

A 10 ms watchdog observes accepted sockets without reading client data. Fatal
socket events, including TCP resets, mark shared transport state abandoned.
Workers check it while waiting for a pool slot, reconnecting and executing SQL.
Active SQL uses the same bounded cancellation and session-retirement path.
GNU libmicrohttpd retains ownership of `close()`; the watchdog only calls
`shutdown()`. Connection removal and watchdog access share a mutex, preventing
descriptor reuse from affecting another connection. This depends on the verified
libmicrohttpd 1.0.0 ordering: CLOSED notification precedes descriptor closure.

The watchdog enforces these monotonic phase limits independently of incoming
traffic or access-handler callbacks:

| Phase | Configured limit |
| --- | --- |
| First headers, from connection admission | 1,500 ms |
| Next keep-alive headers, from previous response completion | 1,500 ms |
| Body, from completed headers | 1,500 ms |
| Handler and response, from completed headers | 2,100 ms |

The handler limit includes at most 1,500 ms for the probe, 450 ms cancellation
cleanup and 150 ms response allowance. Body time consumes the same query/handler
budget; it is not added again. Trickle callbacks do not extend deadlines.
Expiry closes the transport; a JSON timeout response is not guaranteed when a
client has not finished headers/body or cannot receive a response. Scheduling
and the watcher interval add tolerance. The first request has at most about
3,600 ms configured header-plus-handler allowance, not a universal 1,500 ms
end-to-end cutoff. Normal query deadlines remain separate and usually shorter.

TCP FIN alone cannot distinguish a client that abandoned its response from one
that legitimately finished sending and still expects a response. FIN/RDHUP is
therefore preserved; explicit cancellation and the deadlines bound that case.
A delayed-response half-close regression guards this behavior. Reset tests
observe active PostgreSQL work before disconnecting, then require cancellation
acknowledgement and retirement before the original query deadline.

## Remaining limits before inventory work

The local lifecycle, bounded token tracking and held-EOF transport gates are
implemented. This is not production readiness. Reservation flooding can occupy
the bounded token capacity temporarily; authentication, per-client admission
limits and a future HTTPS reverse proxy need separate work. HTTP ingress is
still plaintext localhost. FIN ambiguity is a protocol limitation, not a claim
of automatic cancellation for every kind of client abandonment.

No city inventory, PostGIS layer, offline pack or three-second application
benchmark is included. The next inventory stage still needs the frozen search
and release contract, independent oracle and complete-set conformance checks.
No inventory import or deployment was performed in this step.

## Cancellation transport regression

The old synchronous client took 1,204.99 ms for a 200 ms query deadline when a
proxy held cancellation EOF for about one second. That original evidence remains
in `evidence/cancel-transport-blocker.json`; a new failing run against the old
executable is in `evidence/cancel-transport-nonblocking-before.json`.

The replacement test forwards a genuine CancelRequest, holds its EOF, and
requires a 504 timeout response within 900 ms while EOF is still held. It then
requires two concurrent successful queries on distinct database PIDs before
releasing the fault. It checks owned service, proxy and PostgreSQL cleanup and
exits nonzero on any failure. The 900 ms threshold includes scheduling tolerance
for a 200 ms deadline plus up to 450 ms cancellation cleanup.

Run it separately, with no other suite active:

```sh
python3 experiments/cancel_transport/probe.py
```

Its result is `evidence/cancel-transport-nonblocking.json`; `verify.py` also runs
it after the main suite. The fault scenario explicitly disables SSL/GSS only for
its local proxy connection. It does not prove encrypted-channel fault handling,
pre-dispatch packet-loss behavior or arbitrary network bounds. The regular suite
retains default connection settings and separately checks actual SQL cancellation.
See `evidence/libpq-client-build.json` for source, checksum, version and build
commands. No inventories, hosting or deployment were added.

The preceding transport-only checkpoint passed its 54 tests and this fault
regression. HTTP returned 504 after 351.33 ms for the 200 ms deadline; EOF was
withheld for 1,111.67 ms including the concurrent recovery checks. Both queries
succeeded on distinct backend PIDs before release. Cleanup left zero service
processes, proxy threads/sockets or pool sessions. Two independent available-model
reviews found no actionable new blocker in this change; their scope and lead
judgment are in `evidence/nonblocking-review.md`.

## Encrypted cancellation faults

`python3 experiments/tls_cancel_transport/probe.py` repeats the held-EOF fault
through a local TLS-terminating proxy. libpq uses `sslmode=verify-full` with a
temporary trusted certificate and IP SAN. The test also requires an untrusted
certificate to fail before the HTTP service starts. It records negotiated TLS
for ordinary SQL and the genuine CancelRequest, actual cancellation
acknowledgement, bounded HTTP completion, two-slot recovery and cleanup of the
temporary certificate/key. The proxy-to-PostgreSQL leg remains plaintext
localhost; PostgreSQL server configuration is unchanged.

This closes the earlier encrypted held-EOF coverage gap. It is not a complete
TLS/network fault matrix or evidence for a future browser-facing TLS proxy.
`verify.py` runs both transport experiments after the main suite. Current results
are in `evidence/verification.json`, `evidence/cancel-transport-tls.json` and
`evidence/request-id-lifetime.json`. The latest review is
`evidence/lifecycle-review.md`; older red/green evidence remains historical.

The latest complete rerun passed **63 tests plus both fault experiments**.
Plaintext held-EOF HTTP completion was 351.28 ms; verified-TLS completion was
351.78 ms, both for 200 ms query deadlines. The TLS hold lasted 1,164.89 ms;
both pool slots recovered before release. The request-ID lifetime test completed
4,097 real queries in 2,502.84 ms and retained zero entries after completion.
Real unused-token expiry was also tested. Cleanup found no service processes or
pool sessions and removed temporary TLS material. These are local synthetic
fixture measurements, not inventory search or public-network benchmarks.

## Primary references

The next-stage search/release contract was frozen locally on 2026-11-08 in
[tree-atlas-contract-v1](../tree-atlas-contract-v1/README.md). It pins London,
Vienna, Geneva and Porto, preserves complete offline requirements and provides
independent canonical reference results. See its sealed contract and review
record before importing any inventory. No database import or inventory-query
conformance is implied by that freeze.

The subsequent [local PostgreSQL staging step](../tree-atlas-postgres-pilot/README.md)
imported and independently verified all 1,657,347 frozen records in separate
database `tree_atlas_pilot`. It did not change this PoC's database or implement
the Carbon inventory-query HTTP adapter.

A further [Carbon/native inventory adapter](../tree-atlas-carbon-inventory-api/README.md)
now implements local read-only HTTP operations, exact counts and bounded map
aggregation against those validated releases. It has its own exhaustive HTTP,
fault and local performance evidence. This original synthetic PoC remains
unchanged; offline/frontend/hosted conformance is not implied.

- https://www.gnu.org/software/libmicrohttpd/
- https://www.gnu.org/software/libmicrohttpd/manual/html_node/microhttpd_002dconst.html
- https://www.postgresql.org/docs/16/libpq-async.html
- https://www.postgresql.org/docs/16/libpq-cancel.html
- https://www.postgresql.org/docs/16/libpq-threading.html
- https://www.postgresql.org/docs/17/libpq-cancel.html
