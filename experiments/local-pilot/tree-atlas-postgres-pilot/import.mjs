// Canonical staging loader. No reference matcher, normalizer or digest helpers imported.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const frozen = resolve(root,'../tree-atlas-contract-v1');
const data = resolve(root,'../tree-atlas/public/data');
const configFile = '/home/david/.config/tree-atlas-postgres-pilot/loader.json';
assert.equal(process.version,'v26.13.0');
assert.equal(process.versions.unicode,'17.0');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => "'"+String(value).replaceAll("'","''")+"'";
const normalize = value => value === null ? null : value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const stable = value => Array.isArray(value) ? value.map(stable) : value !== null && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
const textField = value => value === null ? '\\N' : String(value).replaceAll('\\','\\\\').replaceAll('\t','\\t').replaceAll('\n','\\n').replaceAll('\r','\\r');
const line = values => values.map(textField).join('\t')+'\n';
let active;
let aborted = false;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  aborted=true;
  active?.stdin.destroy();
  active?.kill('SIGTERM');
});
const config = JSON.parse(await readFile(configFile));
assert.equal((await stat(configFile)).mode & 0o777,0o600);
assert.equal(config.host,'127.0.0.1');
assert.equal(Number(config.port),5432);
assert.equal(config.dbname,'tree_atlas_pilot');
assert.equal(config.user,'tree_atlas_loader');
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')));
const environment = {...inherited,PGHOST:config.host,PGPORT:String(config.port),PGDATABASE:config.dbname,
  PGUSER:config.user,PGPASSWORD:config.password,PGAPPNAME:'tree_atlas_staging_loader',PGCONNECT_TIMEOUT:'3',
  PGCLIENTENCODING:'UTF8'};
