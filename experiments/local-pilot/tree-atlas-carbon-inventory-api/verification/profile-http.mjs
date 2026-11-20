// Local performance observations through real HTTP, with per-response checks.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {ROOT,FROZEN,startService} from './http-client.mjs';
import {queryKey} from '../../tree-atlas-contract-v1/reference/oracle.mjs';
const reference=JSON.parse(await readFile(resolve(FROZEN,'reference/reference-results.json')));
const lock=JSON.parse(await readFile(resolve(FROZEN,'baseline.lock.json')));
const output=resolve(ROOT,'evidence/http-performance.json');
const report={passed:false,state:'running',scope:'Local HTTP; fresh API process/cache, warm/uncontrolled database and OS cache. No shaped network, browser, offline or hosted claim.',cold:[],warm:[]};
await writeFile(output,JSON.stringify(report,null,2));
let api;
function make(dataset,pageIndex=0){
  const definition=dataset.queries.find(item=>item.name==='all');
  const page=definition.pages[pageIndex%3];
  return {dataset,definition,page,request:{contractVersion:'1.0.0',dataset:dataset.dataset,release:dataset.release,
    q:'',area:null,viewport:definition.viewport,zoom:definition.zoom,offset:page.offset,limit:page.limit,requestKey:randomUUID()}};
}
function check(response,context){
  if(response.status!==200){assert.equal(response.status,503,JSON.stringify(response.body));assert.equal(response.body.error,'busy');return;}
  const {dataset,definition,page,request}=context;
  assert.equal(response.body.total,dataset.count);assert.equal(response.body.locatedTotal,dataset.locatedCount);
  assert.equal(response.body.viewportLocatedTotal,definition.viewportLocatedTotal);
  assert.equal(response.body.representedLocatedCount,definition.viewportLocatedTotal);
  assert.equal(response.body.releaseFingerprint,dataset.contentSha256);
  assert.equal(response.body.requestKey,request.requestKey);
  assert.equal(response.body.queryKey,queryKey(dataset.dataset,dataset.release,request));
  assert.deepEqual(response.body.items.map(item=>item.sourceId),page.ids);
}
function stats(samples){const values=samples.map(item=>item.withAttemptMs).sort((a,b)=>a-b);return {samples:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.min(values.length-1,Math.floor(values.length*.95))],max:values.at(-1)};}
try{
  const london=reference.datasets.find(item=>item.dataset==='london');
  for(let index=0;index<30;index++){
    api=await startService({maxSockets:32});
    const context=make(london);
    const result=await api.call('/v1/query',context.request);check(result,context);
    assert.equal(result.status,200);
    report.cold.push({iteration:index,status:result.status,startupMs:api.startupMs,
      withAttemptMs:result.withAttemptMs,firstSearchFromLaunchMs:api.startupMs+result.withAttemptMs,bytes:result.bytes});
    await api.stop();api=null;
    if(index%5===4)console.log(JSON.stringify({coldProcesses:index+1}));
  }
  api=await startService({maxSockets:32});
  for(const dataset of reference.datasets){const context=make(dataset);const response=await api.call('/v1/query',context.request);check(response,context);assert.equal(response.status,200);}
  for(const concurrency of [1,10,25]){
    const samples=[];let next=0;
    const started=performance.now();
    await Promise.all(Array.from({length:concurrency},async()=>{
      while(next<100){const index=next++;const context=make(reference.datasets[index%4],Math.floor(index/4));
        const result=await api.call('/v1/query',context.request);check(result,context);
        samples.push({index,status:result.status,withAttemptMs:result.withAttemptMs,requestMs:result.requestMs,bytes:result.bytes});}
    }));
    report.warm.push({concurrency,clientMaxSockets:32,...stats(samples),
      elapsedMs:performance.now()-started,failures:samples.filter(item=>item.status!==200).length,rawSamples:samples});
  }
  report.cacheAndPool=(await api.raw('GET','/stats')).body;
  if(api.pid){const status=await readFile(`/proc/${api.pid}/status`,'utf8');report.serverRssKiB=Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]);}
  report.cleanup=await api.stop();api=null;
  const first=report.cold.map(item=>item.firstSearchFromLaunchMs).sort((a,b)=>a-b);
  report.coldSummary={samples:first.length,p50:first[15],p95:first[28],max:first.at(-1)};
  report.localThreeSecondFreshProcessTarget=first.every(value=>value<=3000);
  report.warmTenSessionZeroErrorTarget=report.warm.filter(item=>item.concurrency<=10).every(item=>item.failures===0);
  report.passed=report.localThreeSecondFreshProcessTarget&&report.warmTenSessionZeroErrorTarget;
  report.state='complete';
  report.notRun=['cold database/OS cache','cold uncached 10 distinct text filters','mobile shaped network','physical browsers','hosted deployment'];
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,cold:report.coldSummary,warm:report.warm.map(({rawSamples,...item})=>item),rssKiB:report.serverRssKiB}));
  if(!report.passed)process.exitCode=1;
}catch(error){if(api)try{await api.stop();}catch{}report.state='failed';report.failure=error.message;await writeFile(output,JSON.stringify(report,null,2)+'\n');throw error;}
