"""Runs inside the disposable clean Ubuntu userspace; no host dependency paths."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

PILOT = Path("/work/tree-atlas/experiments/local-pilot")
NODE = Path("/home/david/.nvm/versions/node/v26.13.0")
NODE_SHA = "d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997"
CARBON_VERSION = "0.0.0-0.nightly.2026.11.07"
CARBON_SHA = "5ba8e554dfec058bdad8eace18591125d1f06857005de6f4ed3706a735245c22"
ENV = {"PATH": f"{NODE}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
       "HOME": "/root", "LANG": "C.UTF-8", "DEBIAN_FRONTEND": "noninteractive"}


def run(args, cwd=PILOT, timeout=1200, *, capture=False):
    result = subprocess.run(list(map(str, args)), cwd=cwd, env=ENV, text=True,
                            stdout=subprocess.PIPE if capture else None, stderr=subprocess.STDOUT,
                            timeout=timeout, stdin=subprocess.DEVNULL)
    if result.returncode:
        raise RuntimeError(f"Clean userspace command failed: {Path(str(args[0])).name}")
    return result.stdout if capture else None


def download(url, path, expected):
    if path.exists():
        raise RuntimeError("Fresh dependency path already exists; do not reuse it")
    with urllib.request.urlopen(url, timeout=60) as source, path.open("xb") as output:
        shutil.copyfileobj(source, output)
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError("Pinned dependency checksum mismatch")
    return actual


def dependencies():
    if NODE.exists() or (PILOT / "tree-atlas-local/node_modules").exists():
        raise RuntimeError("Clean dependency paths already populated")
    try:
        run(["id", "-u", "david"], capture=True)
    except RuntimeError:
        run(["useradd", "--create-home", "david"])
    archives = Path("/work/downloads")
    archives.mkdir()
    node_archive = archives / "node.tar.xz"
    download("https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.xz", node_archive, NODE_SHA)
    with tarfile.open(node_archive) as source:
        source.extractall(archives, filter="data")
    NODE.parent.mkdir(parents=True)
    (archives / "node-v26.13.0-linux-x64").rename(NODE)
    if run(["node", "--version"], capture=True).strip() != "v26.13.0":
        raise RuntimeError("Unexpected clean Node version")
    poc = PILOT / "tree-atlas-carbon-poc"
    tools = poc / "tools"
    carbon_archive = tools / "carbon-toolchain.tar.gz"
    download(f"https://github.com/carbon-language/carbon-lang/releases/download/v{CARBON_VERSION}/carbon_toolchain-{CARBON_VERSION}.tar.gz",
             carbon_archive, CARBON_SHA)
    with tarfile.open(carbon_archive) as source:
        source.extractall(tools, filter="data")
    run(["python3", "tools/build_libpq.py"], poc)
    api = PILOT / "tree-atlas-carbon-inventory-api"
    run(["python3", "unicode/fetch_icu.py"], api)
    frontend = PILOT / "tree-atlas-local"
    run(["npm", "exec", "--yes", "--package=pnpm@11.25.0", "--", "pnpm", "install",
         "--frozen-lockfile", "--ignore-scripts"], frontend)
    installed = [NODE, tools / f"carbon_toolchain-{CARBON_VERSION}", tools / "libpq-17.11",
                 api / "unicode/tools/icu", frontend / "node_modules"]
    if any(path.is_symlink() or not path.is_dir() for path in installed):
        raise RuntimeError("Dependency roots must be fresh directories, not reuse links")
    dependencies = {
        "nodeSha256": NODE_SHA, "carbonSha256": CARBON_SHA,
        "nodeVersion": run(["node", "--version"], capture=True).strip(),
        "nodeUnicode": run(["node", "-p", "process.versions.unicode"], capture=True).strip(),
        "carbonVersion": run([tools / f"carbon_toolchain-{CARBON_VERSION}/bin/carbon", "--version"], capture=True).strip(),
        "libpq": json.loads((poc / "evidence/libpq-client-build.json").read_text()),
        "icu": json.loads((api / "unicode/icu-client.json").read_text()),
        "dependencySymlinksToHost": False,
        "freshInstallDirectories": [str(path) for path in installed],
    }
    Path("/work/dependency-result.json").write_text(json.dumps(dependencies, indent=2) + "\n")


def psql(query):
    return run(["runuser", "-u", "postgres", "--", "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                "-h", "/run/postgresql", "-p", "5432", "-d", "tree_atlas_pilot", "-c", query], capture=True)


def restore():
    isolation = json.loads(Path("/work/namespace-proof.json").read_text())
    if isolation.get("mode") != "restore" or not all(isolation.get(key) is True for key in ("privateMount", "privatePid", "privateNetwork")):
        raise RuntimeError("Restore requires its recorded private mount, PID and network namespaces")
    if not Path("/work/dependency-result.json").is_file():
        raise RuntimeError("Fresh dependencies have not been verified")
    if Path("/home/david/.config/tree-atlas-postgres-pilot").exists():
        raise RuntimeError("Refusing preexisting database credentials in the clean userspace")
    report = {"passed": False, "scope": "Fresh Ubuntu userspace, own network/PID/mount namespaces and new PostgreSQL cluster; shared WSL kernel",
              "stages": {}, "hostDatabaseWrites": False, "isolation": isolation}
    output = Path("/work/runtime-result.json")
    output.write_text(json.dumps(report, indent=2) + "\n")
    pg = Path("/usr/lib/postgresql/16/bin")
    data = Path("/var/lib/postgresql/pilot-clean")
    if data.exists():
        raise RuntimeError("Refusing to reuse a PostgreSQL cluster")
    data.mkdir()
    run(["chown", "postgres:postgres", data])
    socket = Path("/run/postgresql")
    socket.mkdir(exist_ok=True)
    run(["chown", "postgres:postgres", socket])
    run(["runuser", "-u", "postgres", "--", pg / "initdb", "-D", data, "--auth-local=peer", "--auth-host=scram-sha-256", "--encoding=UTF8"])
    started = False
    frontend_process = None
    try:
        run(["runuser", "-u", "postgres", "--", pg / "pg_ctl", "-D", data, "-l", "/var/lib/postgresql/pilot-clean.log",
             "-o", "-h 127.0.0.1 -p 5432 -k /run/postgresql", "-w", "start"])
        started = True
        stage = PILOT / "tree-atlas-postgres-pilot"
        start = time.monotonic()
        run(["python3", "setup_database.py"], stage)
        run(["runuser", "-u", "postgres", "--", "pg_restore", "--clean", "--if-exists", "--exit-on-error", "--single-transaction",
             "-h", "/run/postgresql", "-p", "5432", "-d", "tree_atlas_pilot", "/work/inventory.dump"])
        run(["python3", "tools/install_sql.py"], PILOT / "tree-atlas-carbon-inventory-api")
        run(["python3", "sql/apply_spatial_index.py"], PILOT / "tree-atlas-carbon-inventory-api")
        run(["python3", "sql/apply_search_index.py"], PILOT / "tree-atlas-carbon-inventory-api")
        run(["runuser", "-u", "postgres", "--", "vacuumdb", "-h", "/run/postgresql", "-p", "5432", "-d", "tree_atlas_pilot", "--analyze"])
        report["stages"]["restore"] = {"seconds": round(time.monotonic() - start, 3)}
        report["database"] = json.loads(psql("SELECT json_build_object('bytes',pg_database_size(current_database()),'records',(SELECT count(*) FROM atlas.records),'releases',(SELECT json_agg(x) FROM (SELECT dataset,release,status,expected_count FROM atlas.releases ORDER BY dataset) x),'readOnlyRuntime',(SELECT rolconfig FROM pg_roles WHERE rolname='tree_atlas_reader'))"))
        start = time.monotonic()
        run(["node", "verification/verify-postgres.mjs"], stage)
        verification = json.loads((stage / "evidence/postgres-independent-verification.json").read_text())
        if verification.get("passed") is not True or verification.get("totalRecords") != 1657347:
            raise RuntimeError("Full independent restored-record verification did not pass")
        report["stages"]["independentReadback"] = {"seconds": round(time.monotonic() - start, 3), "result": verification}
        run(["python3", "scripts/prepare-workspace.py"], PILOT)
        api = PILOT / "tree-atlas-carbon-inventory-api"
        run(["python3", "tools/build.py"], api)
        run(["node", "verification/http-conformance.mjs", "--quick"], api)
        report["stages"]["http"] = json.loads((api / "evidence/http-conformance-quick.json").read_text())
        frontend = PILOT / "tree-atlas-local"
        run(["python3", "verification/check-local.py"], frontend)
        run(["node", "scripts/bootstrap-local.mjs"], frontend)
        run(["node_modules/.bin/vite", "build"], frontend)
        report["stages"]["frontendSource"] = json.loads((frontend / "verification/source-checks.json").read_text())
        # The launcher proof checks the fresh native executable and frontend proxy.
        run(["python3", "verification/check-launcher.py"], frontend)
        report["stages"]["frontendLauncher"] = json.loads((frontend / "verification/launcher.json").read_text())
        report["postRestoreReaderSessions"] = int(psql("SELECT count(*) FROM pg_stat_activity WHERE usename='tree_atlas_reader'"))
        if report["postRestoreReaderSessions"] != 0:
            raise RuntimeError("Reader sessions remain after fresh launch/HTTP checks")
        report["passed"] = True
    finally:
        if started:
            run(["runuser", "-u", "postgres", "--", pg / "pg_ctl", "-D", data, "-m", "fast", "-w", "stop"])
            report["isolatedClusterStopped"] = True
        output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": report["passed"], "restoredRecords": report["database"]["records"]}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dependencies", action="store_true")
    parser.add_argument("--restore", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0 or not (args.dependencies ^ args.restore) or not PILOT.is_dir():
        raise SystemExit("Run one explicit phase as root inside the prepared clean userspace")
    dependencies() if args.dependencies else restore()
