"""Apply the reviewed seal correction only to the empty new local database."""
import os
import subprocess
from pathlib import Path
root = Path(__file__).resolve().parent
for name in list(os.environ):
    if name.startswith('PG'): del os.environ[name]
if os.geteuid()!=0: raise SystemExit('Run as WSL root')
args=['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1','-d','tree_atlas_pilot']
count=subprocess.run(args,input='SELECT (SELECT count(*) FROM atlas.releases)+(SELECT count(*) FROM atlas.records);',text=True,capture_output=True,check=True).stdout.strip()
if count!='0': raise SystemExit('Refusing the empty-database correction after data import')
schema=(root/'schema.sql').read_text()
block=schema.split('-- BEGIN SEAL HARDENING\n',1)[1].split('-- END SEAL HARDENING',1)[0]
subprocess.run(args,input='BEGIN;\n'+block+'\nCOMMIT;',text=True,check=True)
print('Applied row-lock and deferred sealing guards to the empty pilot database')
