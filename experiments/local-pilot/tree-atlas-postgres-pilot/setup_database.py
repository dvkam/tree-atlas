"""First-create only. WSL root uses local peer administration; no secrets logged."""
import json
import os
import pwd
import secrets
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Read every required source artifact before creating configs, roles or a database.
# A source-only checkout must fail without leaving a partial first-create setup.
SCHEMA = (ROOT/'schema.sql').read_text(encoding='utf8')
if not SCHEMA.strip(): raise SystemExit('Required schema.sql is empty; no setup changes made')
CONFIG = Path('/home/david/.config/tree-atlas-postgres-pilot')
DATABASE = 'tree_atlas_pilot'
ROLES = {'loader': 'tree_atlas_loader', 'postgres': 'tree_atlas_verify', 'reader': 'tree_atlas_reader'}
for name in list(os.environ):
    if name.startswith('PG'): del os.environ[name]
def sql(text, database='postgres'):
    result = subprocess.run(['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1','-d',database],
                            input=text, text=True, capture_output=True)
    if result.returncode: raise RuntimeError('Local setup failed; private administrative diagnostics suppressed')
    return result.stdout.strip()
if os.geteuid()!=0: raise SystemExit('Run as WSL root')
if CONFIG.exists() or CONFIG.is_symlink(): raise SystemExit('Private directory exists; refusing overwrite')
if CONFIG.parent.is_symlink() or (CONFIG.parent.exists() and not CONFIG.parent.is_dir()):
    raise SystemExit('Private config parent must be a real directory')
if sql("SELECT count(*) FROM pg_database WHERE datname='tree_atlas_pilot'")!='0': raise SystemExit('Database exists')
for role in ROLES.values():
    if sql(f"SELECT count(*) FROM pg_roles WHERE rolname='{role}'")!='0': raise SystemExit('Role exists')
user = pwd.getpwnam('david')
if not CONFIG.parent.exists():
    CONFIG.parent.mkdir(mode=0o700)
    os.chown(CONFIG.parent,user.pw_uid,user.pw_gid)
CONFIG.mkdir(mode=0o700)
os.chown(CONFIG,user.pw_uid,user.pw_gid)
configs = {}
for name,role in ROLES.items():
    password = secrets.token_hex(24)
    sql(f"CREATE ROLE {role} LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;")
    configs[name] = {'host':'127.0.0.1','port':5432,'dbname':DATABASE,'user':role,'password':password}
sql(f"CREATE DATABASE {DATABASE} OWNER postgres ENCODING 'UTF8' TEMPLATE template0;")
sql(f"REVOKE ALL ON DATABASE {DATABASE} FROM PUBLIC; GRANT CONNECT ON DATABASE {DATABASE} TO {','.join(ROLES.values())};")
sql(SCHEMA,DATABASE)
for role in ['tree_atlas_verify','tree_atlas_reader']:
    sql(f"ALTER ROLE {role} SET default_transaction_read_only=on;")
for name,config in configs.items():
    path = CONFIG/f'{name}.json'
    fd = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as file: json.dump(config,file)
    os.chown(path,user.pw_uid,user.pw_gid)
(ROOT/'evidence').mkdir(exist_ok=True)
report = {'database':DATABASE,'server':sql('SHOW server_version',DATABASE),'roles':ROLES,
          'schemaVersion':1,'existingPocDatabaseChanged':False,'privateConfigDirectory':str(CONFIG),
          'privateDirectoryMode':'0700','privateFileMode':'0600','deployment':False}
(ROOT/'evidence/setup.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
