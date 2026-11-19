// Independent public HTTP comparisons with the sealed canonical oracle.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { ROOT,FROZEN,startService } from './http-client.mjs';
import { queryKey,identityLine,inside } from '../../tree-atlas-contract-v1/reference/oracle.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const lockBytes=await readFile(resolve(FROZEN,'baseline.lock.json'));
const lock=JSON.parse(lockBytes);
assert.equal(process.version,lock.referenceRuntime.node);
assert.equal(process.versions.unicode,lock.referenceRuntime.unicode);
const referenceBytes=await readFile(resolve(FROZEN,'reference/reference-results.json'));
const reference=JSON.parse(referenceBytes);
assert.equal(reference.baselineLockSha256,hash(lockBytes));
const sealBytes=await readFile(resolve(FROZEN,'freeze-v1.json'));
const seal=JSON.parse(sealBytes);
for(const entry of seal.files)assert.equal(hash(await readFile(resolve(FROZEN,entry.file))),entry.sha256,entry.file);
const quick=process.argv.includes('--quick');
const output=resolve(ROOT,'evidence',quick?'http-conformance-quick.json':'http-conformance.json');
await mkdir(resolve(ROOT,'evidence'),{recursive:true});
async function save(value){const temporary=output+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2)+'\n');await rename(temporary,output);}
const executionStartedAt=new Date();
let sourceCommit=null;
try { sourceCommit=execFileSync('git',['-C',ROOT,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); }
catch { /* A clean-room git archive has no .git; its outer report binds the source commit. */ }
const report={passed:false,state:'running',
  date:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vienna',year:'numeric',month:'2-digit',day:'2-digit'}).format(executionStartedAt),
  executionStartedAt:executionStartedAt.toISOString(),sourceCommit,
  runtime:{node:process.version,unicode:process.versions.unicode,platform:process.platform,arch:process.arch},
  freezeSha256:hash(sealBytes),
  scope:'Actual local Carbon HTTP list/count/correlation/detail/suggestion/map member checks; no browser, offline or hosted performance claim',
  selectedPageChecks:0,suggestionChecks:0,detailChecks:0,smallFullFilterSets:[],fullEmptyInventories:[],
  markerPartitionChecks:[],viewportPageChecks:0,quick,profiles:[]};
await save(report);
const measurements=[];
const started=performance.now();
let api;
function input(dataset,definition,page={offset:0,limit:100}) {
  return {contractVersion:'1.0.0',dataset:dataset.dataset,release:dataset.release,q:definition.q,
    area:definition.area,viewport:definition.viewport,zoom:definition.zoom,
    offset:page.offset,limit:page.limit,requestKey:randomUUID()};
}
function envelope(body,request,expected) {
  assert.equal(body.contractVersion,'1.0.0');assert.equal(body.dataset,expected.dataset);
  assert.equal(body.release,expected.release);assert.equal(body.requestKey,request.requestKey);
  assert.equal(body.queryKey,queryKey(expected.dataset,expected.release,request));
  assert.equal(body.releaseFingerprint,expected.contentSha256);
}
function ids(items){return items.map(item=>item.sourceId);}
async function query(dataset,definition,page,path='/v1/query',extra={}) {
  const request={...input(dataset,definition,page),...extra};
  const response=await api.call(path,request);
  assert.equal(response.status,200,JSON.stringify({dataset:dataset.dataset,case:definition.name,page,status:response.status,error:response.body.error}));
  envelope(response.body,request,dataset);
  measurements.push({dataset:dataset.dataset,case:definition.name,path,offset:request.offset,
    requestMs:Number(response.requestMs.toFixed(3)),withAttemptMs:Number(response.withAttemptMs.toFixed(3)),bytes:response.bytes});
  return response.body;
}
function checkCountsAndMarkers(result,expected) {
  assert.equal(result.total,expected.total);assert.equal(result.locatedTotal,expected.locatedTotal);
  assert.equal(result.viewportLocatedTotal,expected.viewportLocatedTotal);
  assert.ok(Array.isArray(result.markers) && result.markers.length<=1000);
  let represented=0;
  const handles=new Set();
  for(const marker of result.markers) {
    if(marker.kind==='tree') {
      assert.ok(marker.tree && marker.tree.position!==null);
      assert.ok(inside(expected.viewport,marker.tree.position),'Tree marker lies outside its exact viewport');
      assert.ok(!handles.has('tree:'+marker.tree.sourceId));handles.add('tree:'+marker.tree.sourceId);
      represented++;
    } else {
      assert.equal(marker.kind,'cluster');assert.ok(Number.isSafeInteger(marker.count) && marker.count>1);
      assert.ok(Array.isArray(marker.position) && marker.position.length===2 && marker.position.every(Number.isFinite));
      // Cluster display coordinates may incur average-rounding error; membership
      // and exact viewport totals remain independently exact.
      const padded=expected.viewport.map((value,index)=>value+(index<2?-1e-9:1e-9));
      assert.ok(inside(padded,marker.position),'Cluster display lies outside viewport');
      assert.ok(!handles.has('cluster:'+marker.id));handles.add('cluster:'+marker.id);
      represented+=marker.count;
    }
  }
  assert.equal(represented,result.representedLocatedCount);
  // This adapter intentionally clusters the exact viewport subset. The contract
  // also allows legacy clusters crossing its boundary, but the implementation
  // under test promises this stricter partition.
  assert.equal(result.representedLocatedCount,expected.viewportLocatedTotal);
}
async function enumerate(dataset,definition,{small=false}={}) {
  const digest=createHash('sha256');let offset=0,count=0,pages=0,previous=null;
  do {
    const result=await query(dataset,definition,{offset,limit:100});
    checkCountsAndMarkers(result,definition);
    assert.equal(result.items.length,Math.max(0,Math.min(100,definition.total-offset)));
    for(const item of result.items) {
      assert.equal(item.dataset,dataset.dataset);
      assert.ok(previous===null || previous<item.sourceId,'Nonunique/out-of-order actual HTTP IDs');
      previous=item.sourceId;
      digest.update(identityLine(dataset.dataset,dataset.release,item.sourceId));count++;
    }
    pages++;offset+=100;
    if(pages%1000===0)console.log(JSON.stringify({progress:'HTTP complete enumeration',dataset:dataset.dataset,case:definition.name,pages,records:count}));
  }while(offset<definition.total);
  assert.equal(count,definition.total);
  const actual=digest.digest('hex');assert.equal(actual,definition.orderedIdentitySha256);
  return {dataset:dataset.dataset,case:definition.name,records:count,pages,identitySha256:actual,
    scope:small?'small filtered full membership':'complete unfiltered inventory'};
}
try {
  api=await startService();report.startupMs=Number(api.startupMs.toFixed(3));
  const firstStarted=performance.now();
  for(const dataset of reference.datasets) {
    for(const definition of dataset.queries) {
      for(const page of definition.pages) {
        const result=await query(dataset,definition,page);
        checkCountsAndMarkers(result,definition);
        assert.deepEqual(ids(result.items),page.ids,`${dataset.dataset}/${definition.name}/${page.kind}`);
        report.selectedPageChecks++;
      }
      if(definition.total>0 && definition.total<=500)
        report.smallFullFilterSets.push(await enumerate(dataset,definition,{small:true}));
    }
    for(const suggestion of dataset.suggestions.cases) {
      const request={contractVersion:'1.0.0',dataset:dataset.dataset,release:dataset.release,
        q:suggestion.q,requestKey:randomUUID()};
      const response=await api.call('/v1/suggest',request);
      assert.equal(response.status,200);assert.equal(response.body.requestKey,request.requestKey);
      assert.deepEqual(response.body.values,suggestion.values);report.suggestionChecks++;
    }
    const locked=lock.datasets.find(item=>item.id===dataset.dataset);
    const descriptor=locked.descriptor;
    for(const asset of [descriptor.details[0],descriptor.details.at(-1)]) {
      const bytes=await readFile(resolve(ROOT,'../tree-atlas/public/data',asset.file));
      assert.equal(hash(bytes),asset.sha256);
      const shard=JSON.parse(gunzipSync(bytes));
      const expected=asset===descriptor.details[0]?shard.trees[0]:shard.trees.at(-1);
      const request={contractVersion:'1.0.0',dataset:dataset.dataset,release:dataset.release,
        sourceId:expected.sourceId,requestKey:randomUUID()};
      const response=await api.call('/v1/detail',request);
      assert.equal(response.status,200);assert.equal(response.body.requestKey,request.requestKey);
      assert.deepEqual(response.body.tree,expected);report.detailChecks++;
    }
  }
  report.selectedCorpusMs=Math.round(performance.now()-firstStarted);
  // Tiny nonempty filters in a world viewport force multiple located records
  // into one grid bucket, then exercise exact cluster paging and viewport paging.
  for(const [city,name] of [['geneva','rare-genus'],['porto','leading-zeros'],['vienna','literal-underscore']]) {
    const dataset=reference.datasets.find(item=>item.dataset===city);
    const frozenCase=dataset.queries.find(item=>item.name===name);
    const definition={...frozenCase,viewport:[-180,-90,180,90]};
    const result=await query(dataset,definition,{offset:0,limit:100});
    checkCountsAndMarkers(result,definition);
    const represented=[];
    for(const marker of result.markers) {
      if(marker.kind==='tree'){represented.push(marker.tree.sourceId);continue;}
      let count=0;
      for(let offset=0;offset<marker.count;offset+=5) {
        const page=await query(dataset,definition,{offset,limit:5},'/v1/cluster-members',{clusterId:marker.id});
        assert.equal(page.total,marker.count);assert.equal(page.items.length,Math.min(5,marker.count-offset));
        for(const item of page.items){assert.ok(inside(definition.viewport,item.position));represented.push(item.sourceId);count++;}
      }
      assert.equal(count,marker.count);
    }
    assert.equal(new Set(represented).size,represented.length,'Duplicate cluster union IDs');
    represented.sort();
    assert.equal(hash(represented.map(id=>identityLine(city,dataset.release,id)).join('')),frozenCase.orderedIdentitySha256);
    const visible=[];
    for(let offset=0;offset<frozenCase.total;offset+=5) {
      const page=await query(dataset,definition,{offset,limit:5},'/v1/viewport-page');
      assert.equal(page.total,frozenCase.viewportLocatedTotal);visible.push(...ids(page.items));report.viewportPageChecks++;
    }
    assert.equal(hash(visible.map(id=>identityLine(city,dataset.release,id)).join('')),frozenCase.viewportIdentitySha256);
    report.markerPartitionChecks.push({dataset:city,case:name,records:represented.length,markers:result.markers.length,
      clusters:result.markers.filter(marker=>marker.kind==='cluster').length});
  }
  if(!quick) for(const dataset of reference.datasets) {
    const definition=dataset.queries.find(item=>item.name==='all');
    report.fullEmptyInventories.push(await enumerate(dataset,definition));
  }
  const sorted=measurements.map(item=>item.withAttemptMs).sort((a,b)=>a-b);
  report.latency={scope:'local warm-database observed HTTP calls including attempt reservation; not shaped mobile or hosted cold-load evidence',
    samples:sorted.length,p50:sorted[Math.floor(sorted.length*0.5)]??null,p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*0.95))]??null,
    max:sorted.at(-1)??null,rawSamples:measurements};
  report.stats=(await api.raw('GET','/stats')).body;
  report.cleanup=await api.stop();api=null;
  report.elapsedMs=Math.round(performance.now()-started);report.state='complete';report.passed=true;
  report.notRun=['full broad-filter HTTP enumeration','full viewport/cluster expansion across every city','browser/offline pack','network-shaped physical mobile','hosted cold performance'];
  if(quick)report.notRun.unshift('complete unfiltered HTTP enumeration');
  await save(report);
  console.log(JSON.stringify({passed:true,quick,selectedPageChecks:report.selectedPageChecks,
    fullEmptyRecords:report.fullEmptyInventories.reduce((sum,item)=>sum+item.records,0),
    detailChecks:report.detailChecks,suggestions:report.suggestionChecks,elapsedMs:report.elapsedMs}));
}catch(error){
  report.state='failed';report.failure=error.message;
  if(api)try{report.cleanup=await api.stop();}catch(cleanup){report.cleanupFailure=cleanup.message;}
  await save(report);throw error;
}
