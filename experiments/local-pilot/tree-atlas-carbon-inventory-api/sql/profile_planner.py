"""Read-only planner counterfactuals for the bounded grid aggregate."""
import json,os,re,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
lock=json.loads((ROOT.parent/'tree-atlas-contract-v1/baseline.lock.json').read_text())
config=json.loads(Path('/home/david/.config/tree-atlas-postgres-pilot/reader.json').read_text())
assert config['host']=='127.0.0.1' and int(config['port'])==5432 and config['dbname']=='tree_atlas_pilot' and config['user']=='tree_atlas_reader'
base={key:value for key,value in os.environ.items() if not key.startswith('PG')}
base.update(PGHOST=config['host'],PGPORT=str(config['port']),PGDATABASE=config['dbname'],PGUSER=config['user'],PGPASSWORD=config['password'],PGAPPNAME='tree_atlas_planner_profiler')
profiles=[('serial-jitoff','-c jit=off -c max_parallel_workers_per_gather=0'),
          ('hash-serial-jitoff','-c jit=off -c enable_sort=off -c max_parallel_workers_per_gather=0'),
          ('hash-defaultparallel-jitoff','-c jit=off -c enable_sort=off'),
          ('hash-serial-jiton','-c jit=on -c enable_sort=off -c max_parallel_workers_per_gather=0')]
samples=[]
for city in ['vienna','london']:
 ds=next(row for row in lock['datasets'] if row['id']==city)
 request={'dataset':city,'release':ds['release'],'area':None,'viewport':ds['bounds'],'zoom':12,'offset':0,'limit':25,'containsNul':False}
 literal="'"+json.dumps(request).replace("'","''")+"'::jsonb"
 query=f"SELECT jsonb_array_length(atlas_api.summary({literal},'')->'markers');"
 for label,options in profiles:
  result=subprocess.run(['psql','-X','-At','-v','ON_ERROR_STOP=1'],input='\\timing on\n'+query+'\n'+query+'\n',text=True,capture_output=True,env={**base,'PGOPTIONS':options+' -c statement_timeout=15000'},timeout=40)
  sample={'city':city,'profile':label,'timesMs':[float(value) for value in re.findall(r'Time: ([0-9.]+) ms',result.stdout)],'exitCode':result.returncode}
  samples.append(sample);print(json.dumps(sample),flush=True)
  if result.returncode:raise RuntimeError(result.stderr[:1000])
(ROOT/'evidence/sql-planner-profile.json').write_text(json.dumps({'scope':'session-only planner counterfactuals, warm OS cache','samples':samples},indent=2))
