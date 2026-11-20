"""Mark immutable local stages validated only after independent full readback.

This does not publish a catalogue, start an API or deploy. WSL peer admin owns
the transition; neither loader nor verifier has UPDATE privileges.
"""
import hashlib
import json
import os
import subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
if not __debug__: raise SystemExit('Validation gates require ordinary Python execution; optimization is refused')
for name in list(os.environ):
    if name.startswith('PG'): del os.environ[name]
frozen=root.parent/'tree-atlas-contract-v1'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def quote(value): return "'"+str(value).replace("'","''")+"'"
if os.geteuid()!=0: raise SystemExit('Run as WSL root')
report=json.loads((root/'evidence/postgres-independent-verification.json').read_text())
assert report['passed'] is True
assert report['freezeSha256']==digest(frozen/'freeze-v1.json')
assert report['baselineLockSha256']==digest(frozen/'baseline.lock.json')
assert report['referenceSha256']==digest(frozen/'reference/reference-results.json')
assert report['totalRecords']==1657347
assert report['literalSqlCases']==22
assert report['session']['database']=='tree_atlas_pilot'
assert report['session']['user']=='tree_atlas_verify'
assert report['session']['readOnly']=='on'
assert report['session']['isolation']=='repeatable read'
reference=json.loads((frozen/'reference/reference-results.json').read_text())
assert len(report['datasets'])==len(reference['datasets'])==4
checks=[]
updates=[]
for expected in reference['datasets']:
    item=next(entry for entry in report['datasets'] if entry['dataset']==expected['dataset'])
    for actual_key,expected_key in [('records','count'),('located','locatedCount'),('identitySha256','identitySha256'),('contentSha256','contentSha256'),('dictionarySha256',None)]:
        wanted=expected['suggestions']['dictionarySha256'] if expected_key is None else expected[expected_key]
        assert item[actual_key]==wanted
    assert item['normalizedRecordsChecked']==expected['count']
    assert item['queryCases']==len(expected['queries'])==12
    assert item['pagesChecked']==48
    assert item['suggestionCases']==4
    key=f"dataset={quote(expected['dataset'])} AND release={quote(expected['release'])}"
    match=key+f" AND status IN ('staged','validated') AND expected_count={expected['count']} AND expected_located_count={expected['locatedCount']}"+\
      f" AND expected_identity_sha256={quote(expected['identitySha256'])} AND expected_content_sha256={quote(expected['contentSha256'])}"+\
      f" AND metadata->>'freezeSha256'={quote(report['freezeSha256'])} AND metadata->>'baselineLockSha256'={quote(report['baselineLockSha256'])}"+\
      f" AND metadata->>'referenceSha256'={quote(report['referenceSha256'])}"
    checks.append(f"IF (SELECT count(*) FROM atlas.releases WHERE {match})<>1 THEN RAISE EXCEPTION 'Verified immutable stage mismatch'; END IF;")
    updates.append(f"UPDATE atlas.releases SET status='validated' WHERE {key} AND status='staged';")
sql="BEGIN; SELECT pg_advisory_xact_lock(70981803); SELECT 1 FROM atlas.releases ORDER BY dataset,release FOR UPDATE;\n"
sql+="DO $guard$ BEGIN "+'\n'.join(checks)+" END $guard$;\n"+'\n'.join(updates)+"\nCOMMIT;\n"
args=['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-X','-At','-q','-v','ON_ERROR_STOP=1','-d','tree_atlas_pilot']
subprocess.run(args,input=sql,text=True,capture_output=True,check=True)
state=json.loads(subprocess.run(args,input="SELECT json_build_object('validatedReleases',(SELECT count(*) FROM atlas.validated_releases),'validatedRecords',(SELECT count(*) FROM atlas.validated_records),'databaseBytes',pg_database_size(current_database()),'recordBytes',pg_total_relation_size('atlas.records'),'dictionaryBytes',pg_total_relation_size('atlas.dictionary'));",text=True,capture_output=True,check=True).stdout)
assert state['validatedReleases']==4 and state['validatedRecords']==1657347
receipt={'scope':'local validated staging only; no active catalogue/API/deployment',
         'verificationRunId':report['runId'],'freezeSha256':report['freezeSha256'],**state,
         'existingPocDatabaseChanged':False,'deployment':False}
(root/'evidence/validated-stages.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps(receipt,indent=2))
