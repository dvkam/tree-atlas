"""Regression checks for compatibility-path ownership and refusal behavior."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("prepare-workspace.py")
spec = importlib.util.spec_from_file_location("pilot_workspace", SCRIPT)
if spec is None or spec.loader is None:
    raise RuntimeError("Cannot import workspace preparation module")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WorkspacePaths(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tree-atlas-workspace-")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name).resolve()
        self.workspace = self.repo / "experiments/local-pilot"
        self.workspace.mkdir(parents=True)
        self.source = self.repo / "public/data"
        self.source.mkdir(parents=True)
        (self.source / "manifest.json").write_text('{"fixture":true}\n')
        self.link = self.workspace / "tree-atlas/public/data"

    def test_creates_relative_input_link_and_is_idempotent(self):
        before = (self.source / "manifest.json").read_bytes()
        self.assertTrue(module.prepare(self.repo)["created"])
        self.assertEqual(self.link.resolve(), self.source)
        self.assertFalse(Path(self.link.readlink()).is_absolute())
        self.assertFalse(module.prepare(self.repo)["created"])
        self.assertEqual((self.source / "manifest.json").read_bytes(), before)

    def test_refuses_real_directory_without_changing_it(self):
        self.link.mkdir(parents=True)
        sentinel = self.link / "sentinel"
        sentinel.write_text("keep")
        with self.assertRaisesRegex(RuntimeError, "existing asset path"):
            module.prepare(self.repo)
        self.assertEqual(sentinel.read_text(), "keep")

    def test_refuses_wrong_or_broken_link(self):
        self.link.parent.mkdir(parents=True)
        self.link.symlink_to(self.repo / "missing", target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "points elsewhere"):
            module.prepare(self.repo)
        self.assertTrue(self.link.is_symlink())

    def test_refuses_linked_compatibility_parent(self):
        other = self.repo / "elsewhere"
        other.mkdir()
        (self.workspace / "tree-atlas").symlink_to(other, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "unexpected compatibility path"):
            module.prepare(self.repo)
        self.assertFalse((other / "public").exists())

    def test_refuses_missing_manifest_before_creating_compatibility_paths(self):
        (self.source / "manifest.json").unlink()
        with self.assertRaisesRegex(RuntimeError, "manifest.json is missing"):
            module.prepare(self.repo)
        self.assertFalse((self.workspace / "tree-atlas").exists())


if __name__ == "__main__":
    unittest.main()
