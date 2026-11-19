"""Apply the authorized local covering index; leave canonical records unchanged."""
import json,os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if os.geteuid()!=0:raise SystemExit('Run as WSL root')
env={key:value for key,value in os.environ.items() if not key.startswith('PG')}
args=['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1','-d','tree_atlas_pilot']
sql="""CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_spatial_cover ON atlas.records(dataset,release,lon,lat,ordinal);
ANALYZE atlas.records;
SELECT json_build_object('index','inventory_spatial_cover','bytes',pg_relation_size('atlas.inventory_spatial_cover'),
 'valid',(SELECT indisvalid FROM pg_index WHERE indexrelid='atlas.inventory_spatial_cover'::regclass),
 'databaseBytes',pg_database_size(current_database()));
"""
result=subprocess.run(args,input=sql,text=True,capture_output=True,env=env,timeout=180)
(ROOT/'evidence/spatial-index-install.log').write_text(result.stdout+'\n'+result.stderr)
if result.returncode:raise RuntimeError('Index installation failed; inspect local evidence')
report=json.loads(next(line for line in result.stdout.splitlines() if line.startswith('{')))
if not report['valid']:raise RuntimeError('Concurrent index is not valid')
(ROOT/'evidence/spatial-index.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
