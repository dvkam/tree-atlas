"""First-create must reject a broken checkout before any administrative action."""
import os
import contextlib
import io
from pathlib import Path
import runpy
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class SetupPreflightTests(unittest.TestCase):
    def test_symlink_or_file_config_parent_is_rejected_before_sql(self):
        source = Path(__file__).resolve().parents[1] / "setup_database.py"
        real_path = Path
        for kind in ("symlink", "file"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = real_path(directory)
                script = root / "setup_database.py"
                script.write_bytes(source.read_bytes())
                (root / "schema.sql").write_text("SELECT 1;")
                parent = root / ".config"
                if kind == "symlink":
                    target = root / "target"
                    target.mkdir()
                    parent.symlink_to(target, target_is_directory=True)
                else:
                    parent.write_text("not a directory")
                config = parent / "tree-atlas-postgres-pilot"
                def local_path(*args, **kwargs):
                    return config if args == ('/home/david/.config/tree-atlas-postgres-pilot',) else real_path(*args, **kwargs)
                with patch("pathlib.Path", side_effect=local_path), patch("os.geteuid", return_value=0), \
                     patch("subprocess.run") as sql, patch("os.chown") as ownership, patch.dict(os.environ):
                    with self.assertRaisesRegex(SystemExit, "real directory"):
                        runpy.run_path(str(script), run_name="__main__")
                sql.assert_not_called()
                ownership.assert_not_called()

    def test_fresh_home_without_config_parent_creates_private_owned_directories(self):
        self.check_private_directory_creation(False)

    def test_existing_config_parent_keeps_its_metadata(self):
        self.check_private_directory_creation(True)

    def check_private_directory_creation(self, existing_parent):
        source = Path(__file__).resolve().parents[1] / "setup_database.py"
        real_path = Path
        with tempfile.TemporaryDirectory() as directory:
            root = real_path(directory)
            home = root / "home/david"
            home.mkdir(parents=True)
            config = home / ".config/tree-atlas-postgres-pilot"
            if existing_parent:
                config.parent.mkdir(mode=0o755)
            script = root / "setup_database.py"
            script.write_bytes(source.read_bytes())
            (root / "schema.sql").write_text("SELECT 1;")
            def local_path(*args, **kwargs):
                return config if args == ('/home/david/.config/tree-atlas-postgres-pilot',) else real_path(*args, **kwargs)
            with patch("pathlib.Path", side_effect=local_path), patch("os.geteuid", return_value=0), \
                 patch("pwd.getpwnam", return_value=SimpleNamespace(pw_uid=1234, pw_gid=5678)), \
                 patch("os.chown") as ownership, patch("subprocess.run", return_value=SimpleNamespace(returncode=0, stdout="0")), \
                 patch.dict(os.environ), contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(script), run_name="__main__")
            self.assertEqual(config.parent.stat().st_mode & 0o777, 0o755 if existing_parent else 0o700)
            self.assertEqual(config.stat().st_mode & 0o777, 0o700)
            if existing_parent:
                self.assertFalse(any(call.args[0] == config.parent for call in ownership.call_args_list))
            else:
                ownership.assert_any_call(config.parent, 1234, 5678)
            ownership.assert_any_call(config, 1234, 5678)
            self.assertEqual(len(list(config.glob("*.json"))), 3)
            for path in config.glob("*.json"):
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_missing_schema_performs_no_sql_or_private_directory_creation(self):
        self.check_bad_schema(None, FileNotFoundError)

    def test_empty_schema_performs_no_sql_or_private_directory_creation(self):
        self.check_bad_schema("\n", SystemExit)

    def check_bad_schema(self, schema, error):
        source = Path(__file__).resolve().parents[1] / "setup_database.py"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / "setup_database.py"
            script.write_bytes(source.read_bytes())
            if schema is not None:
                (root / "schema.sql").write_text(schema)
            with patch("subprocess.run") as sql, patch("pathlib.Path.mkdir") as mkdir, \
                 patch("pwd.getpwnam") as lookup, patch.dict(os.environ):
                with self.assertRaises(error):
                    runpy.run_path(str(script), run_name="__main__")
                sql.assert_not_called()
                mkdir.assert_not_called()
                lookup.assert_not_called()


if __name__ == "__main__":
    unittest.main()
