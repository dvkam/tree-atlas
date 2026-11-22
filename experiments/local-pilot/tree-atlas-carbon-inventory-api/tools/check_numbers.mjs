// Independent ECMAScript numeric-serialization oracle, not native helper code.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const values=[0,-0,1,1e-6,1e-7,-1e-6,1e20,1e21,Number.MIN_VALUE,0.00000010000000000000001,179.99999999999997,24.000000000000004];
let seed=0x5a17c0de;
function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
const buffer=Buffer.alloc(8);
while(values.length<20012){buffer.writeUInt32LE(random(),0);buffer.writeUInt32LE(random(),4);const value=buffer.readDoubleLE();if(Number.isFinite(value)&&Math.abs(value)<=180)values.push(value);}
const input=values.map(value=>{buffer.writeDoubleLE(value);return buffer.readBigUInt64LE().toString(16);}).join('\n')+'\n';
const result=spawnSync(fileURLToPath(new URL('../build/number_probe',import.meta.url)),[],{input,encoding:'utf8',maxBuffer:8*1024*1024});
assert.equal(result.status,0,result.stderr);
const lines=result.stdout.trimEnd().split('\n');assert.equal(lines.length,values.length);
for(let i=0;i<values.length;i++)assert.equal(lines[i],JSON.stringify(values[i]),`IEEE754 case ${i}`);
const report={passed:true,node:process.version,cases:values.length,scope:'Native shortest number serialization vs ECMAScript JSON.stringify, including finite subnormal and geographic inputs'};
writeFileSync(new URL('../evidence/number-parity.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
