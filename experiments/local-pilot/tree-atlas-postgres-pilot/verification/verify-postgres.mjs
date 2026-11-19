// Independent staged-database readback. Never loads importer code or writes SQL.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { contentLine, identityLine, normalize, queryKey } from '../../tree-atlas-contract-v1/reference/oracle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FROZEN = resolve(ROOT, '../tree-atlas-contract-v1');
const CONFIG = '/home/david/.config/tree-atlas-postgres-pilot/postgres.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const normalizedFields = [
  ['search_id', 'sourceId'], ['search_tag', 'tag'],
  ['search_scientific', 'scientificName'], ['search_common', 'commonName'],
  ['search_location', 'location'],
];
function boxPredicate(box) {
  return `lon >= ${box[0]}::float8 AND lon <= ${box[2]}::float8 AND lat >= ${box[1]}::float8 AND lat <= ${box[3]}::float8`;
}
function membership(query) {
  const term = normalize(query.q);
  const text = term === '' ? 'TRUE' : '(' + normalizedFields.map(([column]) =>
    `COALESCE(strpos(${column}, ${quote(term)}), 0) > 0`).join(' OR ') + ')';
  return text + (query.area === null ? '' : ` AND (${boxPredicate(query.area)})`);
}
function scope(dataset) {
  return `dataset = ${quote(dataset.dataset)} AND release = ${quote(dataset.release)}`;
}

