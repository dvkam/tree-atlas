"""Create only the dedicated PoC role/database in the new native WSL cluster.

Run as WSL root after installing PostgreSQL. Passwords never enter argv or logs.
"""
import json
import os
import pwd
import secrets
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROLE = "tree_atlas_poc"
DATABASE = "tree_atlas_poc"
CONFIG = Path("/home/david/.config/tree-atlas-carbon-poc/postgres.json")

def sql(statement, database="postgres"):
    result = subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "-X", "-v", "ON_ERROR_STOP=1",
         "-p", "5432", "-d", database, "-At"],
        input=statement, text=True, capture_output=True, check=True,
    )
    return result.stdout.strip()

if os.geteuid() != 0:
    raise SystemExit("Run as WSL root; no secrets are printed.")

if sql(f"SELECT count(*) FROM pg_roles WHERE rolname='{ROLE}'") != "0":
    raise SystemExit("Role already exists; refusing to change an existing role.")
if sql(f"SELECT count(*) FROM pg_database WHERE datname='{DATABASE}'") != "0":
    raise SystemExit("Database already exists; refusing to change an existing database.")
if CONFIG.exists():
    raise SystemExit("Private configuration already exists; refusing overwrite.")

password = secrets.token_hex(24)
sql(f"CREATE ROLE {ROLE} LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB "
    "NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;")
sql(f"CREATE DATABASE {DATABASE} OWNER postgres ENCODING 'UTF8' TEMPLATE template0;")
sql(f"REVOKE ALL ON DATABASE {DATABASE} FROM PUBLIC; GRANT CONNECT ON DATABASE {DATABASE} TO {ROLE};")
sql(f"ALTER ROLE {ROLE} SET statement_timeout = '2s'; "
    f"ALTER ROLE {ROLE} SET lock_timeout = '1s';")
sql("CREATE TABLE public.poc_probe (id text PRIMARY KEY, label text NOT NULL); "
    "INSERT INTO public.poc_probe VALUES ('0007', 'Platane – Zürich 🌳'); "
    "REVOKE CREATE ON SCHEMA public FROM PUBLIC; "
    f"GRANT USAGE ON SCHEMA public TO {ROLE}; "
    f"GRANT SELECT ON public.poc_probe TO {ROLE};", DATABASE)

CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
user = pwd.getpwnam("david")
os.chown(CONFIG.parent, user.pw_uid, user.pw_gid)
os.chmod(CONFIG.parent, 0o700)
fd = os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as file:
    json.dump({"host": "127.0.0.1", "port": 5432, "dbname": DATABASE,
               "user": ROLE, "password": password}, file)
os.chown(CONFIG, user.pw_uid, user.pw_gid)

evidence = {
    "database": DATABASE, "role": ROLE, "host": "127.0.0.1", "port": 5432,
    "version": sql("SELECT version()"),
    "listen_addresses": sql("SHOW listen_addresses"),
    "password_encryption": sql("SHOW password_encryption"),
    "role_superuser": sql(f"SELECT rolsuper FROM pg_roles WHERE rolname='{ROLE}'"),
    "private_config": str(CONFIG), "private_config_mode": "0600",
    "fixture": "synthetic feasibility data only",
}
(ROOT / "evidence/postgres-setup.json").write_text(json.dumps(evidence, indent=2))
print(json.dumps(evidence, indent=2))
