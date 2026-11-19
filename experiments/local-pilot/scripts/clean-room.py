"""Build a disposable clean Ubuntu userspace and restore into its isolated cluster.

Run as WSL root. Downloads/installations stay in a newly created native directory.
The existing server is read only for pg_dump. Runtime uses private mount, PID and
network namespaces; its database cannot connect to the host's loopback listener.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request

PILOT = Path(__file__).resolve().parents[1]
REPO = PILOT.parents[1]
IMAGE = {
    "url": "https://cloud-images.ubuntu.com/minimal/releases/noble/release/ubuntu-24.04-minimal-cloudimg-amd64-root.tar.xz",
    "sha256": "10c5f5cdef565404592ff17ba836cfc1b12f45f736db17fe7781cf32b1760dca",
    "publishedBuild": "20261105",
}
PACKAGES = ["ca-certificates", "curl", "xz-utils", "python3", "git", "build-essential",
            "pkg-config", "bison", "flex", "libssl-dev", "libjson-c-dev",
            "libmicrohttpd-dev", "postgresql-16", "postgresql-client-16"]


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch(url, target, expected):
    if target.exists():
        if sha256(target) != expected:
            raise ValueError("Existing download does not match its reviewed checksum")
        return
    temporary = target.with_suffix(target.suffix + ".part")
    with urllib.request.urlopen(url, timeout=60) as source, temporary.open("xb") as output:
        shutil.copyfileobj(source, output)
    if sha256(temporary) != expected:
        raise ValueError("Downloaded file does not match its reviewed checksum")
    temporary.rename(target)


def image_filter(member, destination):
    if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
        return None  # /dev is supplied only inside the disposable mount namespace.
    if member.issym() and member.linkname.startswith("/"):
        member = member.replace(linkname=os.path.relpath(member.linkname.lstrip("/"),
                                                        str(Path(member.name).parent)))
    return tarfile.data_filter(member, destination)


def checked(args, log, *, env=None, timeout=1800, cwd=None):
    with log.open("ab") as output:
        result = subprocess.run(list(map(str, args)), cwd=cwd, env=env, stdout=output,
                                stderr=subprocess.STDOUT, timeout=timeout, stdin=subprocess.DEVNULL)
    if result.returncode:
        raise RuntimeError(f"Command failed; inspect {log.name}")


def clean_environment():
    return {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "HOME": "/root", "LANG": "C.UTF-8", "DEBIAN_FRONTEND": "noninteractive"}


def chroot_call(rootfs, arguments, log, timeout=1800):
    checked(namespace_command(["python3", PILOT / "scripts/clean-room-namespace.py", rootfs, "--online", *arguments]),
            log, env=clean_environment(), timeout=timeout)


def namespace_command(arguments, *, offline=False):
    flags = ["--mount", "--pid", "--fork", "--kill-child=KILL"]
    if offline:
        flags.append("--net")
    return ["unshare", *flags, *map(str, arguments)]


def snapshot(repo, rootfs, work):
    """Read committed source, never dereference original dependency symlinks."""
    git = ["git", "-c", f"safe.directory={repo}", "-C", str(repo)]
    head = subprocess.check_output([*git, "rev-parse", "HEAD"], text=True).strip()
    if subprocess.check_output([*git, "status", "--porcelain"], text=True).strip():
        raise RuntimeError("Commit the tested source first; clean-room snapshots require a clean tree")
    archive = work / "source.tar"
    with archive.open("wb") as stream:
        subprocess.run([*git, "archive", "HEAD", "experiments/local-pilot",
                        "public/data", "LICENSE", "NOTICE"], stdout=stream, check=True)
    destination = rootfs / "work/tree-atlas"
    destination.mkdir(parents=True)
    with tarfile.open(archive) as source:
        source.extractall(destination, filter="data")
    return {"commit": head, "archiveSha256": sha256(archive), "archiveBytes": archive.stat().st_size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, help="Existing prepared workspace for --run; never a host database path")
    parser.add_argument("--prepare", action="store_true", help="Download, extract and install fresh OS prerequisites only")
    parser.add_argument("--run", action="store_true", help="Snapshot committed source, dump host read-only, and run isolated restore/build checks")
    args = parser.parse_args()
    if os.geteuid() != 0 or not (args.prepare ^ args.run):
        raise SystemExit("Run as WSL root with exactly one of --prepare or --run")
    if args.prepare:
        if args.workspace is not None:
            raise SystemExit("Preparation always creates a new native workspace; it never reuses one")
        if shutil.disk_usage("/var/tmp").free < 12 * 1024**3:
            raise SystemExit("At least 12 GiB free in the native filesystem is required")
        if Path("/mnt/c").exists() and shutil.disk_usage("/mnt/c").free < 20 * 1024**3:
            raise SystemExit("Keep at least 20 GiB free on the Windows backing drive before this experiment")
        workspace = Path(tempfile.mkdtemp(prefix="tree-atlas-clean-", dir="/var/tmp"))
        workspace.chmod(0o700)
        rootfs = workspace / "rootfs"
        rootfs.mkdir()
        report = {"passed": False, "scope": "Fresh Ubuntu 24.04 userspace on shared WSL kernel; not a fresh VM or hosted proof",
                  "image": IMAGE, "workspace": str(workspace), "startedAtUtc": datetime.now(timezone.utc).isoformat(), "stages": {}}
        report_path = workspace / "report.json"
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        start = time.monotonic()
        image = workspace / "ubuntu-root.tar.xz"
        fetch(IMAGE["url"], image, IMAGE["sha256"])
        with tarfile.open(image) as source:
            source.extractall(rootfs, filter=image_filter)
        for name in ("tmp", "var/tmp"):
            directory = rootfs / name
            directory.mkdir(parents=True, exist_ok=True)
            directory.chmod(0o1777)
        report["stages"]["image"] = {"seconds": round(time.monotonic() - start, 3), "verifiedSha256": sha256(image)}
        # Copy DNS, never bind host /etc or any dependency/cache into the image.
        resolver = rootfs / "etc/resolv.conf"
        resolver.unlink(missing_ok=True)
        resolver.write_text(Path("/etc/resolv.conf").read_text())
        policy = rootfs / "usr/sbin/policy-rc.d"
        policy.write_text("#!/bin/sh\nexit 101\n")
        policy.chmod(0o755)
        sources = rootfs / "etc/apt/sources.list.d/ubuntu.sources"
        sources.write_text(sources.read_text().replace("http://archive.ubuntu.com/", "https://archive.ubuntu.com/")
                           .replace("http://security.ubuntu.com/", "https://security.ubuntu.com/"))
        (rootfs / "etc/apt/apt.conf.d/99pilot-network").write_text(
            'Acquire::ForceIPv4 "true";\nAcquire::Retries "2";\n'
            'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n')
        report["aptTransport"] = "Official Ubuntu mirrors over HTTPS, IPv4, two retries and 30-second request timeouts; signatures unchanged"
        absent = ["usr/bin/g++", "usr/bin/node", "usr/bin/psql", "usr/include/microhttpd.h",
                  "usr/include/json-c/json.h", "usr/include/postgresql/libpq-fe.h", "root/.npm",
                  "home/david/.nvm/versions/node/v26.13.0/bin/node",
                  "work/tree-atlas/experiments/local-pilot/tree-atlas-carbon-poc/tools"]
        if any((rootfs / path).exists() for path in absent):
            raise RuntimeError("Unexpected preinstalled pilot compiler/dependencies in the clean image")
        report["freshInputsAbsent"] = absent
        start = time.monotonic()
        log = workspace / "apt.log"
        chroot_call(rootfs, ["apt-get", "update"], log)
        chroot_call(rootfs, ["apt-get", "install", "-y", "--no-install-recommends", *PACKAGES], log)
        packages = subprocess.check_output(["chroot", str(rootfs), "dpkg-query", "-W"], text=True)
        (workspace / "packages.txt").write_text(packages)
        clusters = subprocess.check_output(["chroot", str(rootfs), "pg_lsclusters", "--no-header"], text=True).splitlines()
        if any(line.split()[3] != "down" for line in clusters):
            raise RuntimeError("A PostgreSQL cluster is running after clean image package installation")
        owned = []
        for process in Path("/proc").iterdir():
            if process.name.isdigit():
                try:
                    if (process / "root").resolve() == rootfs:
                        owned.append(int(process.name))
                except (OSError, RuntimeError):
                    pass
        if owned:
            raise RuntimeError("An installed userspace process survived its preparation namespace")
        report["stages"]["osPackages"] = {"seconds": round(time.monotonic() - start, 3),
                                         "installedPackages": PACKAGES, "policyRcDRejectsAutoStart": True,
                                         "clustersAfterInstall": clusters, "ownedProcessesAfterInstall": owned}
        report["prepared"] = True
        report["diskBytesAtCheckpoints"] = {"prepared": int(subprocess.check_output(["du", "-sb", str(workspace)]).split()[0])}
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"prepared": True, "workspace": str(workspace)}), flush=True)
        return
    workspace = args.workspace
    if workspace is None or workspace.is_symlink():
        raise SystemExit("--run needs the prepared native workspace path")
    workspace = workspace.resolve(strict=True)
    if workspace.parent != Path("/var/tmp") or not workspace.name.startswith("tree-atlas-clean-"):
        raise SystemExit("Refusing a workspace outside the dedicated /var/tmp/tree-atlas-clean-* directory")
    report_path = workspace / "report.json"
    report = json.loads(report_path.read_text())
    if report.get("workspace") != str(workspace) or report.get("prepared") is not True:
        raise SystemExit("Workspace does not contain a completed clean-image preparation")
    report["runStartedAtUtc"] = datetime.now(timezone.utc).isoformat()
    rootfs = workspace / "rootfs"
    if rootfs.is_symlink() or not rootfs.is_dir():
        raise SystemExit("Invalid disposable rootfs")
    report["source"] = snapshot(REPO, rootfs, workspace)
    dump = workspace / "inventory.dump"
    if dump.exists():
        raise SystemExit("Dump already exists; retain this evidence and use a newly prepared run")
    environment = clean_environment()
    environment["PGOPTIONS"] = "-c default_transaction_read_only=on"
    environment["PGAPPNAME"] = "tree_atlas_clean_room_dump"
    start = time.monotonic()
    with dump.open("xb") as output:
        result = subprocess.run(["runuser", "-u", "postgres", "--", "pg_dump", "-h", "/var/run/postgresql",
                                 "-p", "5432", "-U", "postgres", "-d", "tree_atlas_pilot", "-Fc", "-Z6"],
                                stdout=output, stderr=subprocess.PIPE, env=environment, timeout=1200)
    dump.chmod(0o600)
    if result.returncode:
        raise RuntimeError("Read-only source dump failed; private diagnostics suppressed")
    report["stages"]["dump"] = {"seconds": round(time.monotonic() - start, 3), "bytes": dump.stat().st_size,
                                "sha256": sha256(dump), "sourceDatabaseWrites": False,
                                "defaultTransactionReadOnly": True}
    shutil.copyfile(dump, rootfs / "work/inventory.dump")
    # Fetch/build dependencies before isolating network; apt cannot start services.
    runtime = rootfs / "work/tree-atlas/experiments/local-pilot/scripts/clean-room-runtime.py"
    start = time.monotonic()
    chroot_call(rootfs, ["python3", "/" + str(runtime.relative_to(rootfs)), "--dependencies"],
                workspace / "dependencies.log", timeout=1800)
    report["stages"]["dependencies"] = {"seconds": round(time.monotonic() - start, 3),
                                       "result": json.loads((rootfs / "work/dependency-result.json").read_text())}
    report["diskBytesAtCheckpoints"]["dependencies"] = int(subprocess.check_output(["du", "-sb", str(workspace)]).split()[0])
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    # A fresh PID namespace guarantees any abandoned child is killed on init exit.
    command = namespace_command(["python3", PILOT / "scripts/clean-room-namespace.py", rootfs], offline=True)
    checked(command, workspace / "runtime.log", env=environment, timeout=1800)
    report["runtime"] = json.loads((rootfs / "work/runtime-result.json").read_text())
    report["diskBytesAtCheckpoints"]["completed"] = int(subprocess.check_output(["du", "-sb", str(workspace)]).split()[0])
    report["passed"] = report["runtime"]["passed"]
    report["completedAtUtc"] = datetime.now(timezone.utc).isoformat()
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    destination = PILOT / ".verification/clean-room"
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(report_path, destination / "report.json")
    print(json.dumps({"passed": report["passed"], "workspace": str(workspace)}), flush=True)


if __name__ == "__main__":
    main()
