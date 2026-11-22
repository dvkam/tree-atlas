"""Link the numeric formatter probe against the actual inventory runtime object."""
import json
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
POC=ROOT.parent/'tree-atlas-carbon-poc'
CARBON=POC/'tools/carbon_toolchain-0.0.0-0.nightly.2026.11.07/bin/carbon'
LIBPQ=POC/'tools/libpq-17.11'
ICU=ROOT/'unicode/tools/icu/usr/local'
commands=[
 [CARBON,'clang','--','-std=c++17','-O2','-Wall','-Wextra','-c',ROOT/'tools/number_probe.cpp','-o',ROOT/'build/number_probe.o'],
 [CARBON,'link',f'--output={ROOT}/build/number_probe',ROOT/'build/number_probe.o','--',ROOT/'build/runtime.o',ROOT/'build/normalizer.o',f'-L{LIBPQ}/lib',f'-Wl,-rpath,{LIBPQ}/lib',f'-L{ICU}/lib',f'-Wl,-rpath,{ICU}/lib','-lmicrohttpd','-lpq','-ljson-c','-licuuc','-licudata','-lcrypto','-pthread'],
]
results=[]
for command in commands:
    result=subprocess.run(list(map(str,command)),cwd=ROOT,text=True,capture_output=True,timeout=180)
    results.append({'command':list(map(str,command)),'returncode':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
    (ROOT/'evidence/number-probe-build.json').write_text(json.dumps(results,indent=2))
    if result.returncode:
        print(result.stderr)
        raise SystemExit(result.returncode)
print('Built formatter probe from actual inventory runtime object')
