import json, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent
COMPILER = ROOT.parent.parent / 'tools/carbon_toolchain-0.0.0-0.nightly.2026.11.07/bin/carbon'
report=[]
for name in ['callback','thread','context']:
    stages=[]
    for args in [
      [str(COMPILER),'compile','--no-debug-info',f'--output={ROOT/name}.o',str(ROOT/f'{name}.carbon')],
      [str(COMPILER),'link',f'--output={ROOT/name}',str(ROOT/f'{name}.o'),'--','-pthread'],
      [str(ROOT/name)]]:
      p=subprocess.run(args,text=True,capture_output=True,timeout=120)
      stages.append({'command':args,'returncode':p.returncode,'stdout':p.stdout,'stderr':p.stderr})
      print(name,p.returncode,p.stdout,p.stderr)
      if p.returncode:break
    report.append({'probe':name,'stages':stages})
(ROOT/'results.json').write_text(json.dumps(report,indent=2))
