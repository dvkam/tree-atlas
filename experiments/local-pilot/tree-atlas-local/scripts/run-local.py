"""Start the isolated frontend and read-only Carbon service in WSL. Ctrl+C stops both."""
import argparse
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--skip-build', action='store_true', help='Reuse an existing production build')
parser.add_argument('--port', type=int, default=4199)
args = parser.parse_args()
if sys.platform != 'linux' or not 1024 <= args.port <= 65535:
    raise SystemExit('Run in WSL with an unprivileged local port.')
node_dir = Path.home() / '.nvm/versions/node/v26.13.0/bin'
env = dict(os.environ, PATH=f'{node_dir}:{os.environ.get("PATH", "")}')
if subprocess.check_output(['node', '--version'], env=env, text=True).strip() != 'v26.13.0':
    raise SystemExit('Use the pinned Node v26.13.0 installation.')
if not args.skip_build:
    subprocess.run(['node', 'scripts/bootstrap-local.mjs'], cwd=ROOT, env=env, check=True)
    subprocess.run(['node_modules/.bin/tsc', '--noEmit'], cwd=ROOT, env=env, check=True)
    subprocess.run(['node_modules/.bin/vite', 'build'], cwd=ROOT, env=env, check=True)
children = []
def stop(_sig=None, _frame=None):
    raise KeyboardInterrupt
signal.signal(signal.SIGTERM, stop)
try:
    api = subprocess.Popen([sys.executable, '../tree-atlas-carbon-inventory-api/tools/run.py'], cwd=ROOT,
                           env=env, stdout=subprocess.PIPE, text=True, start_new_session=True)
    children.append(api)
    selector = selectors.DefaultSelector()
    selector.register(api.stdout, selectors.EVENT_READ)
    if not selector.select(15):
        raise RuntimeError('Carbon service did not announce its local port within 15 seconds.')
    line = api.stdout.readline().strip()
    selector.close()
    if not line.startswith('PORT ') or not line[5:].isdigit():
        raise RuntimeError('Carbon service did not announce a valid local port.')
    env['TREE_ATLAS_API_PORT'] = line[5:]
    preview = subprocess.Popen(['node_modules/.bin/vite', 'preview', '--host', '127.0.0.1',
                               '--port', str(args.port), '--strictPort'], cwd=ROOT, env=env,
                              start_new_session=True)
    children.append(preview)
    url = f'http://127.0.0.1:{args.port}'
    for _ in range(100):
        if api.poll() is not None or preview.poll() is not None:
            raise RuntimeError('A local service stopped during startup.')
        try:
            with urllib.request.urlopen(url + '/api/health', timeout=1) as response:
                if response.status == 200:
                    break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError('Local preview/API health check did not become ready.')
    print(f'LOCAL_READY {url}\nKeep this terminal open. Ctrl+C stops both services.', flush=True)
    while api.poll() is None and preview.poll() is None:
        time.sleep(.25)
    raise RuntimeError('A local service stopped. Both services will now close.')
except KeyboardInterrupt:
    print('\nStopping local services.', flush=True)
finally:
    for child in reversed(children):
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
    for child in reversed(children):
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
