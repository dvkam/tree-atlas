"""Install read-only local API functions. Does not alter records or publish."""
import os
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.geteuid()!=0: raise SystemExit('Run as WSL root')
env={key:value for key,value in os.environ.items() if not key.startswith('PG')}
args=['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-v','ON_ERROR_STOP=1','-d','tree_atlas_pilot']
# The peer admin can read the input stream even when the checkout is private.
with (ROOT/'sql/api.sql').open('rb') as source:
    subprocess.run(args+['-f','-'],stdin=source,env=env,check=True)
