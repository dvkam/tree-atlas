import json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
c=root.parent.parent/'tools/carbon_toolchain-0.0.0-0.nightly.2026.11.07/bin/carbon'
commands=[['g++','-std=c++17','-c',str(root/'opaque.cpp'),'-o',str(root/'opaque_cpp.o')],
 [str(c),'compile','--no-debug-info',f'--output={root/"opaque.o"}',str(root/'opaque.carbon'),'--',f'-I{root}'],
 [str(c),'link',f'--output={root/"opaque"}',str(root/'opaque.o'),str(root/'opaque_cpp.o')],
 [str(root/'opaque')]]
results=[]
for command in commands:
 p=subprocess.run(command,text=True,capture_output=True,timeout=120)
 results.append({'command':command,'returncode':p.returncode,'stdout':p.stdout,'stderr':p.stderr})
 print(p.returncode,p.stdout,p.stderr)
 if p.returncode:break
(root/'opaque-results.json').write_text(json.dumps(results,indent=2))
