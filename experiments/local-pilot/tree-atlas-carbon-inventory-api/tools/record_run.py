"""Bind final local evidence to current code; no database or deployment actions."""
import hashlib
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
if not __debug__: raise SystemExit('Ordinary Python execution required')
def read(path): return json.loads((root/path).read_text())
http=read('evidence/http-conformance.json')
perf=read('evidence/http-performance.json')
state=read('evidence/final-state.json')
binding=read('evidence/http-final-binding.json')
assert binding['passed']
for entry in binding['files']:
    content=(root/entry['file']).read_bytes()
    assert hashlib.sha256(content).hexdigest()==entry['sha256']
assert http['passed'] and perf['passed'] and state['passed']
assert sum(item['records'] for item in http['fullEmptyInventories'])==1657347
assert http['selectedPageChecks']==192 and http['suggestionChecks']==16 and http['detailChecks']==8
assert read('evidence/sql-guard-tests.json')['passed']
assert read('evidence/number-parity.json')['passed']
assert read('unicode/parity-results.json')['passed']
paths=['README.md','src/service.carbon','src/service_runtime.cpp','src/service_runtime.h','src/inventory_impl.h','src/request_registry.h',
       'sql/api.sql','unicode/normalizer.cpp','unicode/normalizer.h','build/service',
       'evidence/http-final-binding.json','evidence/http-conformance.json','evidence/http-performance.json',
       'evidence/http-performance-before-queue.json','evidence/http-tests.log','evidence/sql-guard-tests.json',
       'evidence/coincident-maxzoom.json','evidence/number-parity.json','unicode/parity-results.json',
       'evidence/final-state.json','evidence/review.md']
files=[]
for path in paths:
    data=(root/path).read_bytes()
    files.append({'file':path,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
report={'passed':True,'date':'2026-11-08','scope':'Local Carbon/native read-only adapter; no frontend, offline or hosted conformance claim',
        'verifiedHttpRecords':1657347,'completeEmptyQueryPages':sum(item['pages'] for item in http['fullEmptyInventories']),
        'selectedPageChecks':192,'httpRegressionTests':22,'coldFreshProcessP95Ms':perf['coldSummary']['p95'],
        'warmTenClientErrors':next(item for item in perf['warm'] if item['concurrency']==10)['failures'],
        'stress25ClientBusy':next(item for item in perf['warm'] if item['concurrency']==25)['failures'],
        'normalizer':read('unicode/parity-results.json'),'files':files,'deployment':False}
(root/'evidence/final-summary.json').write_text(json.dumps(report,indent=2))
print(json.dumps({key:value for key,value in report.items() if key not in ['files','normalizer']},indent=2))
