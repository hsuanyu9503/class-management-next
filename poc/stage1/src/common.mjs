/** Pure Stage1 helpers. No network, subprocess, database, or secrets. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function relativeRead(p) { return readFileSync(path.join(ROOT, p)); }
export function jsonRead(p) { return JSON.parse(relativeRead(p).toString('utf8')); }
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function parseCsv(s) {
  const rows=[]; let current=[],value='',inside=false;
  for(let i=0;i<s.length;i++) {
    const c=s[i];
    if(inside){ if(c==='"') { if(s[i+1]==='"'){value+='"';i++;} else inside=false; } else value+=c; }
    else if(c==='"') inside=true;
    else if(c===','){current.push(value); value='';}
    else if(c==='\n'){current.push(value.replace(/\r$/,''));if(current.some(x=>x!=='')) rows.push(current);current=[];value='';}
    else value+=c;
  }
  if(inside) throw Error('Unterminated CSV quoted field');
  if(current.length||value){current.push(value);rows.push(current);}
  const [headers,...data]=rows;
  if(!headers) throw Error('Empty CSV');
  return data.map((cells,index)=>{
    if(cells.length!==headers.length)throw Error(`CSV row ${index+2} unexpected column count`);
    return Object.fromEntries(headers.map((key,i)=>[key.replace(/^\uFEFF/,'').trim(),cells[i]]));
  });
}
export function readMatrix(){return parseCsv(relativeRead('contracts/poc-test-matrix-v1.0.csv').toString('utf8'));}
export function loadBaseline(){
  return {fixtures:jsonRead('fixtures/canonical-fixtures-v1.0.json'),matrix:readMatrix(),order:jsonRead('contracts/test-order-v1.0.json'),lock:jsonRead('contracts/source-lock.json'),oracles:jsonRead('contracts/canonical-oracles-v1.0.json')};
}
export function getDataAtPath(obj,dotted) {
  const parts=dotted.split('.'); let current=obj;
  for(const p of parts){if(current===null||typeof current!=='object'||!(p in current))return {exists:false,value:undefined}; current=current[p];}
  return {exists:true,value:current};
}
export function stableJson(obj) {
  // Deterministic canonical string for public fixtures / operation receipt comparisons.
  if(Array.isArray(obj))return `[${obj.map(stableJson).join(',')}]`;
  if(obj!==null&&typeof obj==='object')return `{${Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+stableJson(obj[k])).join(',')}}`;
  return JSON.stringify(obj);
}
export function createFixtureHash(fixtures){return sha256(Buffer.from(stableJson(fixtures),'utf8'));}
