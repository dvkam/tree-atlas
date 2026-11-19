"""Install/validate the narrow covering search index; canonical records stay immutable."""
import json
import os
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
COLUMNS=['dataset','release','ordinal','lon','lat','search_id','search_tag','search_scientific','search_common','search_location']
INDEX_METADATA="""SELECT json_build_object('schema',n.nspname,'table',t.relname,'method',a.amname,
'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'keyCount',i.indnkeyatts,
'columns',(SELECT json_agg(pg_get_indexdef(i.indexrelid,k,true) ORDER BY k) FROM generate_series(1,i.indnatts) k),
'predicate',pg_get_expr(i.indpred,i.indrelid),'expressions',pg_get_expr(i.indexprs,i.indrelid),
'bytes',pg_relation_size(i.indexrelid))
FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=x.relnamespace
JOIN pg_class t ON t.oid=i.indrelid JOIN pg_am a ON a.oid=x.relam
WHERE n.nspname='atlas' AND x.relname='inventory_search_cover';"""


def validate_index(value):
    expected={'schema':'atlas','table':'records','method':'btree','valid':True,'ready':True,
              'unique':False,'keyCount':3,'columns':COLUMNS,'predicate':None,'expressions':None}
    if any(value.get(key)!=answer for key,answer in expected.items()):
        raise ValueError('Existing inventory_search_cover is invalid, incomplete or has another definition; inspect it, do not silently replace it.')


def main():
    if os.geteuid()!=0:
        raise SystemExit('Run as WSL root for peer administration of the local pilot database.')
    output=ROOT/'.verification'
    output.mkdir(parents=True,exist_ok=True)
    report={'passed':False,'scope':'Local read-path index only; no canonical records, deadlines or database server settings changed.'}
    destination=output/'search-index-install.json'
    destination.write_text(json.dumps(report,indent=2)+'\n')
    environment={key:value for key,value in os.environ.items() if not key.startswith('PG')}
    arguments=['runuser','-u','postgres','--','psql','-X','-h','/var/run/postgresql','-p','5432','-d','tree_atlas_pilot','-At','-v','ON_ERROR_STOP=1']
    def execute(query):
        result=subprocess.run(arguments,input=query,env=environment,text=True,capture_output=True,timeout=180)
        with (output/'search-index-install.log').open('a') as log:
            log.write(result.stdout+'\n'+result.stderr)
        if result.returncode:
            raise RuntimeError('Read-path index command failed; inspect local search-index-install.log.')
        values=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        return values[-1] if values else None
    started=time.monotonic()
    existing=execute(INDEX_METADATA)
    if existing is not None:
        validate_index(existing)
    else:
        measured=execute("SELECT json_build_object('maxSearchRowBytes',max(pg_column_size(row(dataset,release,ordinal,lon,lat,search_id,search_tag,search_scientific,search_common,search_location))),'records',count(*)) FROM atlas.records;")
        # A conservative preflight below PostgreSQL's 8k-page B-tree tuple limit.
        if measured['maxSearchRowBytes']>2000:
            raise RuntimeError('Search projection exceeds the reviewed B-tree row-size envelope; choose a different read path.')
        report.update(measured)
        execute((ROOT/'sql/search-cover.sql').read_text())
    execute('VACUUM (ANALYZE) atlas.records;')
    definition=execute(INDEX_METADATA)
    if definition is None:
        raise RuntimeError('Search covering index is missing after installation.')
    validate_index(definition)
    report.update(passed=True,created=existing is None,definition=definition,
        seconds=round(time.monotonic()-started,3),database=execute('SELECT json_build_object(\'bytes\',pg_database_size(current_database()));'))
    destination.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
