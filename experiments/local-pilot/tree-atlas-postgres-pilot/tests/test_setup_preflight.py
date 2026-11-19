"""First-create must reject a broken checkout before any administrative action."""
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch


class SetupPreflightTests(unittest.TestCase):
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
