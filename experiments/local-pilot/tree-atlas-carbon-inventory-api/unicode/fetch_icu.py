"""Install an isolated official ICU client binary, without changing system libs."""
import hashlib
import json
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = 'icu4c-78.3-Ubuntu22.04-x64.tgz'
URL = f'https://github.com/unicode-org/icu/releases/download/release-78.3/{NAME}'
# Verified against the official release asset digest when this version was pinned.
SHA256 = '9c8abe58a20cf82ea22341d8125272094f7fca2414173cbc2d8742feb84566a2'
TOOLS = ROOT / 'tools'
TOOLS.mkdir(exist_ok=True)
archive = TOOLS / NAME
if not archive.exists():
    with urllib.request.urlopen(URL, timeout=60) as source, archive.open('wb') as target:
        while chunk := source.read(1024 * 1024):
            target.write(chunk)
actual = hashlib.sha256(archive.read_bytes()).hexdigest()
if actual != SHA256:
    raise SystemExit('Official ICU archive checksum mismatch')
with tarfile.open(archive) as source:
    source.extractall(TOOLS, filter='data')
manifest = {'source': URL, 'sha256': actual, 'pinnedAssetDigest': 'sha256:' + SHA256,
            'scope': 'Isolated ICU client binary only; no system package/server changes',
            'archiveBytes': archive.stat().st_size}
(ROOT/'icu-client.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps(manifest, indent=2))
