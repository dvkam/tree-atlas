import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("reuse_tools", Path(__file__).with_name("reuse-local-tools.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReuseToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "original"
        self.target = self.root / "checkout"
        self.target.mkdir()
        for relative, marker in module.LINKS:
            path = self.source / relative / marker
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture")

    def test_explicit_links_are_idempotent_and_source_is_unchanged(self):
        self.assertEqual(module.reuse(self.source, self.target), 4)
        self.assertEqual(module.reuse(self.source, self.target), 0)
        for relative, marker in module.LINKS:
            self.assertTrue((self.target / relative).is_symlink())
            self.assertEqual((self.source / relative / marker).read_text(), "fixture")

    def test_incomplete_source_leaves_no_partial_links(self):
        relative, marker = module.LINKS[-1]
        (self.source / relative / marker).unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            module.reuse(self.source, self.target)
        self.assertEqual(list(self.target.iterdir()), [])

    def test_existing_installation_is_never_replaced(self):
        relative, _ = module.LINKS[-1]
        target = self.target / relative
        target.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, "existing installation"):
            module.reuse(self.source, self.target)
        self.assertFalse((self.target / module.LINKS[0][0]).exists())

    def test_symlink_parent_cannot_redirect_writes(self):
        (self.target / "tree-atlas-carbon-poc").symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlinked destination parent"):
            module.reuse(self.source, self.target)


if __name__ == "__main__":
    unittest.main()
