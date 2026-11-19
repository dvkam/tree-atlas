"""Read-only London phase timings, checked against the independent frozen cases."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--label',default='current')
parser.add_argument('--repeat',type=int,default=3)
options=parser.parse_args()
if not re.fullmatch(r'[a-zA-Z0-9_-]+',options.label) or not 1<=options.repeat<=20:
    raise SystemExit('Use a simple label and 1-20 repeats.')
if os.geteuid()!=0:
    raise SystemExit('Run as WSL root for peer access; queries execute as the restricted reader.')
reference=json.loads((ROOT.parent/'tree-atlas-contract-v1/reference/reference-results.json').read_text())
dataset=next(row for row in reference['datasets'] if row['dataset']=='london')
environment={key:value for key,value in os.environ.items() if not key.startswith('PG')}
arguments=['runuser','-u','postgres','--','psql','-X','-h','/var/run/postgresql','-p','5432','-d','tree_atlas_pilot','-At','-v','ON_ERROR_STOP=1']
report={'scope':'Read-only SQL phases with fresh sessions; database/OS caches warm or uncontrolled; no HTTP/hosted claim.','label':options.label,'samples':[]}
output=ROOT/'.verification'/f'london-phases-{options.label}.json'
output.parent.mkdir(exist_ok=True)
for name in ['one-character','rare-genus']:
    definition=next(row for row in dataset['queries'] if row['name']==name)
    request={key:definition[key] for key in ['q','area','viewport','zoom']}
    request.update(dataset='london',release=dataset['release'],offset=0,limit=25,containsNul=False)
    literal="'"+json.dumps(request).replace("'","''")+"'::jsonb"
    term="'"+definition['q'].replace("'","''")+"'"
    for iteration in range(options.repeat):
        for phase in ['summary','page']:
            if phase=='summary':
                selection="jsonb_build_object('total',r->'total','locatedTotal',r->'locatedTotal','viewportLocatedTotal',r->'viewportLocatedTotal')"
                expected={key:definition[key] for key in ['total','locatedTotal','viewportLocatedTotal']}
            else:
                selection="jsonb_path_query_array(r,'$.items[*].sourceId')"
                expected=definition['pages'][0]['ids']
            sql=f"SET ROLE tree_atlas_reader; SET default_transaction_read_only=on; SET statement_timeout=15000;\n\\timing on\nWITH measured AS MATERIALIZED (SELECT atlas_api.{phase}({literal},{term}) AS r) SELECT {selection} FROM measured;"
            result=subprocess.run(arguments,input=sql,text=True,capture_output=True,env=environment,timeout=20)
            if result.returncode: raise RuntimeError(result.stderr[:1000])
            answer=next(line for line in result.stdout.splitlines() if line.startswith(('{','[')))
            if json.loads(answer)!=expected: raise AssertionError(f'{name}/{phase} differs from frozen expectation')
            ms=float(re.findall(r'Time: ([0-9.]+) ms',result.stdout)[-1])
            sample={'case':name,'phase':phase,'iteration':iteration,'sqlMs':ms}
            report['samples'].append(sample)
            print(json.dumps(sample),flush=True)
            output.write_text(json.dumps(report,indent=2)+'\n')
report['passed']=True
output.write_text(json.dumps(report,indent=2)+'\n')
