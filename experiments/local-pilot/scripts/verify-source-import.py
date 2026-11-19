"""Verify the index (before commit) or committed pilot without changing files."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

PILOT = Path(__file__).resolve().parents[1]
REPO = PILOT.parents[1]
BASE = "8fb090145c0852a83dec1038fa663e7ba15e0de3"
PREFIX = "experiments/local-pilot/"


def git(*args):
    return subprocess.check_output(["git", "-C", str(REPO), *args])


def verify(index=False):
    diff_args = ["diff", "--cached"] if index else ["diff", BASE, "HEAD"]
    if index:
        diff_args.append(BASE)
    changes = git(*diff_args, "--name-status", "--no-renames").decode().splitlines()
    for row in changes:
        status, path = row.split("\t", 1)
        if status != "A" or not (path.startswith(PREFIX) or path in (".eslintignore", ".prettierignore")):
            raise ValueError(f"Existing public file changed or unexpected path: {row}")
    if index:
        entries = git("ls-files", "--stage", "--", PREFIX).decode().splitlines()
        objects = [(row.split()[0], row.split()[1], row.split("\t", 1)[1]) for row in entries]
    else:
        entries = git("ls-tree", "-r", "HEAD", "--", PREFIX).decode().splitlines()
        objects = [(row.split()[0], row.split()[2], row.split("\t", 1)[1]) for row in entries]
    blobs = {}
    for mode, oid, path in objects:
        if mode != "100644" and mode != "100755":
            raise ValueError(f"Non-source Git entry (such as a symlink): {mode} {path}")
        data = git("cat-file", "blob", oid)
        if b"\0" in data or data.startswith((b"\x7fELF", b"MZ", b"PK\x03\x04")):
            raise ValueError(f"Binary artifact in source import: {path}")
        if len(data) > 5 * 1024 * 1024:
            raise ValueError(f"Unexpected bulk artifact: {path}")
        if any((b"-----BEGIN " + kind + b"PRIVATE KEY-----") in data for kind in (b"", b"RSA ")):
            raise ValueError(f"Private key in source import: {path}")
        blobs[path] = data
    contract = PREFIX + "tree-atlas-contract-v1/"
    seal = json.loads(blobs[contract + "freeze-v1.json"])
    for entry in seal["files"]:
        data = blobs[contract + entry["file"]]
        if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError(f"Git blob violates frozen seal: {entry['file']}")
    history = PREFIX + "historical/"
    historical_count = 0
    if history + "index.json" in blobs:
        for entry in json.loads(blobs[history + "index.json"])["files"]:
            data = blobs[history + entry["file"]]
            if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
                raise ValueError(f"Git blob differs from archived evidence hash: {entry['file']}")
            historical_count += 1
    return {"passed": True, "target": "index" if index else "HEAD", "base": BASE,
            "sourceFiles": len(objects), "sealedGitBlobsVerified": len(seal["files"]),
            "historicalGitBlobsVerified": historical_count,
            "existingPublicFilesChanged": 0, "symlinksOrBinariesCommitted": 0}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", action="store_true")
    print(json.dumps(verify(parser.parse_args().index), indent=2))
