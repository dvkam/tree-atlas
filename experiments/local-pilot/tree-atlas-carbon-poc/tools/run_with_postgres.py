"""Read private WSL credentials without logging them, then run one local probe."""
import json
import os
import subprocess
import sys
from pathlib import Path

config = json.loads(Path("/home/david/.config/tree-atlas-carbon-poc/postgres.json").read_text())
env = dict(os.environ)
env["TREE_ATLAS_PG"] = " ".join(f"{key}={value}" for key, value in config.items())
env["TREE_ATLAS_PG"] += " connect_timeout=2 application_name=tree_atlas_carbon_poc"
result = subprocess.run(sys.argv[1:], env=env, timeout=15)
sys.exit(result.returncode)
