// Synthetic local-only benchmark. No provider, SQL, or network access.
// node --expose-gc --import tsx scripts/benchmark-vector-cache.mjs
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {CachedVectorSearch} from '../src/server/vector-search.ts';

// The baseline adapter is the previous FIFO algorithm, retained here to make
// capacity-boundary and larger-corpus comparisons repeatable after changes.
class BaselineVectorSearch {
 vectors=new Map();queries=new WeakMap();
 normalize(vector,dimensions){if(!Array.isArray(vector)||vector.length!==dimensions||Array.from(vector).some(n=>typeof n!=='number'||!Number.isFinite(n)))return;const magnitude=Math.sqrt(vector.reduce((sum,n)=>sum+n*n,0));if(!magnitude||!Number.isFinite(magnitude))return;return vector.map(n=>n/magnitude);}
 score(key,serialized,query,dimensions){const cacheKey=`${dimensions}:${key}`;let entry=this.vectors.get(cacheKey);if(!entry||entry.serialized!==serialized){entry={serialized,unit:this.normalize(JSON.parse(serialized),dimensions)};this.vectors.delete(cacheKey);this.vectors.set(cacheKey,entry);if(this.vectors.size>4096)this.vectors.delete(this.vectors.keys().next().value);}if(!this.queries.has(query))this.queries.set(query,this.normalize(query,dimensions));const q=this.queries.get(query);return entry.unit.reduce((sum,n,i)=>sum+n*q[i],0);}
 clear(){this.vectors.clear();this.queries=new WeakMap();}
}
const dimensions=1536;
// Nine decimal places approximates provider output; 128 different payloads keep
// fixture allocation small. Distinct keys still require independent decoding.
const payloads=Array.from({length:128},(_,seed)=>JSON.stringify(Array.from({length:dimensions},(_,index)=>Number((Math.sin(index+seed*0.37)/Math.sqrt(dimensions)).toFixed(9)))));
const query=Array.from({length:dimensions},(_,index)=>Math.cos(index)/Math.sqrt(dimensions));
const sizes=process.argv.slice(2).map(Number);
if(sizes.some(size=>!Number.isInteger(size)||size<1))throw new Error('Supply positive integer corpus sizes.');
for(const count of sizes.length?sizes:[4096,4097,8192,16384]) {
 let expectedChecksum;
 for(const [algorithm,Adapter] of [['baseline FIFO',BaselineVectorSearch],['segmented Float64',CachedVectorSearch]]) {
  global.gc?.();const before=process.memoryUsage();const cache=new Adapter();
  let checksum=0;
  const scan=()=>{const parse=JSON.parse;let parses=0;const start=performance.now();try{JSON.parse=(...args)=>{parses++;return parse(...args);};for(let index=0;index<count;index++)checksum+=cache.score(String(index),payloads[index%128],query,dimensions);}finally{JSON.parse=parse;}return {parses,ms:Number((performance.now()-start).toFixed(1))};};
  const cold=scan(),warm=scan();global.gc?.();const memory=process.memoryUsage();
  if(expectedChecksum===undefined)expectedChecksum=checksum;else assert.equal(checksum,expectedChecksum,'Scoring changed from baseline');
  console.log(JSON.stringify({algorithm,count,dimensions,cold,warm,retainedHeapMiB:Number(((memory.heapUsed-before.heapUsed)/1048576).toFixed(2)),retainedArrayBufferMiB:Number(((memory.arrayBuffers-before.arrayBuffers)/1048576).toFixed(2)),cache:cache.cacheStats?.(),checksum:Number(checksum.toFixed(9))}));
  cache.clear();global.gc?.();
 }
}
