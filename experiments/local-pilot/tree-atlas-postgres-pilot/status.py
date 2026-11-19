"""Local administrative state and progress. Run as WSL root; no credentials."""
import json
import os
import subprocess
from pathlib import Path
if os.geteuid()!=0: raise SystemExit('Run as WSL root')
root=Path(__file__).resolve().parent
for name in list(os.environ):
    if name.startswith('PG'): del os.environ[name]
sql="""SELECT json_build_object(
 'database',current_database(),'databaseBytes',pg_database_size(current_database()),
 'releases',COALESCE((SELECT json_agg(json_build_object('dataset',dataset,'release',release,'status',status,'expectedCount',expected_count) ORDER BY dataset) FROM atlas.releases),'[]'::json),
 'copyProgress',COALESCE((SELECT json_agg(json_build_object('pid',pid,'tuplesProcessed',tuples_processed,'bytesProcessed',bytes_processed)) FROM pg_stat_progress_copy WHERE datname=current_database()),'[]'::json),
 'sessions',COALESCE((SELECT json_agg(json_build_object('application',application_name,'state',state,'wait',wait_event)) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),'[]'::json));"""
result=subprocess.run(['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1','-d','tree_atlas_pilot'],input=sql,text=True,capture_output=True,check=True)
print(json.dumps(json.loads(result.stdout),indent=2))
