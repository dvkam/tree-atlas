"""Record final native state through local administrative peer authentication."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def output(args):
    return subprocess.run(args, text=True, capture_output=True, check=True).stdout

count = int(output(["runuser", "-u", "postgres", "--", "psql", "-X", "-At", "-c",
                    "SELECT count(*) FROM pg_stat_activity WHERE application_name='tree_atlas_carbon_pool'"]))
assert count == 0, "A test pool session was left running"
processes = {}
for name in ["service", "http_probe"]:
    result = subprocess.run(["pgrep", "-x", name], text=True, capture_output=True)
    processes[name] = result.stdout.strip().splitlines()
    assert not processes[name], "A test service was left running"
(ROOT / "evidence/http-packages.txt").write_text(output(
    ["dpkg-query", "-W", "libmicrohttpd-dev", "libmicrohttpd12t64", "libidn2-0"]))
(ROOT / "evidence/service-runtime-libraries.txt").write_text(output(
    ["ldd", str(ROOT / "build/service")]))
record = {"pool_sessions_remaining": count, "test_processes": processes,
          "postgres_cluster": output(["pg_lsclusters"]).strip()}
(ROOT / "evidence/final-service-state.json").write_text(json.dumps(record, indent=2))
print(json.dumps(record, indent=2))
