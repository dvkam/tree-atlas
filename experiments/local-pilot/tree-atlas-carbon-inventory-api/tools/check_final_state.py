"""Read actual local DB state after stopping API tests and benchmarks."""
import json
import os
import subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
if os.geteuid()!=0 or not __debug__: raise SystemExit('Run normally as WSL root')
env={key:value for key,value in os.environ.items() if not key.startswith('PG')}
args=['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1']
def sql(database,text):
    return subprocess.run(args+['-d',database],input=text,text=True,capture_output=True,env=env,check=True).stdout.strip()
state=json.loads(sql('tree_atlas_pilot',"""SELECT json_build_object(
 'databaseBytes',pg_database_size(current_database()),
 'validatedRecords',(SELECT count(*) FROM atlas.validated_records),
 'validatedReleases',(SELECT count(*) FROM atlas.validated_releases),
 'unsealedReleases',(SELECT count(*) FROM atlas.releases WHERE status<>'validated'),
 'ownedSessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('tree_atlas_inventory_api','tree_atlas_summary_profiler','tree_atlas_http_test_observer','tree_atlas_http_conformance_observer','tree_atlas_carbon_pool')),
 'readerCanReadBase',has_table_privilege('tree_atlas_reader','atlas.records','SELECT'),
 'readerCanWrite',has_table_privilege('tree_atlas_reader','atlas.records','INSERT'),
 'apiFunctionsAreInvoker',NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='atlas_api' AND p.prosecdef),
 'spatialIndexValid',(SELECT indisvalid FROM pg_index WHERE indexrelid='atlas.inventory_spatial_cover'::regclass),
 'spatialIndexBytes',pg_relation_size('atlas.inventory_spatial_cover'));
"""))
assert state['validatedRecords']==1657347 and state['validatedReleases']==4
assert state['unsealedReleases']==state['ownedSessions']==0
assert not state['readerCanReadBase'] and not state['readerCanWrite']
assert state['apiFunctionsAreInvoker'] and state['spatialIndexValid']
assert sql('tree_atlas_poc',"SELECT count(*)=1 AND min(id)='0007' AND min(label)='Platane – Zürich 🌳' FROM public.poc_probe;")=='t'
report={'passed':True,**state,'originalPocUnchanged':True,'deployment':False}
(root/'evidence/final-state.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
