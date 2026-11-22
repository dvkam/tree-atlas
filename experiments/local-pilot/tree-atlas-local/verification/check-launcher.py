"""Exercise the documented launcher, then verify it closes its HTTP listener."""
from pathlib import Path
import json
import queue
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
lines = []
events = queue.Queue()
started = time.monotonic()
process = subprocess.Popen([sys.executable, 'scripts/run-local.py'], cwd=ROOT, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, text=True)
def collect():
    for line in process.stdout:
        lines.append(line)
        events.put(line)
thread = threading.Thread(target=collect, daemon=True)
thread.start()
report = {'passed': False, 'scope': 'Documented local production build/start/health/stop; no browser or deployment.'}
try:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Local launcher stopped before readiness.')
        try:
            line = events.get(timeout=1)
        except queue.Empty:
            continue
        if line.startswith('LOCAL_READY '):
            break
    else:
        raise RuntimeError('Local launcher did not become ready within 45 seconds.')
    report['startupIncludingBuildSeconds'] = round(time.monotonic() - started, 3)
    for path in ['/', '/api/health']:
        with urllib.request.urlopen('http://127.0.0.1:4199' + path, timeout=3) as response:
            if response.status != 200:
                raise RuntimeError('Local startup health response failed.')
    process.send_signal(signal.SIGTERM)
    process.wait(timeout=10)
    thread.join(timeout=2)
    if process.returncode != 0:
        raise RuntimeError('Local launcher did not exit cleanly.')
    try:
        urllib.request.urlopen('http://127.0.0.1:4199/api/health', timeout=1)
    except urllib.error.URLError:
        report['httpListenerClosed'] = True
    else:
        raise RuntimeError('Local preview remained running after shutdown.')
    report['passed'] = True
finally:
    if process.poll() is None:
        process.send_signal(signal.SIGTERM)
        process.wait(timeout=10)
    (ROOT / 'verification/launcher.log').write_text(''.join(lines))
    (ROOT / 'verification/launcher.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
