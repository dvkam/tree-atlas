"""One-time tightening of the already-created, dedicated PoC database role."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROLE = DATABASE = "tree_atlas_poc"

def sql(statement, database="postgres"):
    return subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "-X", "-v", "ON_ERROR_STOP=1",
         "-p", "5432", "-d", database, "-At"],
        input=statement, text=True, capture_output=True, check=True,
    ).stdout.strip()

# This migration is intentionally separate from the first-create-only setup.
sql(f"ALTER DATABASE {DATABASE} OWNER TO postgres; "
    f"REVOKE ALL ON DATABASE {DATABASE} FROM PUBLIC; "
    f"GRANT CONNECT ON DATABASE {DATABASE} TO {ROLE};")
sql("ALTER TABLE public.poc_probe OWNER TO postgres; "
    "REVOKE CREATE ON SCHEMA public FROM PUBLIC; "
    f"GRANT USAGE ON SCHEMA public TO {ROLE}; "
    f"GRANT SELECT ON public.poc_probe TO {ROLE};", DATABASE)
path = ROOT / "evidence/postgres-setup.json"
evidence = json.loads(path.read_text())
evidence["database_owner"] = "postgres"
evidence["role_select_fixture"] = sql(f"SELECT has_table_privilege('{ROLE}', 'poc_probe', 'SELECT')", DATABASE)
evidence["role_insert_fixture"] = sql(f"SELECT has_table_privilege('{ROLE}', 'poc_probe', 'INSERT')", DATABASE)
evidence["role_create_schema"] = sql(f"SELECT has_schema_privilege('{ROLE}', 'public', 'CREATE')", DATABASE)
path.write_text(json.dumps(evidence, indent=2))
print(json.dumps(evidence, indent=2))
