"""Peer-admin nested plans, then execute as the restricted reader. No data writes."""
import json
import os
import subprocess
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.geteuid()!=0: raise SystemExit('Run as WSL root for auto_explain loading')
lock=json.loads((ROOT.parent/'tree-atlas-contract-v1/baseline.lock.json').read_text())
env={key:value for key,value in os.environ.items() if not key.startswith('PG')}
args=['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-A','-t','-v','ON_ERROR_STOP=1','-d','tree_atlas_pilot']
serial='--serial' in sys.argv
after='--after' in sys.argv
final='--final' in sys.argv
for city in ['vienna','london']:
    ds=next(row for row in lock['datasets'] if row['id']==city)
    request={'dataset':city,'release':ds['release'],'area':None,'viewport':ds['bounds'],'zoom':12,'offset':0,'limit':25,'containsNul':False}
    literal="'"+json.dumps(request).replace("'","''")+"'::jsonb"
    for jit in (['off'] if serial or after or final else ['on','off']):
        sql=f"""LOAD 'auto_explain';
SET auto_explain.log_min_duration=10;
SET auto_explain.log_analyze=on;
SET auto_explain.log_buffers=on;
SET auto_explain.log_nested_statements=on;
SET auto_explain.log_level=notice;
SET auto_explain.log_timing=on;
SET jit={jit};
{ 'SET enable_sort=off; SET max_parallel_workers_per_gather=0;' if serial else '' }
SET ROLE tree_atlas_reader;
SET default_transaction_read_only=on;
SELECT jsonb_array_length(atlas_api.summary({literal},'')->'markers');
"""
        result=subprocess.run(args,input=sql,text=True,capture_output=True,env=env,timeout=35)
        (ROOT/f'evidence/sql-nested-{city}-{ "final-" if final else "after-" if after else "" }{ "serial-" if serial else "" }jit-{jit}.log').write_text(result.stdout+'\n'+result.stderr)
        if result.returncode: raise RuntimeError('Nested profiling failed: '+result.stderr[:1000])
        print(f'Captured {city} jit={jit} nested plans ({len(result.stderr)} bytes)',flush=True)
