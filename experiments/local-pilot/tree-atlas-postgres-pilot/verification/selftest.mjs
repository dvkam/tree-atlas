// Negative witnesses for the independent readback comparator, not a DB pass.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Readback } from './verify-postgres.mjs';
import { contentLine, identityLine, queryKey } from '../../tree-atlas-contract-v1/reference/oracle.mjs';
const hash = value=>createHash('sha256').update(value).digest('hex');
const dataset='vienna',release='independent-selftest';
const row={dataset,sourceId:'0007',idScope:'release',position:null,tag:null,
  scientificName:null,commonName:'Érable',location:null,height:{kind:'unknown'},
  crown:{kind:'unknown'},circumference:{kind:'unknown'},plantingYear:null,
  plantingEstimated:false,age:null,observedAt:null,status:'removed'};
const identitySha256=hash(identityLine(dataset,release,'0007'));
const contentSha256=hash(contentLine(0,row));
const query={name:'all',q:'',area:null,viewport:[-180,-90,180,90],zoom:12,total:1,
  locatedTotal:0,viewportLocatedTotal:0,orderedIdentitySha256:identitySha256,
  viewportIdentitySha256:hash(''),pages:[{kind:'first',offset:0,limit:25,ids:['0007']}]};
query.pages[0].queryKey=queryKey(dataset,release,{...query,offset:0,limit:25});
const source={id:dataset,release,count:1,locatedCount:0};
const lock={datasets:[source],searchNormalizer:'nfd-diacritic-unicode17-default-lower-trim-v1'};
const reference={datasets:[{dataset,release,count:1,locatedCount:0,identitySha256,contentSha256,
  suggestions:{dictionaryCount:1,dictionarySha256:hash(JSON.stringify('Érable')+'\n'),
    cases:[{q:'er',values:['Érable']}]},queries:[query]}]};
const metadata={dataset,release,status:'staged',expected_count:1,expected_located_count:0,
  expected_identity_sha256:identitySha256,expected_content_sha256:contentSha256,
  metadata:{contractVersion:'1.0.0',searchNormalizer:lock.searchNormalizer,
    freezeSha256:'a'.repeat(64),baselineLockSha256:'b'.repeat(64),source}};
const events=[
  {kind:'session',database:'tree_atlas_pilot',user:'tree_atlas_verify',readOnly:'on',isolation:'repeatable read'},
  {kind:'metadata',dataset,release,row:metadata},
  {kind:'record',dataset,release,row:{ordinal:0,source_id:'0007',canonical:row,lon:null,lat:null,
    search_id:'0007',search_tag:null,search_scientific:null,search_common:'erable',search_location:null}},
  {kind:'dictionary',dataset,release,ordinal:0,value:'Érable',normalized:'erable'},
  {kind:'query',dataset,release,case:'all',sourceId:'0007',located:false,inViewport:false},
  {kind:'suggestions',dataset,release,q:'er',values:['Érable']},
];
function run(input){
  const reader=new Readback(reference,lock,'a'.repeat(64),'b'.repeat(64));
  for(const event of input)reader.consume(event);
  return reader.finish();
}
assert.equal(run(structuredClone(events)).totalRecords,1);
const mutants={
  ordinalGap:value=>{value[2].row.ordinal=1;},
  changedContent:value=>{value[2].row.canonical.commonName='Acer';value[2].row.search_common='acer';},
  wrongNormalizer:value=>{value[2].row.search_common='érable';},
  wrongGeometry:value=>{value[2].row.lon=1;},
  wrongMembership:value=>{value[4].sourceId='other';},
  truncatedRecords:value=>{value.splice(2,1);},
  wrongDictionary:value=>{value[3].value='Other';value[3].normalized='other';},
  wrongSuggestions:value=>{value[5].values=[];},
  releaseMix:value=>{value[2].release='new-release';},
  changedFreeze:value=>{value[1].row.metadata.freezeSha256='c'.repeat(64);},
  writableSnapshot:value=>{value[0].readOnly='off';},
};
for(const [name,mutate]of Object.entries(mutants)){
  const bad=structuredClone(events);mutate(bad);
  assert.throws(()=>run(bad),`Comparator missed ${name}`);
}
const report={passed:true,scope:'Synthetic independent readback comparator, not database conformance',
  rejectedMutants:Object.keys(mutants)};
if(process.argv.includes('--record'))await writeFile(new URL('./selftest-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
