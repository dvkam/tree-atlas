"""Refresh the local pilot status from observed verification evidence."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
report = json.loads((ROOT / "evidence/verification.json").read_text())
fault = report["cancel_fault_test"]
assert fault["bounded_cancellation_passed"] and fault["cleanup_passed"]
tls = report["tls_cancel_fault_test"]
assert tls["passed"] and tls["cleanup_passed"] and tls["untrusted_certificate_rejected"]
plan = ROOT.parent / "backend-pilot-plan-2026-11-02.html"
text = plan.read_text(encoding="utf8")
notice = (
    '<strong>Current evidence:</strong> C0 passed locally: checksum-pinned Carbon '
    'nightly, matching repeat-build hashes and invalid-source rejection. Basic '
    'HTTP/JSON/PostgreSQL integration, persistent HTTP, a two-slot pool and real '
    'concurrency are tested. ' + report["http_and_native_postgres_checks"] + '. '
    'The isolated libpq 17.11 client resolves the reproduced synchronous '
    'cancellation-EOF stall in this local experiment: the 200 ms deadline returned '
    f'504 in {fault["observed_http_elapsed_ms"]:.2f} ms while EOF remained held; '
    'both pool slots then served concurrent queries before fault release. '
    'PostgreSQL server 16.15 is unchanged. Cancellation permits up to 450 ms '
    'cleanup after the query deadline, plus scheduling tolerance. Resets now '
    'cancel work; legitimate write-half-close remains supported. Absolute '
    'header/body limits are 1,500 ms per phase, with a 2,100 ms handler/response '
    'cutoff from completed headers. Server-issued single-use tokens replace '
    'permanent tombstones: 4,096 live entries, 30-second unused-reservation TTL, '
    'and 4,097 real completed queries verified without lifetime exhaustion. '
    f'Verified-TLS held-EOF cancellation returned 504 in {tls["observed_http_elapsed_ms"]:.2f} ms; '
    'untrusted certificates were rejected. The local proxy-to-database leg '
    'remains plaintext; this is not browser-facing TLS or a complete network '
    'fault matrix. FIN abandonment remains ambiguous and deadline-bounded. '
    'Inventory contracts/conformance, production admission and scale remain '
    'future gates. See '
    '<a href="tree-atlas-carbon-poc/SERVICE.md">the persistent service report</a>, '
    '<a href="tree-atlas-carbon-poc/evidence/verification.json">verification evidence</a> '
    'and <a href="tree-atlas-carbon-poc/evidence/lifecycle-review.md">independent reviews</a>. '
    'No inventories, hosting or deployment were added.'
)
text, count = re.subn(r'(<section id="carbon-poc">.*?<div class="notice">).*?(</div>)',
                       lambda match: match[1] + notice + match[2], text, count=1, flags=re.S)
assert count == 1
text = text.replace('HTTP, JSON, Unicode and PostgreSQL integration are <strong>unverified capabilities for our application</strong>.',
    'HTTP, JSON, Unicode and PostgreSQL integration are <strong>verified only within the local synthetic-data scope described above</strong>.')
text = text.replace('The HTTP probe binds an ephemeral loopback port, handles one request and exits.',
    'The persistent service binds an ephemeral loopback port and serves concurrent synthetic queries; the original one-shot probe is retained as earlier evidence.')
text = text.replace('The current local suite passes 54 checks, including 31 persistent-service checks, after independent reviews. A separate cancellation-transport diagnostic reproduces a blocker; this is not an all-green C1 gate.',
    'The current local suite passes 54 checks plus the held-EOF cancellation regression after independent reviews. The transport blocker is resolved within that experiment; remaining C1 lifecycle and HTTP limits still gate expansion.')
text = text.replace('The current local suite passes 54 checks plus the held-EOF cancellation regression after independent reviews. The transport blocker is resolved within that experiment; remaining C1 lifecycle and HTTP limits still gate expansion.',
    'The current local suite passes 63 checks plus plaintext and verified-TLS held-EOF regressions after independent reviews. Local lifecycle, HTTP phase limits and token-lifetime checks pass; full inventory and production checks remain outside this scope.')
plan.write_text(text, encoding="utf8")
print('Updated local pilot status from verification evidence')
