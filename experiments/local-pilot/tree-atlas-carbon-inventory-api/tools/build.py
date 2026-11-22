"""Build the local Carbon inventory executable with isolated libpq/ICU clients."""
import json
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
POC=ROOT.parent/'tree-atlas-carbon-poc'
CARBON=POC/'tools/carbon_toolchain-0.0.0-0.nightly.2026.11.07/bin/carbon'
LIBPQ=POC/'tools/libpq-17.11'
ICU=ROOT/'unicode/tools/icu/usr/local'
(ROOT/'build').mkdir(exist_ok=True)
(ROOT/'evidence').mkdir(exist_ok=True)
commands=[
 [CARBON,'clang','--','-std=c++17','-O2','-pthread','-Wall','-Wextra',f'-I{LIBPQ}/include',f'-I{ICU}/include','-c',ROOT/'src/service_runtime.cpp','-o',ROOT/'build/runtime.o'],
 [CARBON,'clang','--','-std=c++17','-O2',f'-I{ICU}/include','-c',ROOT/'unicode/normalizer.cpp','-o',ROOT/'build/normalizer.o'],
 [CARBON,'compile','--no-debug-info',f'--output={ROOT}/build/service.o',ROOT/'src/service.carbon','--',f'-I{ROOT}/src'],
 [CARBON,'link',f'--output={ROOT}/build/service',ROOT/'build/service.o','--',ROOT/'build/runtime.o',ROOT/'build/normalizer.o',f'-L{LIBPQ}/lib',f'-Wl,-rpath,{LIBPQ}/lib',f'-L{ICU}/lib',f'-Wl,-rpath,{ICU}/lib','-lmicrohttpd','-lpq','-ljson-c','-licuuc','-licudata','-lcrypto','-pthread'],
]
results=[]
for command in commands:
    result=subprocess.run(list(map(str,command)),cwd=ROOT,text=True,capture_output=True,timeout=180)
    results.append({'command':list(map(str,command)),'returncode':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
    (ROOT/'evidence/build.json').write_text(json.dumps(results,indent=2))
    if result.returncode:
        print(result.stderr)
        raise SystemExit(result.returncode)
print('Built local Carbon inventory service')
