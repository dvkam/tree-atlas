"""Rerun the scoped feasibility checks; never prints private credentials."""
import hashlib
import ctypes
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from compile import COMPILER, SERVICE_LIBPQ, run

EXPECTED_ARCHIVE_HASH = "5ba8e554dfec058bdad8eace18591125d1f06857005de6f4ed3706a735245c22"

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""): h.update(block)
    return h.hexdigest()

def checked(args, timeout=120):
    evidence = run(args, timeout)
    if evidence["returncode"]:
        print(evidence["stderr"], file=sys.stderr)
        raise RuntimeError("Probe failed: " + str(args[0]))
    return evidence

report = {"scope": "local persistent HTTP lifecycle, bounded attempts, pooling and plaintext/TLS cancellation faults"}
report["archive_sha256"] = digest(ROOT / "tools/carbon-toolchain.tar.gz")
assert report["archive_sha256"] == EXPECTED_ARCHIVE_HASH
report["toolchain"] = checked([COMPILER, "--version"])["stdout"].strip()
report["hello_runs"] = []
for _ in range(2):
    checked([sys.executable, "tools/compile.py", "hello"])
    output = checked([ROOT / "build/hello"])["stdout"]
    assert output == "42\n"
    report["hello_runs"].append({"stdout": output, "binary_sha256": digest(ROOT / "build/hello")})
assert report["hello_runs"][0] == report["hello_runs"][1]
negative = run([sys.executable, "tools/compile.py", "invalid"])
assert negative["returncode"] != 0 and "missing_identifier" in negative["stderr"]
report["invalid_source_rejected"] = True
checked([sys.executable, "tools/compile.py", "json_probe", "-ljson-c"])
json_output = checked([ROOT / "build/json_probe"])["stdout"]
assert json.loads(json_output) == {"q": "Platane – Zürich 🌳", "id": "0007"}
report["json_round_trip"] = True
checked([sys.executable, "tools/compile.py", "postgres_probe", "-lpq"])
pg_output = checked([sys.executable, "tools/run_with_postgres.py", "build/postgres_probe"])["stdout"]
assert pg_output == "0007 – Zürich 🌳 '; DROP TABLE poc_probe; --\n"
report["parameterized_postgres_round_trip"] = True
checked([sys.executable, "tools/compile.py", "http_probe", "-lpq", "-ljson-c"])
checked([sys.executable, "tools/compile.py", "service", "-lmicrohttpd", "-lpq", "-ljson-c", "-pthread"])
(ROOT / "evidence/service-observations.jsonl").write_text("")
suite = checked([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"], timeout=240)
(ROOT / "evidence/tests.log").write_text(suite["stdout"] + suite["stderr"])
count = int(re.search(r"Ran (\d+) tests", suite["stderr"])[1])
report["http_and_native_postgres_checks"] = f"{count} tests passed"
libraries = checked(["ldd", ROOT / "build/service"])["stdout"]
assert str(SERVICE_LIBPQ / "lib/libpq.so.5") in libraries
(ROOT / "evidence/service-runtime-libraries.txt").write_text(libraries)
client = ctypes.CDLL(str(SERVICE_LIBPQ / "lib/libpq.so.5"))
report["service_libpq_version"] = client.PQlibVersion()
assert report["service_libpq_version"] == 170011
checked([sys.executable, "experiments/cancel_transport/probe.py"], timeout=30)
report["cancel_fault_test"] = json.loads((ROOT / "evidence/cancel-transport-nonblocking.json").read_text())
checked([sys.executable, "experiments/tls_cancel_transport/probe.py"], timeout=30)
report["tls_cancel_fault_test"] = json.loads((ROOT / "evidence/cancel-transport-tls.json").read_text())
report["request_id_lifetime"] = json.loads((ROOT / "evidence/request-id-lifetime.json").read_text())
report["persistent_service"] = {
    "http_library": checked(["pkg-config", "--modversion", "libmicrohttpd"])["stdout"].strip(),
    "pool_capacity": 2, "max_waiters": 4, "wait_ms": 250,
    "http_connection_limit": 32, "live_attempt_limit": 4096, "unused_attempt_ttl_seconds": 30,
    "http_header_phase_ms": 1500, "http_body_phase_ms": 1500,
    "handler_response_cutoff_ms_from_headers": 2100,
    "disconnect": "observable fatal error/RST cancels work; FIN/write-half-close preserved",
    "cancel": "explicit request/deadline; SQLSTATE 57014 observed; cancelled sessions retired",
    "cancel_transport_budget_ms": 150, "cancel_drain_budget_ms": 300,
}
report["reviews"] = "independent available-model lifecycle and attempt-policy reviews; see evidence/lifecycle-review.md"
report["not_verified"] = ["production HTTP completeness", "unobservable FIN abandonment beyond deadlines", "arbitrary network and TLS fault matrix",
    "full inventories", "mobile latency", "three-second target", "hosted deployment"]
report["remaining_expansion_gates"] = ["inventory search/release contract and independent oracle", "inventory-scale conformance/performance", "production admission/rate limiting and packaging"]
report["historical_blocker_evidence"] = "evidence/cancel-transport-blocker.json"
(ROOT / "evidence/verification.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
print(json.dumps(report, indent=2, ensure_ascii=False))