export class Readback {
  constructor(reference, lock, freezeSha256, baselineLockSha256, fixtures = {queries:[],recordSets:[]}, referenceSha256 = null) {
    this.reference = reference;
    this.lock = lock;
    this.freezeSha256 = freezeSha256;
    this.baselineLockSha256 = baselineLockSha256;
    this.referenceSha256 = referenceSha256;
    this.session = null;
    this.fixtures = fixtures;
    this.fixtureCases = new Map();
    this.datasets = new Map(reference.datasets.map(expected => [expected.dataset, {
      expected, records: 0, located: 0, identity: createHash('sha256'), content: createHash('sha256'),
      dictionaryCount: 0, dictionaryHash: createHash('sha256'), metadata: null,
      queries: new Map(expected.queries.map(query => [query.name, {
        expected: query, count: 0, located: 0, viewport: 0,
        ids: createHash('sha256'), viewportIds: createHash('sha256'),
        pageIds: query.pages.map(() => []),
      }])), suggestions: new Map(),
    }]));
  }
  consume(event) {
    if (event.kind === 'session') {
      assert.equal(this.session, null, 'Repeated database session header');
      assert.equal(event.readOnly, 'on', 'Verification transaction is writable');
      assert.equal(event.isolation, 'repeatable read');
      assert.equal(event.database, 'tree_atlas_pilot');
      assert.equal(event.user, 'tree_atlas_verify');
      this.session = event;
      return;
    }
    assert.ok(this.session, 'Missing transaction evidence');
    if (event.kind === 'fixture') {
      assert.ok(!this.fixtureCases.has(event.name),'Repeated literal SQL case');
      const expected = this.fixtures.queries.find(item=>item.name===event.name) ??
        this.fixtures.recordSets.find(item=>item.name===event.name);
      assert.ok(expected,'Unknown literal SQL case');
      const ids = expected.ids ?? expected.expectedIds;
      assert.deepEqual(event.ids,ids,`Literal SQL membership differs: ${event.name}`);
      assert.deepEqual(event.items,expected.items ?? ids.slice(expected.offset ?? 0,(expected.offset ?? 0)+(expected.limit ?? 100)));
      if(expected.viewportIds)assert.deepEqual(event.viewportIds,expected.viewportIds);
      this.fixtureCases.set(event.name,true);
      return;
    }
    const state = this.datasets.get(event.dataset);
    assert.ok(state, 'Unexpected dataset in database export');
    const expected = state.expected;
    assert.equal(event.release, expected.release, 'Release identity mismatch');
    if (event.kind === 'metadata') {
      assert.equal(state.metadata, null, 'Repeated release row');
      const row = event.row;
      assert.ok(['staged', 'validated'].includes(row.status), 'Release not fully staged');
      assert.equal(row.expected_count, expected.count);
      assert.equal(row.expected_located_count, expected.locatedCount);
      assert.equal(row.expected_identity_sha256, expected.identitySha256);
      assert.equal(row.expected_content_sha256, expected.contentSha256);
      assert.equal(row.metadata.contractVersion, '1.0.0');
      assert.equal(row.metadata.searchNormalizer, this.lock.searchNormalizer);
      assert.equal(row.metadata.freezeSha256, this.freezeSha256);
      assert.equal(row.metadata.baselineLockSha256, this.baselineLockSha256);
      if(this.referenceSha256!==null)assert.equal(row.metadata.referenceSha256,this.referenceSha256);
      assert.deepEqual(row.metadata.source, this.lock.datasets.find(item => item.id === event.dataset));
      state.metadata = row;
    } else if (event.kind === 'record') {
      assert.ok(state.metadata, 'Records preceded their release metadata');
      const row = event.row;
      assert.equal(row.ordinal, state.records, 'Noncontiguous prepared ordinals');
      assert.equal(row.canonical.dataset, event.dataset);
      assert.equal(row.source_id, row.canonical.sourceId);
      assert.ok(typeof row.source_id === 'string' && row.source_id.length > 0);
      assert.deepEqual([row.lon, row.lat], row.canonical.position ?? [null, null], 'Geometry projection differs');
      for (const [column, field] of normalizedFields)
        assert.equal(row[column], row.canonical[field] === null ? null : normalize(row.canonical[field]),
          `Normalized projection differs: ${column}`);
      state.identity.update(identityLine(event.dataset, event.release, row.source_id));
      state.content.update(contentLine(row.ordinal, row.canonical));
      state.records++;
      if (row.lon !== null) state.located++;
    } else if (event.kind === 'dictionary') {
      assert.equal(event.ordinal, state.dictionaryCount, 'Dictionary ordinals not contiguous');
      assert.equal(event.normalized, normalize(event.value));
      state.dictionaryHash.update(JSON.stringify(event.value) + '\n');
      state.dictionaryCount++;
    } else if (event.kind === 'query') {
      const query = state.queries.get(event.case);
      assert.ok(query, 'Unexpected query');
      assert.ok(typeof event.sourceId === 'string');
      for (let i = 0; i < query.expected.pages.length; i++) {
        const page = query.expected.pages[i];
        if (query.count >= page.offset && query.count < page.offset + page.limit)
          query.pageIds[i].push(event.sourceId);
      }
      query.ids.update(identityLine(event.dataset, event.release, event.sourceId));
      if (event.located) query.located++;
      if (event.inViewport) {
        assert.equal(event.located, true);
        query.viewport++;
        query.viewportIds.update(identityLine(event.dataset, event.release, event.sourceId));
      }
      query.count++;
    } else if (event.kind === 'suggestions') {
      assert.ok(!state.suggestions.has(event.q), 'Repeated suggestion case');
      const suggestion = expected.suggestions.cases.find(item => item.q === event.q);
      assert.ok(suggestion, 'Unexpected suggestion case');
      assert.deepEqual(event.values, suggestion.values);
      state.suggestions.set(event.q, event.values);
    } else {
      throw Error('Unknown database export event');
    }
  }
  finish() {
    assert.ok(this.session, 'No database transaction observed');
    const datasets = [];
    for (const state of this.datasets.values()) {
      const expected = state.expected;
      assert.ok(state.metadata, 'Missing release metadata');
      assert.equal(state.records, expected.count);
      assert.equal(state.located, expected.locatedCount);
      const identitySha256 = state.identity.digest('hex');
      const contentSha256 = state.content.digest('hex');
      assert.equal(identitySha256, expected.identitySha256, `Identity mismatch: ${expected.dataset}`);
      assert.equal(contentSha256, expected.contentSha256, `Content mismatch: ${expected.dataset}`);
      assert.equal(state.dictionaryCount, expected.suggestions.dictionaryCount);
      const dictionarySha256 = state.dictionaryHash.digest('hex');
      assert.equal(dictionarySha256, expected.suggestions.dictionarySha256);
      let pagesChecked = 0;
      const queries = [];
      for (const query of state.queries.values()) {
        const actualIds = query.ids.digest('hex');
        const actualViewport = query.viewportIds.digest('hex');
        assert.equal(query.count, query.expected.total, `${expected.dataset}/${query.expected.name} total`);
        assert.equal(query.located, query.expected.locatedTotal);
        assert.equal(query.viewport, query.expected.viewportLocatedTotal);
        assert.equal(actualIds, query.expected.orderedIdentitySha256);
        assert.equal(actualViewport, query.expected.viewportIdentitySha256);
        for (let index = 0; index < query.expected.pages.length; index++) {
          const page = query.expected.pages[index];
          assert.deepEqual(query.pageIds[index], page.ids, `${expected.dataset}/${query.expected.name}/${page.kind}`);
          assert.equal(queryKey(expected.dataset, expected.release, {...query.expected, offset:page.offset,limit:page.limit}), page.queryKey);
          pagesChecked++;
        }
        queries.push({case:query.expected.name, total:query.count, locatedTotal:query.located,
          viewportLocatedTotal:query.viewport, identitySha256:actualIds, viewportIdentitySha256:actualViewport});
      }
      assert.equal(state.suggestions.size, expected.suggestions.cases.length);
      datasets.push({dataset:expected.dataset, release:expected.release, observedStatus:state.metadata.status,
        records:state.records, located:state.located, normalizedRecordsChecked:state.records,
        identitySha256, contentSha256, dictionaryCount:state.dictionaryCount, dictionarySha256,
        queryCases:queries.length, pagesChecked, suggestionCases:state.suggestions.size, queries});
    }
    assert.equal(this.fixtureCases.size,this.fixtures.queries.length+this.fixtures.recordSets.length);
    return {session:this.session,datasets,totalRecords:datasets.reduce((sum,item)=>sum+item.records,0),
      literalSqlCases:this.fixtureCases.size};
  }
}

