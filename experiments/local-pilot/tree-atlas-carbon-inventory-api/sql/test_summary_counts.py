"""Run the actual summary SQL over independent literal temporary records.

Only the validated-record and immutable-metadata providers are substituted; the
summary implementation is loaded verbatim from api.sql. No persistent schema,
canonical row, release metadata or privilege is changed.
"""
import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[1]
BASE_REQUEST={'dataset':'fixture','release':'literal','q':'acer','area':None,'viewport':[9,9,11,11],'zoom':12,'offset':0,'limit':25,'containsNul':False}


class SummaryCounts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.geteuid()!=0:
            raise unittest.SkipTest('Run as WSL root for local peer access; only temporary fixtures are created.')
        source=(ROOT/'sql/api.sql').read_text()
        start=source.index('CREATE OR REPLACE FUNCTION atlas_api.summary(')
        end=source.index('CREATE OR REPLACE FUNCTION atlas_api.page(',start)
        cls.implementation=source[start:end].replace('FUNCTION atlas_api.summary(', 'FUNCTION pg_temp.summary(').replace('atlas.validated_records','pg_temp.summary_records').replace('atlas_api.require_release(p)','pg_temp.require_release(p)')
        cls.environment={key:value for key,value in os.environ.items() if not key.startswith('PG')}
        cls.command=['runuser','-u','postgres','--','psql','-X','-h','/var/run/postgresql','-p','5432','-d','tree_atlas_pilot','-At','-v','ON_ERROR_STOP=1']

    def summary(self, **changes):
        request={**BASE_REQUEST,**changes}
        rows=[]
        for ordinal,(source,position,status) in enumerate([
            ('outside',[0,0],'existing'),('inside',[10,10],'existing'),
            ('removed-coincident',[10,10],'removed'),('unlocated',None,'existing')]):
            tree={'dataset':'fixture','sourceId':source,'position':position,'tag':None,'scientificName':'Acer fixture','commonName':None,'location':'Test','status':status}
            literal="'"+json.dumps(tree).replace("'","''")+"'::jsonb"
            lon,lat=('NULL','NULL') if position is None else map(str,position)
            rows.append(f"('fixture','literal',{ordinal},{lon},{lat},'{source}',NULL,'acer fixture',NULL,'test',{literal})")
        fixture="""CREATE TEMP TABLE summary_records(dataset text,release text,ordinal bigint,lon float8,lat float8,
        search_id text,search_tag text,search_scientific text,search_common text,search_location text,canonical jsonb);
        CREATE FUNCTION pg_temp.require_release(p jsonb) RETURNS jsonb LANGUAGE sql AS $$
          SELECT jsonb_build_object('expected_count',4,'expected_located_count',3,'expected_content_sha256','fixture') $$;
        """
        literal="'"+json.dumps(request).replace("'","''")+"'::jsonb"
        term="'"+request['q'].replace("'","''")+"'"
        sql=f"BEGIN; SET LOCAL statement_timeout=5000; {fixture} INSERT INTO summary_records VALUES {','.join(rows)}; {self.implementation} SELECT pg_temp.summary({literal},{term}); ROLLBACK;"
        result=subprocess.run(self.command,input=sql,env=self.environment,text=True,capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        return json.loads(next(line for line in result.stdout.splitlines() if line.startswith('{')))

    def assert_counts(self,result,total,located,visible):
        self.assertEqual((result['total'],result['locatedTotal'],result['viewportLocatedTotal']), (total,located,visible))
        self.assertEqual(result['representedLocatedCount'],visible)
        self.assertEqual(sum(marker.get('count',1) for marker in result['markers']),visible)

    def test_viewport_keeps_full_text_count_and_unlocated_record(self):
        result=self.summary()
        self.assert_counts(result,4,3,2)
        self.assertEqual(len(result['markers']),1)
        self.assertEqual(result['markers'][0]['count'],2)

    def test_area_excludes_unlocated_and_keeps_removed_coincident(self):
        self.assert_counts(self.summary(area=[9,9,11,11]),2,2,2)

    def test_empty_global_uses_full_counts_with_narrow_viewport(self):
        self.assert_counts(self.summary(q=''),4,3,2)

    def test_outside_viewport_has_no_markers_without_losing_text_members(self):
        result=self.summary(viewport=[99,-10,100,-9])
        self.assert_counts(result,4,3,0)
        self.assertEqual(result['markers'],[])

    def test_zero_match_has_exact_empty_counts(self):
        self.assert_counts(self.summary(q='no-such-tree'),0,0,0)


if __name__=='__main__':
    unittest.main()
