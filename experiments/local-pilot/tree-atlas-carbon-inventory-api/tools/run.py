"""Launch only the local read-only inventory role; credentials never enter argv."""
import json
import os
import stat
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CONFIG=Path('/home/david/.config/tree-atlas-postgres-pilot/reader.json')
if stat.S_IMODE(CONFIG.stat().st_mode)!=0o600: raise SystemExit('Private configuration must have mode 0600')
config=json.loads(CONFIG.read_text())
if (config['host'],int(config['port']),config['dbname'],config['user'])!=('127.0.0.1',5432,'tree_atlas_pilot','tree_atlas_reader'):
    raise SystemExit('Only the dedicated local inventory reader is accepted')
def quote(value): return "'"+str(value).replace('\\','\\\\').replace("'","\\'")+"'"
environment={key:value for key,value in os.environ.items() if not key.startswith('PG')}
environment['TREE_ATLAS_PG']=' '.join(f'{key}={quote(value)}' for key,value in config.items())+" connect_timeout=3 options='-c default_transaction_read_only=on -c statement_timeout=3500 -c lock_timeout=3500'"
os.execve(ROOT/'build/service',[str(ROOT/'build/service')],environment)