function literalRows(rows) {
  const number = value => value===null?'NULL::float8':`${value}::float8`;
  const text = value => value===null?'NULL::text':`${quote(value)}::text`;
  return `WITH rows(ordinal,source_id,canonical,lon,lat,${normalizedFields.map(([column])=>column).join(',')}) AS (VALUES `+
    rows.map((row,ordinal)=>'('+[ordinal,text(row.sourceId),quote(JSON.stringify(row))+'::jsonb',
      number(row.position?.[0]??null),number(row.position?.[1]??null),
      ...normalizedFields.map(([,field])=>text(row[field]===null?null:normalize(row[field])))].join(',')+')').join(',')+') ';
}
function sql(reference, fixtures) {
  const statements = [
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;',
    "SET LOCAL standard_conforming_strings = on;",
    `SELECT json_build_object('kind','session','database',current_database(),'user',current_user,
      'readOnly',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),
      'serverVersion',current_setting('server_version'),'backendPid',pg_backend_pid());`,
  ];
  for(const test of [...fixtures.queries,...fixtures.recordSets]) {
    const query = {q:'',area:null,viewport:[-180,-90,180,90],zoom:12,offset:0,limit:100,...test};
    const rows = test.rows ?? fixtures.rows;
    const filter = membership(query);
    statements.push(literalRows(rows)+`SELECT json_build_object('kind','fixture','name',${quote(test.name)},
      'ids',COALESCE((SELECT json_agg(source_id ORDER BY ordinal) FROM rows WHERE ${filter}),'[]'::json),
      'items',COALESCE((SELECT json_agg(source_id ORDER BY ordinal) FROM
        (SELECT ordinal,source_id FROM rows WHERE ${filter} ORDER BY ordinal OFFSET ${query.offset} LIMIT ${query.limit}) page),'[]'::json),
      'viewportIds',COALESCE((SELECT json_agg(source_id ORDER BY ordinal) FROM rows WHERE (${filter}) AND (${boxPredicate(query.viewport)})),'[]'::json));`);
  }
  for (const dataset of reference.datasets) {
    const constant = `'dataset',${quote(dataset.dataset)},'release',${quote(dataset.release)}`;
    statements.push(`SELECT json_build_object('kind','metadata',${constant},'row',to_jsonb(r)) FROM atlas.releases r WHERE ${scope(dataset)};`);
    statements.push(`SELECT json_build_object('kind','record',${constant},'row',json_build_object(
      'ordinal',ordinal,'source_id',source_id,'canonical',canonical,'lon',lon,'lat',lat,
      'search_id',search_id,'search_tag',search_tag,'search_scientific',search_scientific,
      'search_common',search_common,'search_location',search_location))
      FROM atlas.records WHERE ${scope(dataset)} ORDER BY ordinal;`);
    statements.push(`SELECT json_build_object('kind','dictionary',${constant},'ordinal',ordinal,'value',value,'normalized',normalized)
      FROM atlas.dictionary WHERE ${scope(dataset)} ORDER BY ordinal;`);
    for (const query of dataset.queries) {
      statements.push(`SELECT json_build_object('kind','query',${constant},'case',${quote(query.name)},
        'sourceId',source_id,'located',lon IS NOT NULL,'inViewport',COALESCE((${boxPredicate(query.viewport)}),false))
        FROM atlas.records WHERE ${scope(dataset)} AND (${membership(query)}) ORDER BY ordinal;`);
    }
    for (const suggestion of dataset.suggestions.cases) {
      const term = normalize(suggestion.q);
      const predicate = term.length < 2 ? 'FALSE' : `strpos(normalized,${quote(term)}) > 0`;
      statements.push(`SELECT json_build_object('kind','suggestions',${constant},'q',${quote(suggestion.q)},
        'values',COALESCE((SELECT json_agg(value ORDER BY ordinal) FROM
          (SELECT ordinal,value FROM atlas.dictionary WHERE ${scope(dataset)} AND (${predicate}) ORDER BY ordinal LIMIT 8) suggestions),'[]'::json));`);
    }
  }
  statements.push('COMMIT;');
  return statements.join('\n');
}

