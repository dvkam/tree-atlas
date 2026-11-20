# Nonblocking cancellation review — 2026-11-07

Intent: bound local cancellation transport, preserve exclusive pool ownership,
retire cancelled sessions, and rerun the stalled-EOF regression. Keep the native
PostgreSQL server unchanged. Do not import inventories or deploy.

Two independent subagents reviewed the runtime; the second also reviewed the
fault regression, client build and link verification. Both used the available
model. This is independent review, not cross-provider model consensus.

Both found no actionable defect in the changed path. They checked descriptor
refresh after libpq transitions, readiness/EOF handling, unconditional handle
cleanup, the 150 ms transport allowance and retirement before releasing a slot.
The fault-test review checked that a genuine cancellation reached PostgreSQL,
the HTTP response completed before EOF release, both pool slots recovered, and
test failure or incomplete cleanup produced a nonzero exit.

Lead judgment: accept the change for this local numeric-IP experiment after
actual build and test verification. Keep the existing expansion gates. Report
the deadline plus up to 450 ms cleanup, with scheduling tolerance; do not call
this a universal hard deadline. Plaintext held-EOF evidence does not prove TLS
fault handling or pre-dispatch blackholes. Dispatch is not proof of SQL effect;
the regular suite separately observes SQLSTATE 57014 and database activity.

Observed acceptance: full compilation/integration checks passed; 54 existing
tests passed; held-EOF regression passed at 351.33 ms for a 200 ms deadline.
Two concurrent recovery queries succeeded before fault release. The service,
proxy threads/sockets and PostgreSQL pool sessions were all cleaned up. Actual
loaded client libpq version was 170011. See verification.json and the original
red/green evidence files for machine-readable observations.
