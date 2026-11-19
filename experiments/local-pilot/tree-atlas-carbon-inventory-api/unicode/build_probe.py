import json
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
COMPILER=ROOT.parents[1]/'tree-atlas-carbon-poc/tools/carbon_toolchain-0.0.0-0.nightly.2026.11.07/bin/carbon'
PREFIX=ROOT/'tools/icu/usr/local'
(ROOT/'build').mkdir(exist_ok=True)
commands=[]
for name in ['normalizer','probe']:
    commands.append([str(COMPILER),'clang','--','-std=c++17','-O2','-Wall','-Wextra',
         '-I'+str(PREFIX/'include'),'-c',str(ROOT/f'{name}.cpp'),'-o',str(ROOT/f'build/{name}.o')])
commands.append([str(COMPILER),'link','--output='+str(ROOT/'build/normalizer-probe'),
    str(ROOT/'build/normalizer.o'),str(ROOT/'build/probe.o'),'--',
    '-L'+str(PREFIX/'lib'),'-Wl,-rpath,'+str(PREFIX/'lib'),'-licuuc','-licudata'])
results=[]
for command in commands:
    result=subprocess.run(command,text=True,capture_output=True)
    results.append({'command':command,'exitCode':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
    print(result.stdout,end='');print(result.stderr,end='')
    if result.returncode: break
(ROOT/'build-result.json').write_text(json.dumps(results,indent=2))
raise SystemExit(result.returncode)
