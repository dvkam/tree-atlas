"""Offline tests of the clean-environment input guards, not a clean-machine pass."""
import hashlib
import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("clean_room", Path(__file__).with_name("clean-room.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CleanRoomInputTests(unittest.TestCase):
    def test_windows_checkout_uses_only_fixed_native_git_and_separate_path_argument(self):
        repo = Path("/mnt/c/Users/Example Name/project")
        windows = "C:\\Users\\Example Name\\project"
        with patch.object(Path, "is_file", return_value=True), patch.object(module.subprocess, "check_output", return_value=windows + "\n") as convert:
            command, transport = module.source_git(repo)
        self.assertEqual(command, ["/mnt/c/Program Files/Git/cmd/git.exe", "-c", f"safe.directory={windows}", "-C", windows])
        self.assertIn("Windows", transport)
        convert.assert_called_once_with(["wslpath", "-w", str(repo)], text=True, timeout=10)

    def test_native_checkout_and_non_drive_mount_do_not_use_windows_git(self):
        for repo in (Path("/var/tmp/project"), Path("/mnt/cache/project")):
            with self.subTest(repo=repo), patch.object(Path, "is_file", return_value=True), patch.object(module.subprocess, "check_output") as convert:
                command, transport = module.source_git(repo)
                self.assertEqual(command[0], "git")
                self.assertIn("Linux", transport)
                convert.assert_not_called()

    def test_invalid_converted_path_is_rejected(self):
        with patch.object(Path, "is_file", return_value=True), patch.object(module.subprocess, "check_output", return_value="C:\\repo\nextra"):
            with self.assertRaisesRegex(RuntimeError, "Invalid Windows"):
                module.source_git(Path("/mnt/c/project"))

    def test_dirty_snapshot_fails_before_archive(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(module, "source_git", return_value=(["git"], "fixture")), patch.object(module.subprocess, "check_output", side_effect=["a" * 40, " M changed"]), patch.object(module.subprocess, "run") as archive:
            root = Path(directory)
            with self.assertRaisesRegex(RuntimeError, "clean tree"):
                module.snapshot(root, root / "rootfs", root)
            archive.assert_not_called()
            self.assertFalse((root / "source.tar").exists())

    def test_snapshot_archives_the_recorded_commit_with_bounded_checks(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(module, "source_git", return_value=(["git"], "fixture")), patch.object(module.subprocess, "check_output", side_effect=["a" * 40, ""]) as checks, patch.object(module.subprocess, "run") as archive, patch.object(module.tarfile, "open"):
            root = Path(directory)
            result = module.snapshot(root, root / "rootfs", root)
            self.assertEqual(result["commit"], "a" * 40)
            self.assertEqual(archive.call_args.args[0][2], "a" * 40)
            self.assertEqual(archive.call_args.kwargs["timeout"], 300)
            self.assertEqual([call.kwargs["timeout"] for call in checks.call_args_list], [30, 60])

    def test_existing_archive_requires_reviewed_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.tar.xz"
            path.write_bytes(b"corrupted")
            with patch("urllib.request.urlopen") as download:
                with self.assertRaisesRegex(ValueError, "reviewed checksum"):
                    module.fetch("https://example.invalid/archive", path, "0" * 64)
                download.assert_not_called()

    def test_matching_download_never_fetches_again(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.tar.xz"
            path.write_bytes(b"verified fixture")
            with patch("urllib.request.urlopen") as download:
                module.fetch("https://example.invalid/archive", path, hashlib.sha256(path.read_bytes()).hexdigest())
                download.assert_not_called()

    def test_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            info = tarfile.TarInfo("../../outside")
            with self.assertRaises(tarfile.OutsideDestinationError):
                module.image_filter(info, directory)

    def test_absolute_image_link_is_confined_but_preserves_in_root_meaning(self):
        with tempfile.TemporaryDirectory() as directory:
            info = tarfile.TarInfo("etc/example")
            info.type = tarfile.SYMTYPE
            info.linkname = "/usr/share/example"
            filtered = module.image_filter(info, directory)
            self.assertEqual(filtered.linkname, "../usr/share/example")
            self.assertEqual((Path(directory) / "etc" / filtered.linkname).resolve(),
                             Path(directory) / "usr/share/example")

    def test_device_nodes_are_not_extracted(self):
        info = tarfile.TarInfo("dev/null")
        info.type = tarfile.CHRTYPE
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(module.image_filter(info, directory))


if __name__ == "__main__":
    unittest.main()
