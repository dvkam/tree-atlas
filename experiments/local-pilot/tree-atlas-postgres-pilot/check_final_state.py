"""Check actual validated-reader access, local role isolation and session cleanup."""
import json
import os
import subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
if not __debug__: raise SystemExit('Ordinary Python execution required')
if os.geteuid()!=0: raise SystemExit('Run as WSL root')
environment={key:value for key,value in os.environ.items() if not key.startswith('PG')}
config=json.loads(Path('/home/david/.config/tree-atlas-postgres-pilot/reader.json').read_text())
assert config['host']=='127.0.0.1' and config['dbname']=='tree_atlas_pilot' and config['user']=='tree_atlas_reader' and config['port']==5432
reader_env={**environment,'PGHOST':config['host'],'PGPORT':str(config['port']),'PGDATABASE':config['dbname'],
            'PGUSER':config['user'],'PGPASSWORD':config['password'],'PGAPPNAME':'tree_atlas_final_reader_check'}
reader_sql="""SELECT json_build_object('user',current_user,'readOnly',current_setting('transaction_read_only'),
 'releases',(SELECT count(*) FROM atlas.validated_releases),
 'records',(SELECT count(*) FROM atlas.validated_records),
 'counts',(SELECT json_agg(row_to_json(t)) FROM (SELECT dataset,count(*) AS count,min(ordinal) AS first,max(ordinal) AS last FROM atlas.validated_records GROUP BY dataset ORDER BY dataset)t),
 'canReadBase',has_table_privilege(current_user,'atlas.records','SELECT'),
 'canWrite',has_table_privilege(current_user,'atlas.records','INSERT'));"""
def execute(args,text,env=environment):
    return subprocess.run(args,input=text,text=True,capture_output=True,env=env,check=True).stdout
reader=json.loads(execute(['psql','-X','-At','-v','ON_ERROR_STOP=1'],reader_sql,reader_env))
assert reader['releases']==4 and reader['records']==1657347 and reader['readOnly']=='on'
assert not reader['canReadBase'] and not reader['canWrite']
args=['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1']
sql="""SELECT json_build_object('openLoadingReleases',(SELECT count(*) FROM atlas.releases WHERE status='loading'),
 'unvalidatedReleases',(SELECT count(*) FROM atlas.releases WHERE status<>'validated'),
 'ownedSessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('tree_atlas_staging_loader','tree_atlas_independent_verifier','tree_atlas_final_reader_check','tree_atlas_carbon_pool')),
 'loaderCanUpdateRecords',has_table_privilege('tree_atlas_loader','atlas.records','UPDATE'),
 'loaderCanDeleteRecords',has_table_privilege('tree_atlas_loader','atlas.records','DELETE'),
 'loaderCanValidate',has_table_privilege('tree_atlas_loader','atlas.releases','UPDATE'),
 'verifierCanWrite',has_table_privilege('tree_atlas_verify','atlas.records','INSERT'));
"""
state=json.loads(execute(args+['-d','tree_atlas_pilot'],sql))
assert all(value is False or value==0 for value in state.values())
poc=execute(args+['-d','tree_atlas_poc'],"SELECT count(*)=1 AND min(id)='0007' AND min(label)='Platane – Zürich 🌳' FROM public.poc_probe;").strip()
assert poc=='t'
report={'passed':True,'reader':reader,'state':state,'originalPocFixtureUnchanged':True,'deployment':False}
(root/'evidence/final-state.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
