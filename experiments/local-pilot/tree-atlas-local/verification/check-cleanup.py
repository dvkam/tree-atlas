import subprocess,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
result=subprocess.run(['sudo','-n','-u','postgres','psql','-X','-d','tree_atlas_pilot','-Atqc',"SELECT count(*) FROM pg_stat_activity WHERE usename='tree_atlas_reader'"],text=True,capture_output=True,check=True,timeout=10,stdin=subprocess.DEVNULL)
count=int(result.stdout.strip())
assert count==0,'Local reader sessions remain open'
(root/'verification/cleanup.json').write_text(json.dumps({'passed':True,'readerSessionsRemaining':count,'postgresqlStopped':False,'deployment':False},indent=2)+'\n')
print('No local API reader sessions remain; PostgreSQL remains running.')
