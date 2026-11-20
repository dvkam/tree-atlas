// Black-box localhost client/process ownership. No native adapter imports.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FROZEN = resolve(ROOT, '../tree-atlas-contract-v1');
export async function startService({maxSockets=2}={}) {
  assert.ok(Number.isInteger(maxSockets) && maxSockets>=1 && maxSockets<=32);
  const file = '/home/david/.config/tree-atlas-postgres-pilot/reader.json';
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const config = JSON.parse(await readFile(file));
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.dbname, 'tree_atlas_pilot');
  assert.equal(config.user, 'tree_atlas_reader');
  assert.equal(Number(config.port), 5432);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
  const observer = {...env, PGHOST:config.host, PGPORT:String(config.port), PGDATABASE:config.dbname,
    PGUSER:config.user, PGPASSWORD:config.password, PGAPPNAME:'tree_atlas_http_conformance_observer'};
  env.TREE_ATLAS_PG = Object.entries(config).map(([key,value]) => `${key}=${value}`).join(' ') +
    " connect_timeout=3 options='-c default_transaction_read_only=on -c statement_timeout=3500 -c lock_timeout=3500'";
  const started = performance.now();
  const child = spawn(resolve(ROOT,'build/service'), [], {env, stdio:['ignore','pipe','pipe']});
  const closed = once(child,'close');
  child.stderr.on('data',()=>{}); // Do not print private database diagnostics.
  const lines = createInterface({input:child.stdout, crlfDelay:Infinity});
  let timer;
  let port;
  try {
    port = await new Promise((accept,reject) => {
      timer = setTimeout(()=>reject(Error('Inventory service did not announce a port')),10000);
      lines.on('line',line=>{ if(line.startsWith('PORT '))accept(Number(line.split(' ')[1])); });
      child.on('error',reject);
      child.on('exit',code=>reject(Error(`Inventory service exited before startup: ${code}`)));
    });
    assert.ok(Number.isInteger(port) && port>0);
  } catch(error) {
    child.kill('SIGTERM'); await closed.catch(()=>{}); throw error;
  } finally { clearTimeout(timer); }
  const agent = new http.Agent({keepAlive:true,maxSockets});
  async function raw(method,path,body=null,token=null) {
    const bytes = body===null ? null : Buffer.from(JSON.stringify(body));
    return await new Promise((accept,reject)=>{
      const headers = {'Content-Type':'application/json'};
      if(bytes)headers['Content-Length']=String(bytes.length);
      if(token)headers['X-Request-ID']=token;
      const request = http.request({host:'127.0.0.1',port,path,method,headers,agent},response=>{
        const chunks=[];let size=0;
        response.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)response.destroy(Error('Response exceeds test bound'));else chunks.push(chunk);});
        response.on('error',reject);
        response.on('end',()=>{
          try {accept({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks)),bytes:size});}
          catch(error){reject(error);}
        });
      });
      request.on('error',reject);
      request.setTimeout(7000,()=>request.destroy(Error('HTTP conformance timeout')));
      request.end(bytes);
    });
  }
  async function call(path,body) {
    const started=performance.now();
    const issued=await raw('POST','/attempt');
    assert.equal(issued.status,200,'Attempt reservation failed');
    const queryStarted=performance.now();
    const result=await raw('POST',path,body,issued.body.id);
    return {...result,requestMs:performance.now()-queryStarted,withAttemptMs:performance.now()-started};
  }
  let stopped=false;
  return {port,pid:child.pid,raw,call,startupMs:performance.now()-started,
    async stop() {
      if(stopped)return;stopped=true;
      agent.destroy();child.kill('SIGTERM');
      let forced=false;
      const timeout=setTimeout(()=>{forced=true;child.kill('SIGKILL');},5000);
      const [code,signal]=await closed;clearTimeout(timeout);lines.close();
      assert.equal(forced,false,'Forced service cleanup');
      assert.equal(code,0,`Service cleanup exit ${code}/${signal}`);
      const until=performance.now()+3000;
      while(true){
        const result=spawnSync('psql',['-X','-At','-v','ON_ERROR_STOP=1'],{env:observer,encoding:'utf8',timeout:5000,
          input:"SELECT count(*) FROM pg_stat_activity WHERE application_name='tree_atlas_inventory_api';"});
        assert.equal(result.status,0,'Could not observe pool cleanup');
        if(result.stdout.trim()==='0')break;
        assert.ok(performance.now()<until,'Pool sessions survived service shutdown');
        await new Promise(done=>setTimeout(done,25));
      }
      return {serviceExit:code,poolSessionsRemaining:0};
    }};
}
