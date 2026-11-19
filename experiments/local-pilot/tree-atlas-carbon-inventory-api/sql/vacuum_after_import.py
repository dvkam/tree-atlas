"""Authorized ordinary post-load visibility/statistics maintenance, not VACUUM FULL."""
import os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.geteuid()!=0:raise SystemExit('Run as WSL root')
env={key:value for key,value in os.environ.items() if not key.startswith('PG')}
args=['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1','-d','tree_atlas_pilot']
result=subprocess.run(args,input='VACUUM (ANALYZE, VERBOSE) atlas.records; VACUUM (ANALYZE, VERBOSE) atlas.dictionary;',text=True,capture_output=True,env=env,timeout=240)
(ROOT/'evidence/post-load-vacuum.log').write_text(result.stdout+'\n'+result.stderr)
if result.returncode:raise RuntimeError('Post-load maintenance failed; inspect local log')
print('Ordinary VACUUM ANALYZE completed for immutable records and dictionary')
