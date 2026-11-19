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