function session() {
  const child = spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env:environment,stdio:['pipe','pipe','pipe']});
  active=child;
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>4*1024*1024) child.kill('SIGTERM');});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4096);});
  child.stdin.on('error',()=>{});
  const closed = new Promise((done,reject)=>{child.on('error',reject);child.on('close',code=>done({code,stdout,stderr}));});
  return {child,closed};
}
async function write(child,text) {
  if(aborted || child.stdin.destroyed) throw Error('Import interrupted');
  if(!child.stdin.write(text)) await once(child.stdin,'drain');
}
async function smallSql(sql) {
  const {child,closed}=session();
  child.stdin.end(sql);
  const result=await closed;
  active=null;
  if(result.code!==0) throw Error('Staging SQL failed: '+result.stderr);
  return result.stdout.trim();
}
async function checkedAsset(file,expected) {
  const path=resolve(data,file);
  assert.ok(path.startsWith(data+sep),'Asset escapes data root');
  const bytes=await readFile(path);
  assert.equal(hash(bytes),expected,`Frozen asset mismatch: ${file}`);
  return bytes;
}
function validateTree(tree,dataset) {
  assert.equal(tree.dataset,dataset.id);
  assert.ok(typeof tree.sourceId==='string' && tree.sourceId.length>0 && tree.sourceId.isWellFormed());
  assert.ok(['stable','release'].includes(tree.idScope));
  assert.ok(['existing','removed','unknown'].includes(tree.status));
  for(const field of ['tag','scientificName','commonName','location','age','observedAt'])
    assert.ok(tree[field]===null || typeof tree[field]==='string' && tree[field].isWellFormed(),field);
  const point=tree.position;
  assert.ok(point===null || Array.isArray(point) && point.length===2 && point.every(Number.isFinite) &&
    point[0]>=dataset.bounds[0] && point[0]<=dataset.bounds[2] && point[1]>=dataset.bounds[1] && point[1]<=dataset.bounds[3]);
  for(const field of ['height','crown','circumference']) {
    const measure=tree[field];
    assert.ok(measure && typeof measure==='object');
    assert.ok(['unknown','value','range','over'].includes(measure.kind));
    if(measure.kind!=='unknown') assert.ok(['m','cm'].includes(measure.unit));
    if(['value','over'].includes(measure.kind)) assert.ok(Number.isFinite(measure.value) && measure.value>0);
    if(measure.kind==='range') assert.ok(Number.isFinite(measure.min) && Number.isFinite(measure.max) &&
      measure.min>=0 && measure.max>0 && measure.min<=measure.max);
  }
  assert.ok(tree.plantingYear===null || Number.isInteger(tree.plantingYear) && tree.plantingYear>=1000 && tree.plantingYear<=2200);
  assert.equal(typeof tree.plantingEstimated,'boolean');
  assert.ok(tree.qualityNotes===undefined || Array.isArray(tree.qualityNotes) && tree.qualityNotes.every(note=>typeof note==='string' && note.isWellFormed()));
}
const arguments_=process.argv.slice(2);
function option(name) {const index=arguments_.indexOf(name);return index<0?null:arguments_[index+1];}
for(let i=0;i<arguments_.length;i+=2) assert.ok(['--dataset','--inject-failure-after'].includes(arguments_[i]) && arguments_[i+1], 'Invalid option');
const selected=option('--dataset');
const failure=option('--inject-failure-after');
assert.ok(failure===null || Number.isSafeInteger(Number(failure)) && Number(failure)>0);
const lockBytes=await readFile(resolve(frozen,'baseline.lock.json'));
const lock=JSON.parse(lockBytes);
const sealBytes=await readFile(resolve(frozen,'freeze-v1.json'));
const seal=JSON.parse(sealBytes);
assert.equal(seal.status,'frozen-local');
// Verify every sealed contract/reference artifact before trusting expectations.
for(const entry of seal.files) {
  const path=resolve(frozen,entry.file);
  assert.ok(path.startsWith(frozen+sep));
  const bytes=await readFile(path);
  assert.equal(bytes.length,entry.bytes);
  assert.equal(hash(bytes),entry.sha256,entry.file);
}
const referenceBytes=await readFile(resolve(frozen,'reference/reference-results.json'));
const reference=JSON.parse(referenceBytes);
assert.equal(reference.baselineLockSha256,hash(lockBytes));
assert.ok(reference.passed);
const datasets=lock.datasets.filter(item=>selected===null || item.id===selected);
assert.ok(datasets.length>0,'Unknown dataset');
assert.ok(failure===null || datasets.length===1,'Fault injection requires one dataset');
const report={scope:'local canonical staging imports, not source acquisition or deployment',
  database:config.dbname,freezeSha256:hash(sealBytes),baselineLockSha256:hash(lockBytes),releases:[]};
