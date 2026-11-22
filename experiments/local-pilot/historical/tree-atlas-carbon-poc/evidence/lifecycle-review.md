# Local lifecycle and attempt-policy review — 2026-11-07

Intent: continue the remaining local feasibility gates without importing
inventories, changing the PostgreSQL server or deploying. Add observable client
disconnect cancellation, absolute HTTP phase limits, bounded token tracking over
long uptime, and verified-TLS cancellation fault evidence.

Two independent available-model reviewers checked the runtime and token policy.
Neither authored those combined changes. This is not cross-provider consensus.
They checked lock ordering, socket lifetime, phase reset points, shared transport
state through queue/connect/query, token claim/cancel races and replay rejection.

Acted on: the first review found an atomic-containing Transport being moved into
a shared pointer, which would not compile. It now constructs directly from the
descriptor. The token design review also rejected a shared predictable nonce;
each reservation instead receives fresh checked 128-bit OS entropy.

Accepted scope: FIN alone is indistinguishable from legitimate write-half-close.
The implementation detects observable fatal events/RST and uses deadlines for
ambiguous abandonment. A delayed half-close test guards legitimate responses.
Watchdog shutdown/removal share a mutex; MHD alone closes sockets. The reviewer
verified official libmicrohttpd 1.0.0 daemon.c: CLOSED notifications precede socket
closure in both relevant paths. Revalidate this ordering if upgrading MHD.
Primary source: https://ftp.gnu.org/gnu/libmicrohttpd/libmicrohttpd-1.0.0.tar.gz

The registry keeps only live reservations/active attempts, capped at 4,096.
Unused reservations expire after 30 monotonic seconds; active work remains
owned until release. Pre-submit cancellation consumes a reservation. A fresh
128-bit nonce plus a nonwrapping counter prevents spent-token resurrection.
Reservation flooding remains a bounded temporary admission issue, not a claim
of public-service rate limiting.

Both final reviews found no additional actionable runtime defect. They noted
that a queued-reset-specific regression would strengthen coverage; existing
tests separately cover queue cancellation and active reset cancellation. This
is a coverage opportunity rather than a demonstrated blocker.

Lead judgment: accept these local gates after actual executable verification.
The complete run passed 63 tests, including real 30-second expiry and 4,097
completed SQL queries with zero retained attempt entries. Plaintext cancellation
fault returned 504 in 351.28 ms; verified-TLS fault returned it in 351.78 ms while
EOF stayed held. TLS 1.3 was observed for SQL and cancellation; an untrusted
certificate was rejected. Both pool slots recovered before fault release.
Cleanup left no owned service process, proxy sockets/threads or pool sessions.

This does not establish universal hard timing under OS scheduling, every network
fault, public HTTPS ingress, inventory completeness, offline behavior or city
scale. Freeze the inventory query/release contract and independent oracle before
the next stage; production admission and packaging remain separate work.
