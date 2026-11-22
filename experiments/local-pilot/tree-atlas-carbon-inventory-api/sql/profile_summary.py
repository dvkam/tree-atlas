"""Read-only fresh-session/warm SQL timings, without logging credentials."""
import json
import os
import re
import subprocess
import time
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
lock=json.loads((ROOT.parent/'tree-atlas-contract-v1/baseline.lock.json').read_text())
config=json.loads(Path('/home/david/.config/tree-atlas-postgres-pilot/reader.json').read_text())
assert config['host']=='127.0.0.1' and config['dbname']=='tree_atlas_pilot' and config['user']=='tree_atlas_reader'
assert int(config['port'])==5432
base={key:value for key,value in os.environ.items() if not key.startswith('PG')}
base.update(PGHOST=config['host'],PGPORT=str(config['port']),PGDATABASE=config['dbname'],PGUSER=config['user'],PGPASSWORD=config['password'],PGAPPNAME='tree_atlas_summary_profiler')
report={'scope':'local read-only SQL summary profile; fresh backend, not cold OS/database cache','samples':[]}
final='--final' in sys.argv
after='--after' in sys.argv or final
for city in ['vienna','london']:
    ds=next(row for row in lock['datasets'] if row['id']==city)
    request={'dataset':city,'release':ds['release'],'area':None,'viewport':ds['bounds'],'zoom':12,'offset':0,'limit':25,'containsNul':False}
    literal="'"+json.dumps(request).replace("'","''")+"'::jsonb"
    query=f"SELECT jsonb_array_length(atlas_api.summary({literal},'')->'markers');"
    for jit in (['off'] if after else ['on','off']):
        env={**base,'PGOPTIONS':f'-c jit={jit} -c statement_timeout=15000 -c default_transaction_read_only=on'}
        for fresh in range(2):
            started=time.monotonic()
            sql='\\timing on\n'+('\n'.join([query]*(7 if after else 3)))+'\n'
            result=subprocess.run(['psql','-X','-A','-t','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,env=env,timeout=55)
            times=[float(value) for value in re.findall(r'Time: ([0-9.]+) ms',result.stdout)]
            sample={'city':city,'jit':jit,'freshSession':fresh,'queryTimesMs':times,'connectionInclusiveMs':round((time.monotonic()-started)*1000,2),'exitCode':result.returncode,'markers':re.findall(r'^\d+$',result.stdout,re.M)}
            report['samples'].append(sample)
            print(json.dumps(sample),flush=True)
            if result.returncode: raise RuntimeError('SQL profiling failed: '+result.stderr[:1000])
(ROOT/f'evidence/sql-summary-profile{ "-final" if final else "-after" if after else "" }.json').write_text(json.dumps(report,indent=2))