await mkdir(resolve(root,'evidence'),{recursive:true});
for(const dataset of datasets) {
  const started=performance.now();
  const expected=reference.datasets.find(item=>item.dataset===dataset.id);
  assert.ok(expected && expected.release===dataset.release);
  const metadata={contractVersion:'1.0.0',searchNormalizer:lock.searchNormalizer,freezeSha256:hash(sealBytes),
    baselineLockSha256:hash(lockBytes),referenceSha256:hash(referenceBytes),source:dataset};
  const existing=await smallSql(`SELECT to_jsonb(r)::text FROM atlas.releases r WHERE dataset=${quote(dataset.id)} AND release=${quote(dataset.release)};`);
  if(existing) {
    const row=JSON.parse(existing);
    assert.deepEqual(stable(row.metadata),stable(metadata),'Immutable release metadata collision');
    assert.equal(Number(row.expected_count),dataset.count);
    assert.equal(Number(row.expected_located_count),dataset.locatedCount);
    assert.equal(row.expected_identity_sha256,expected.identitySha256);
    assert.equal(row.expected_content_sha256,expected.contentSha256);
    assert.ok(['staged','validated'].includes(row.status),'An unsealed release cannot be resumed implicitly');
    assert.equal(failure,null,'Cannot fault-inject an existing immutable release');
    report.releases.push({dataset:dataset.id,release:dataset.release,result:'unchanged',count:dataset.count,status:row.status});
    console.log(JSON.stringify(report.releases.at(-1)));
    continue;
  }
  const descriptor=JSON.parse(await checkedAsset(dataset.file,dataset.sha256));
  assert.equal(descriptor.dataset,dataset.id);assert.equal(descriptor.release,dataset.release);
  await checkedAsset(dataset.provenanceFile,dataset.provenanceSha256);
  const dictionary=new Map();
  let ordinal=0,located=0,previous=null;
  const {child,closed}=session();
  try {
    await write(child,`BEGIN; SET LOCAL statement_timeout='30min'; SET LOCAL lock_timeout='5s'; SET LOCAL standard_conforming_strings=on;
SELECT pg_advisory_xact_lock(hashtextextended(${quote(dataset.id+':'+dataset.release)},0));
INSERT INTO atlas.releases(dataset,release,metadata,expected_count,expected_located_count,expected_identity_sha256,expected_content_sha256)
VALUES(${quote(dataset.id)},${quote(dataset.release)},${quote(JSON.stringify(metadata))}::jsonb,${dataset.count},${dataset.locatedCount},${quote(expected.identitySha256)},${quote(expected.contentSha256)});
COPY atlas.records(dataset,release,ordinal,canonical,search_id,search_tag,search_scientific,search_common,search_location) FROM STDIN WITH(FORMAT text);
`);
    for(const asset of descriptor.details) {
      const shard=JSON.parse(gunzipSync(await checkedAsset(asset.file,asset.sha256)));
      assert.equal(shard.dataset,dataset.id);assert.equal(shard.release,dataset.release);
      assert.equal(shard.trees.length,asset.count);
      let buffer='';
      for(const tree of shard.trees) {
        validateTree(tree,dataset);
        assert.ok(previous===null || previous<tree.sourceId,'Nonunique or unordered canonical IDs');
        previous=tree.sourceId;
        const values=[tree.tag,tree.scientificName,tree.commonName,tree.location];
        for(const value of values) if(value!==null && !dictionary.has(value)) dictionary.set(value,dictionary.size);
        buffer+=line([dataset.id,dataset.release,ordinal,JSON.stringify(tree),normalize(tree.sourceId),...values.map(normalize)]);
        if(tree.position!==null) located++;
        ordinal++;
        if(failure!==null && ordinal>=Number(failure)) {
          await write(child,buffer);
          throw Error(`INJECTED_IMPORT_FAILURE_AFTER_${ordinal}`);
        }
      }
      await write(child,buffer);
    }
    assert.equal(ordinal,dataset.count);assert.equal(located,dataset.locatedCount);
    await write(child,'\\.\nCOPY atlas.dictionary(dataset,release,ordinal,value,normalized) FROM STDIN WITH(FORMAT text);\n');
    let buffer='';
    for(const [value,index] of dictionary) {
      buffer+=line([dataset.id,dataset.release,index,value,normalize(value)]);
      if(buffer.length>256*1024) {await write(child,buffer);buffer='';}
    }
    if(buffer) await write(child,buffer);
    child.stdin.end(`\\.\nSELECT atlas.finish_loading(${quote(dataset.id)},${quote(dataset.release)});\nCOMMIT;\n`);
    const result=await closed;active=null;
    if(result.code!==0) throw Error('COPY transaction rejected: '+result.stderr);
    const entry={dataset:dataset.id,release:dataset.release,result:'staged',count:ordinal,locatedCount:located,
      dictionaryCount:dictionary.size,elapsedMs:Math.round(performance.now()-started)};
    report.releases.push(entry);console.log(JSON.stringify(entry));
  } catch(error) {
    child.stdin.destroy();
    await closed;active=null;
    throw error;
  }
}
report.passed=true;
const reportFile=selected===null?'import-results.json':`import-${selected}.json`;
await writeFile(resolve(root,'evidence',reportFile),JSON.stringify(report,null,2)+'\n');
