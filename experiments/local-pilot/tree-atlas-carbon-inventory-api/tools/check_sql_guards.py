"""Real local SQL guard regressions; the synthetic release is always rolled back."""
import json
import os
import subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
if os.geteuid()!=0 or not __debug__: raise SystemExit('Run normally as WSL root')
env={key:value for key,value in os.environ.items() if not key.startswith('PG')}
sql="""BEGIN;
DO $test$ BEGIN
 IF atlas_api.grid_cell(6,0,1e-12,30)<>29 OR
    atlas_api.grid_cell(-6,0,1e-12,30)<>0 OR
    atlas_api.grid_cell(46,0,1e-12,1)<>0 OR
    atlas_api.grid_cell(0.5e-12,0,1e-12,30)<>15 OR
    atlas_api.grid_divisions(390,1)<>6 OR atlas_api.grid_divisions(353,1)<>5 OR
    atlas_api.badge_position(59.9,0,120,0,2,1)<>36 OR
    atlas_api.badge_position(60.1,0,120,1,2,1)<>84 OR
    atlas_api.latitude_scale('[0,5e-324,1,20]'::jsonb)<>1 OR
    atlas_api.latitude_scale('[0,-20,1,-5e-324]'::jsonb)<>1 OR
    atlas_api.grid_cell(0,-5e-324::float8,180,30)<>0 OR
    atlas_api.grid_cell(5e-324::float8,0,180,30)<>0 OR
    atlas_api.grid_cell(0,-5e-324::float8,5e-324::float8,1)<>0 OR
    atlas_api.grid_cell(6,0,180,30)<>1 OR atlas_api.grid_cell(180,0,180,30)<>29
 THEN RAISE EXCEPTION 'Tiny viewport arithmetic guard failed'; END IF;
END $test$;
INSERT INTO atlas.releases(dataset,release,metadata,expected_count,expected_located_count,expected_identity_sha256,expected_content_sha256)
VALUES('vienna','api-guard-transaction-only','{}',1,0,repeat('a',64),repeat('b',64));
UPDATE atlas.releases SET status='staged' WHERE release='api-guard-transaction-only';
UPDATE atlas.releases SET status='validated' WHERE release='api-guard-transaction-only';
DO $test$ BEGIN
 BEGIN
  PERFORM atlas_api.require_release('{"dataset":"vienna","release":"api-guard-transaction-only"}');
  RAISE EXCEPTION 'Missing metadata fields were accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $test$;
ROLLBACK;
SELECT json_build_object('passed',true,'tinyViewportGuards',true,'missingMetadataRejected',true,
 'retainedSyntheticReleases',(SELECT count(*) FROM atlas.releases WHERE release='api-guard-transaction-only'),
 'validatedReleases',(SELECT count(*) FROM atlas.validated_releases));
"""
result=subprocess.run(['runuser','-u','postgres','--','psql','-h','/var/run/postgresql','-p','5432','-U','postgres','-d','tree_atlas_pilot','-X','-q','-At','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,env=env,check=True)
report=json.loads(result.stdout)
assert report['retainedSyntheticReleases']==0 and report['validatedReleases']==4
(root/'evidence/sql-guard-tests.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
