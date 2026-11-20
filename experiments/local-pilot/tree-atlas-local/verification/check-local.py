"""Run repeatable local source checks and keep their outcomes beside browser evidence."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if sys.platform != 'linux':
    raise SystemExit('Run these checks in WSL.')
env = dict(os.environ, PATH=f'{Path.home()}/.nvm/versions/node/v26.13.0/bin:{os.environ.get("PATH", "")}')
checks = [
    ('types', ['node_modules/.bin/tsc', '--noEmit']),
    ('lint', ['node_modules/.bin/oxlint', '--type-aware', '--deny-warnings']),
    ('format', ['node_modules/.bin/oxfmt', '--check']),
    ('regression', ['node_modules/.bin/vitest', 'run']),
    ('normalizer', ['node_modules/.bin/tsx', 'scripts/check-frozen-normalizer.ts']),
    ('freeze', ['node', '../tree-atlas-contract-v1/verify-freeze.mjs']),
]
report = {'passed': False, 'scope': 'Local source/regression/reference checks; browser evidence is separate.', 'checks': []}
report_path = ROOT / 'verification/source-checks.json'
report_path.write_text(json.dumps(report, indent=2) + '\n')
for name, command in checks:
    started = time.monotonic()
    result = subprocess.run(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (ROOT / f'verification/check-{name}.log').write_text(result.stdout)
    report['checks'].append({'name': name, 'exitCode': result.returncode, 'seconds': round(time.monotonic() - started, 3), 'log': f'check-{name}.log'})
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'{name}: {"PASS" if result.returncode == 0 else "FAIL"}', flush=True)
    if result.returncode:
        print(result.stdout, flush=True)
        raise SystemExit(result.returncode)
report['passed'] = True
report_path.write_text(json.dumps(report, indent=2) + '\n')