async function verifySeal() {
  const freezeBytes = await readFile(resolve(FROZEN,'freeze-v1.json'));
  const freeze = JSON.parse(freezeBytes);
  assert.equal(freeze.status,'frozen-local');
  for (const entry of freeze.files) {
    const path = resolve(FROZEN,entry.file);
    assert.ok(path.startsWith(FROZEN+sep),'Frozen path leaves root');
    const bytes = await readFile(path);
    assert.equal(bytes.length,entry.bytes);
    assert.equal(digest(bytes),entry.sha256,`Frozen artifact changed: ${entry.file}`);
  }
  return digest(freezeBytes);
}

async function main() {
  const started = performance.now();
  const runId = randomUUID();
  const reportPath = resolve(ROOT,'evidence/postgres-independent-verification.json');
  await mkdir(dirname(reportPath),{recursive:true});
  async function report(value) {
    const temporary = reportPath+`.${process.pid}.tmp`;
    await writeFile(temporary,JSON.stringify(value,null,2)+'\n');
    await rename(temporary,reportPath);
  }
  // A failed new run must never leave an older success available for promotion.
  await report({passed:false,state:'running',runId,databaseWrites:false});
  const freezeSha256 = await verifySeal();
  const lockBytes = await readFile(resolve(FROZEN,'baseline.lock.json'));
  const lock = JSON.parse(lockBytes);
  assert.equal(process.version,lock.referenceRuntime.node);
  assert.equal(process.versions.unicode,lock.referenceRuntime.unicode);
  assert.equal(process.versions.icu,lock.referenceRuntime.icu);
  const referenceBytes = await readFile(resolve(FROZEN,'reference/reference-results.json'));
  const reference = JSON.parse(referenceBytes);
  assert.equal(reference.baselineLockSha256,digest(lockBytes));
  const fixtures = JSON.parse(await readFile(resolve(FROZEN,'reference/fixtures.json')));
  assert.equal((await stat(CONFIG)).mode & 0o777,0o600,'Private PostgreSQL config permissions');
  const config = JSON.parse(await readFile(CONFIG));
  assert.equal(config.dbname,'tree_atlas_pilot');
  assert.equal(config.host,'127.0.0.1');
  assert.equal(Number(config.port),5432);
  assert.equal(config.user,'tree_atlas_verify');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')));
  Object.assign(environment,{PGHOST:config.host, PGPORT:String(config.port),
    PGDATABASE:config.dbname, PGUSER:config.user, PGPASSWORD:config.password,
    PGAPPNAME:'tree_atlas_independent_verifier', PGCLIENTENCODING:'UTF8',
    PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=300000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000'});
  const processSql = spawn('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env:environment,stdio:['pipe','pipe','pipe']});
  const done = once(processSql,'close').catch(()=>[null,'spawn-error']);
  let inputFailure = null;
  processSql.stdin.on('error',error=>{inputFailure=error.code??'input-error';});
  let errors = '';
  processSql.stderr.on('data',chunk => {if(errors.length<16384)errors+=chunk.toString();});
  const timeout = setTimeout(()=>processSql.kill('SIGTERM'),20*60*1000);
  let exported = 0;
  const reader = new Readback(reference,lock,freezeSha256,digest(lockBytes),fixtures,digest(referenceBytes));
  try {
    processSql.stdin.end(sql(reference,fixtures));
    for await (const line of createInterface({input:processSql.stdout,crlfDelay:Infinity})) {
      if(!line.trim())continue;
      reader.consume(JSON.parse(line));
      exported++;
      if(exported%250000===0)console.log(JSON.stringify({progress:'database readback',events:exported}));
    }
    const [code,signal] = await done;
    assert.equal(inputFailure,null,'PostgreSQL input stream failed');
    assert.equal(signal,null,'Verification process interrupted');
    assert.equal(code,0,'PostgreSQL readback failed; '+errors.slice(0,2048));
    const verified = reader.finish();
    assert.equal(verified.totalRecords,lock.totalRecords);
    const result = {passed:true,runId,date:'2026-11-08',scope:'Independent read-only staged SQL verification, not HTTP, Carbon query adapter, map cluster, browser offline or performance conformance',
      freezeSha256,baselineLockSha256:digest(lockBytes),referenceSha256:digest(referenceBytes),
      ...verified,eventsRead:exported,elapsedMs:Math.round(performance.now()-started),
      paginationEvidence:'192 expected ordinal page slices checked against complete ordered SQL matching-ID streams; no HTTP pagination claim',
      databaseWrites:false,deployment:false};
    await report(result);
    console.log(JSON.stringify({passed:true,records:result.totalRecords,queries:result.datasets.reduce((sum,d)=>sum+d.queryCases,0),
      suggestions:result.datasets.reduce((sum,d)=>sum+d.suggestionCases,0),elapsedMs:result.elapsedMs}));
  } catch(error) {
    processSql.kill('SIGTERM');
    await done.catch(()=>{});
    // Do not echo connection arguments, configuration or database diagnostics.
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
