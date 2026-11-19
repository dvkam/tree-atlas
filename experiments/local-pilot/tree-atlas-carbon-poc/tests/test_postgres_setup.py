"""Verify the native WSL database and its real restricted runtime role."""
import json
import os
import subprocess
import unittest
from pathlib import Path

class PostgresSetupProof(unittest.TestCase):
    def query(self, statement):
        config = json.loads(Path("/home/david/.config/tree-atlas-carbon-poc/postgres.json").read_text())
        env = dict(os.environ)
        env.update(PGHOST=config["host"], PGPORT=str(config["port"]),
                   PGDATABASE=config["dbname"], PGUSER=config["user"],
                   PGPASSWORD=config["password"])
        return subprocess.run(["psql", "-X", "-At", "-v", "ON_ERROR_STOP=1"],
                              input=statement, text=True, capture_output=True,
                              env=env, timeout=5)

    def test_reads_real_fixture(self):
        result = self.query("SELECT id, label FROM public.poc_probe")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "0007|Platane – Zürich 🌳")

    def test_cannot_insert(self):
        result = self.query("INSERT INTO public.poc_probe VALUES ('denied', 'must not write')")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("permission denied", result.stderr)

    def test_cannot_create_table(self):
        result = self.query("CREATE TABLE public.denied (id integer)")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("permission denied", result.stderr)

if __name__ == "__main__": unittest.main(verbosity=2)
