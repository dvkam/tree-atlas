import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
assert.equal(process.version,'v26.13.0');
assert.equal(process.versions.unicode,'17.0');
assert.equal(process.versions.icu,'78.3');
const normal=value=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
let tested=0;
function batch(cases) {
  const input=cases.map(item=>Buffer.from(item.input).toString('hex')).join('\n')+'\n';
  const result=spawnSync(resolve(root,'build/normalizer-probe'),[],{input,encoding:'utf8',maxBuffer:32*1024*1024});
  assert.equal(result.status,0,result.stderr);
  const lines=result.stdout.split('\n');
  assert.equal(lines.pop(),'');
  assert.equal(lines.length,cases.length);
  for(let index=0;index<cases.length;index++) {
    const test=cases[index];
    if(test.error) assert.equal(lines[index],'ERROR',test.name);
    else {
      const text=String(test.input);
      const expected=test.expected ?? normal(text);
      assert.equal(lines[index],`OK ${text.length} ${Buffer.from(expected).toString('hex')}`,test.name ?? `case ${index}`);
    }
    tested++;
  }
}
const fixtures=JSON.parse(await readFile(resolve(root,'../../tree-atlas-contract-v1/reference/fixtures.json')));
batch(fixtures.normalization.map(([input,expected])=>({input,expected,name:'literal'})));
const context=[
  '', 'ΟΣ', 'Σ', 'AΣ', 'AΣA', 'AΣ\u0301', 'AΣ\u0345A', 'A\u200dΣ', 'AΣ\u200d',
  'A\u200dΣ\u200dA', '\u0085 A \u0085', '\ufeffA\ufeff', '\u180eA\u180e',
  '\u200bA\u200b', '\u2028\u2029A\u2029', 'A\u0315\u0300', '\u212b', '\u1e9b\u0323',
  '\u0000A\u0000', '\u0301\u0300', '🌳'.repeat(250), '界'.repeat(500),
];
batch(context.map(input=>({input})));
batch([
  {input:'x'.repeat(501),error:true,name:'length501'},
  {input:'🌳'.repeat(251),error:true,name:'astral502units'},
  {input:'\u0301'.repeat(501),error:true,name:'pre-normalization length'},
  ...['c0af','eda080','edbfbf','f4908080','f5808080','80','e282','e228a1','ff'].map(hex=>({input:Buffer.from(hex,'hex'),error:true,name:'invalid '+hex})),
]);
const started=performance.now();
let group=[];
for(let code=0;code<=0x10ffff;code++) {
  if(code>=0xd800&&code<=0xdfff)continue;
  group.push({input:String.fromCodePoint(code),name:'U+'+code.toString(16)});
  if(group.length===20000){batch(group);group=[];}
}
if(group.length)batch(group);
// Deterministic contextual strings stress combining reordering, case-ignorable
// flanks, supplementary pairs and complete trim behavior, not scalar mapping only.
let seed=0x17c0ffee;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;}
const pool=['Σ','A','a','İ','I','ı','\u0345','\u0301','\u0315','\u0300','\u200d','\u0085','\ufeff',' ',"'",'🌳','\u2028','\u02b0','\ufe0f'];
group=[];
for(let index=0;index<20000;index++) {
  let input='';
  const length=random()%70;
  for(let i=0;i<length;i++) {
    let code=random()%0x110000;
    if(code>=0xd800&&code<=0xdfff)code=0x61;
    input+=random()%3 ? pool[random()%pool.length] : String.fromCodePoint(code);
  }
  group.push({input,name:'context '+index});
}
batch(group);
const report={passed:true,node:process.version,icu:process.versions.icu,unicode:process.versions.unicode,
  allUnicodeScalars:0x110000-0x800,randomContextCases:20000,literalCases:fixtures.normalization.length,
  explicitContextCases:context.length,invalidCases:12,totalCases:tested,elapsedMs:Math.round(performance.now()-started),
  scope:'Native ICU C wrapper compared with frozen Node normalization, plus literal goldens; no query/API performance claim'};
if(process.argv.includes('--record'))await writeFile(resolve(root,'parity-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
