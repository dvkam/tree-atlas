"""Prove historical, decoded and metadata checks with non-authentic controls."""
import contextlib
import gzip
import hashlib
import io
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


@unittest.skipUnless(sys.platform == "linux" and shutil.which("git"), "Linux Git fixture")
class HistoryBlobReviewTests(unittest.TestCase):
    def test_deleted_raw_gzip_boundary_and_old_metadata_are_detected(self):
        source = Path(__file__).with_name("review-history-blobs.py")
        controls = [hashlib.sha256(f"non-authentic review control {i}".encode()).hexdigest()[:32]
                    for i in range(4)]
        config_paths = [Path("/home/david/.config/tree-atlas-postgres-pilot") / f"{name}.json"
                        for name in ("loader", "postgres", "reader")]
        config_paths.append(Path("/home/david/.config/tree-atlas-carbon-poc/postgres.json"))
        configuration = dict(zip(config_paths, controls, strict=True))
        original_read = Path.read_text

        def read_config(path, *args, **kwargs):
            if path in configuration:
                return json.dumps({"password": configuration[path]})
            return original_read(path, *args, **kwargs)

        with tempfile.TemporaryDirectory(prefix="tree-atlas-secret-review-fixture-", dir="/var/tmp") as repo_name, \
             tempfile.TemporaryDirectory(prefix="tree-atlas-secret-review-unit-", dir="/var/tmp") as work_name:
            repo = Path(repo_name)
            work = Path(work_name)
            git = ["git", "-c", "user.name=David Kaminski", "-c",
                   "user.email=82422481+dvkam@users.noreply.github.com", "-c", "commit.gpgsign=false"]

            def command(*arguments):
                return subprocess.check_output([*git, *arguments], cwd=repo, stderr=subprocess.PIPE)

            command("init", "--quiet", "--initial-branch=main")
            (repo / "gone.txt").write_text(controls[0])
            boundary = b"a" * (1024 * 1024 - 8) + controls[1].encode() + b"z" * 40
            (repo / "payload.bin").write_bytes(gzip.compress(boundary))
            named = repo / ("old-name-" + controls[3] + ".txt")
            named.write_text("benign payload")
            command("add", ".")
            command("commit", "--quiet", "-m", "control message " + controls[2])
            (repo / "gone.txt").unlink()
            named.unlink()
            command("add", "-u")
            command("commit", "--quiet", "-m", "remove controls from current tree")
            head = command("rev-parse", "HEAD").decode().strip()
            with patch.object(sys, "argv", [str(source), "--repo", str(repo), "--head", head,
                                             "--workspace", str(work)]), \
                 patch.object(Path, "read_text", read_config), \
                 patch("shutil.disk_usage", return_value=SimpleNamespace(free=100 * 1024**3)), \
                 contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as rejected:
                    runpy.run_path(str(source), run_name="__main__")
            self.assertEqual(rejected.exception.code, 1)
            report = json.loads((work / "blob-review.json").read_text())
            self.assertFalse(report["passed"])
            self.assertEqual(report["state"], "complete")
            self.assertEqual(report["reachableCommits"], 2)
            self.assertEqual(report["processedBlobs"], 3)
            self.assertEqual(report["gzipBlobs"], 1)
            self.assertEqual(len(report["knownCredentialMatches"]), 3)
            kinds = {(item["path"], item["encoding"]) for item in report["knownCredentialMatches"]}
            self.assertEqual(kinds, {("gone.txt", "raw"), ("payload.bin", "gzip"),
                                     ("[commit/path metadata]", "raw")})
            metadata = (work / "exported-blobs/history-messages-and-paths.txt").read_text()
            self.assertIn(controls[2], metadata)
            self.assertIn(controls[3], metadata)
            self.assertNotIn("gone.txt", command("ls-files").decode())
            payload_oid = command("rev-parse", "HEAD:payload.bin").decode().strip()
            self.assertEqual((work / "exported-blobs" / (payload_oid + ".blob")).read_bytes(), boundary)


if __name__ == "__main__":
    unittest.main()
