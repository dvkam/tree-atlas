from pathlib import Path
import json
p=Path('outputs/tree-atlas-carbon-poc/evidence/releases.json');d=json.loads(p.read_text(encoding='utf8'))
if not isinstance(d,list): print(d)
else:
 for r in d:
  print(r['tag_name'],r['published_at'])
  for a in r['assets']:print(a['name'],a['size'],a.get('digest'),a['browser_download_url'])
