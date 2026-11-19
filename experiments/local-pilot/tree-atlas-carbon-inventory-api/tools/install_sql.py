"""Install read-only local API functions. Does not alter records or publish."""
import os
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.geteuid()!=0: raise SystemExit('Run as WSL root')
env={key:value for key,value in os.environ.items() if not key.startswith('PG')}
args=['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-v','ON_ERROR_STOP=1','-d','tree_atlas_pilot']
subprocess.run(args+['-f',str(ROOT/'sql/api.sql')],env=env,check=True)
