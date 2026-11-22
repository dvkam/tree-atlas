"""Export every reachable blob for local secret review, including gzip payloads.

This helper never prints matching bytes. Private reports stay in the caller's
0700 native workspace. Known-password matching supplements a general scanner;
it does not replace one or prove that arbitrary hidden credentials cannot exist.
"""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve(strict=True)
    work = args.workspace.resolve(strict=True)
    if work.parent != Path("/var/tmp") or not work.name.startswith("tree-atlas-secret-review-"):
        raise SystemExit("Use the dedicated private native review directory")
    if work.stat().st_mode & 0o777 != 0o700:
        raise SystemExit("The review workspace must have mode 0700")
    if shutil.disk_usage(work).free < 20 * 1024**3:
        raise SystemExit("At least 20 GiB of native free space is required")
    if Path("/mnt/c").exists() and shutil.disk_usage("/mnt/c").free < 20 * 1024**3:
        raise SystemExit("Keep at least 20 GiB free on the backing Windows drive")
    git = ["git", "-C", str(repo)]
    head = subprocess.check_output([*git, "rev-parse", args.head], text=True, timeout=30).strip()
    if len(head) != 40 or any(char not in "0123456789abcdef" for char in head):
        raise SystemExit("Expected an exact SHA-1 commit")
    objects = subprocess.check_output([*git, "rev-list", "--objects", head], timeout=120).decode().splitlines()
    names = {line.split(" ", 1)[0]: line.split(" ", 1)[1] if " " in line else None for line in objects}
    metadata = subprocess.run(
        [*git, "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
        input="\n".join(names) + "\n", text=True, capture_output=True, check=True, timeout=180,
    )
    blobs = [(line.split()[0], int(line.split()[2]), names[line.split()[0]])
             for line in metadata.stdout.splitlines() if line.split()[1] == "blob"]
    (work / "blob-index.json").write_text(json.dumps(blobs, indent=2) + "\n")
    credentials = []
    credential_files = [Path("/home/david/.config/tree-atlas-postgres-pilot") / f"{name}.json"
                        for name in ("loader", "postgres", "reader")]
    credential_files.append(Path("/home/david/.config/tree-atlas-carbon-poc/postgres.json"))
    for path in credential_files:
        config = json.loads(path.read_text())
        password = config.get("password")
        if not isinstance(password, str) or len(password) < 16:
            raise SystemExit("Expected the existing generated local review credential")
        credentials.append(password.encode())
    overlap = max(map(len, credentials)) - 1

    def safe_path(value):
        if value is None:
            return None
        for password in credentials:
            value = value.replace(password.decode(), "[REDACTED]")
        return value
    export = work / "exported-blobs"
    export.mkdir(mode=0o700)
    metadata_bytes = subprocess.check_output(
        [*git, "-c", "core.quotepath=false", "log", "--root", "--full-history",
         "--no-renames", "--diff-merges=separate", "--name-only",
         "--format=COMMIT %H%nAUTHOR %an <%ae>%nCOMMITTER %cn <%ce>%n%B", head], timeout=120,
    )
    (export / "history-messages-and-paths.txt").write_bytes(metadata_bytes)
    report = {
        "passed": False, "state": "running", "head": head,
        "executionStartedAt": datetime.now(timezone.utc).isoformat(),
        "scope": "All unique blobs reachable from the supplied branch head. Raw and decoded gzip streams checked for the four current local database passwords; exported payloads require a separate general secret scanner.",
        "reachableCommits": int(subprocess.check_output([*git, "rev-list", "--count", head])),
        "uniqueBlobs": len(blobs), "rawBlobBytes": sum(row[1] for row in blobs),
        "largestRawBlobBytes": max(row[1] for row in blobs), "gzipBlobs": 0,
        "exportedBytes": 0, "processedBlobs": 0, "knownCredentialsChecked": len(credentials),
        "knownCredentialMatches": [], "binarySignatures": {},
        "metadataBytes": len(metadata_bytes), "metadataSha256": hashlib.sha256(metadata_bytes).hexdigest(),
        "metadataCoverage": "All commit messages, author/committer metadata and changed tree paths including root introductions, deletions and per-parent merge diffs.",
        "exportPolicy": "One oid.blob per unique Git blob. Gzip payloads are streamed to decoded content; other payloads remain exact raw bytes. Original paths remain in the private blob index. No extension/path allowlist is applied.",
    }
    if any(password in metadata_bytes for password in credentials):
        report["knownCredentialMatches"].append({"blob": None, "path": "[commit/path metadata]", "encoding": "raw"})
    report_path = work / "blob-review.json"

    def save():
        report_path.write_text(json.dumps(report, indent=2) + "\n")

    save()
    errors = []
    with (work / "cat-file.log").open("wb") as error_log:
        process = subprocess.Popen([*git, "cat-file", "--batch"], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=error_log)

        def supply():
            try:
                process.stdin.write("".join(oid + "\n" for oid, _, _ in blobs).encode())
                process.stdin.close()
            except Exception as error:
                errors.append(type(error).__name__)

        writer = threading.Thread(target=supply, daemon=True)
        writer.start()
        try:
            for oid, expected_size, path in blobs:
                header = process.stdout.readline().decode().split()
                if header != [oid, "blob", str(expected_size)]:
                    raise RuntimeError("Unexpected Git batch object header")
                raw = process.stdout.read(expected_size)
                if len(raw) != expected_size or process.stdout.read(1) != b"\n":
                    raise RuntimeError("Truncated Git batch object")
                if any(password in raw for password in credentials):
                    report["knownCredentialMatches"].append({"blob": oid, "path": safe_path(path), "encoding": "raw"})
                is_gzip = raw.startswith(b"\x1f\x8b\x08")
                if is_gzip:
                    report["gzipBlobs"] += 1
                for signature, magic in (("ELF", b"\x7fELF"), ("PE", b"MZ"),
                                         ("ZIP", b"PK\x03\x04"), ("PMTiles", b"PMTiles")):
                    if raw.startswith(magic):
                        report["binarySignatures"][signature] = report["binarySignatures"].get(signature, 0) + 1
                source = gzip.GzipFile(fileobj=io.BytesIO(raw)) if is_gzip else io.BytesIO(raw)
                tail = b""
                matched = False
                with source, (export / (oid + ".blob")).open("xb") as output:
                    while True:
                        block = source.read(1024 * 1024)
                        if not block:
                            break
                        candidate = tail + block
                        if is_gzip and not matched and any(password in candidate for password in credentials):
                            report["knownCredentialMatches"].append({"blob": oid, "path": safe_path(path), "encoding": "gzip"})
                            matched = True
                        tail = candidate[-overlap:]
                        output.write(block)
                        report["exportedBytes"] += len(block)
                        if report["exportedBytes"] > 16 * 1024**3:
                            raise RuntimeError("Decoded export exceeds the reviewed 16 GiB limit")
                report["processedBlobs"] += 1
                if report["processedBlobs"] % 5000 == 0:
                    save()
                    print(json.dumps({"processedBlobs": report["processedBlobs"], "exportedBytes": report["exportedBytes"]}), flush=True)
            writer.join(timeout=10)
            if writer.is_alive() or errors or process.wait(timeout=30) != 0:
                raise RuntimeError("Git batch export did not complete cleanly")
            report["passed"] = not report["knownCredentialMatches"]
            report["state"] = "complete"
            report["executionCompletedAt"] = datetime.now(timezone.utc).isoformat()
            report["privateIndexSha256"] = hashlib.sha256((work / "blob-index.json").read_bytes()).hexdigest()
            save()
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            writer.join(timeout=5)
            process.stdout.close()
            if not process.stdin.closed:
                process.stdin.close()
    print(json.dumps({"passed": report["passed"], "processedBlobs": report["processedBlobs"],
                      "gzipBlobs": report["gzipBlobs"], "exportedBytes": report["exportedBytes"],
                      "knownCredentialMatches": len(report["knownCredentialMatches"])}), flush=True)
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
