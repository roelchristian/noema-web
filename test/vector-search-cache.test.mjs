import test from 'node:test';
import assert from 'node:assert/strict';
import {CachedVectorSearch} from '../src/server/vector-search.ts';

function countedScan(cache,count,query=[1,0]) {
 const parse=JSON.parse;let parses=0;
 try {
  JSON.parse=(...args)=>{parses++;return parse(...args);};
  for(let index=0;index<count;index++)assert.equal(cache.score(String(index),'[1,0]',query,2),1);
 }finally{JSON.parse=parse;}
 return parses;
}
test('resident segment survives repeated scans beyond entry capacity',()=>{
 for(const count of [4096,4097,8192]) {
  const cache=new CachedVectorSearch();
  assert.equal(countedScan(cache,count),count);
  const parsed=countedScan(cache,count);
  assert.equal(parsed,count<=4096?0:count-3584);
  assert.ok(cache.cacheStats().entries<=4096);
  assert.equal(countedScan(cache,count),parsed);
 }
});
test('new recurring working set is promoted and stale or invalid values never reuse old scores',()=>{
 const cache=new CachedVectorSearch(8);
 countedScan(cache,8);
 assert.equal(cache.score('new','[0,1]',[0,1],2),1);
 assert.equal(cache.score('new','[0,1]',[0,1],2),1);
 const parse=JSON.parse;let parses=0;
 try {JSON.parse=(...args)=>{parses++;return parse(...args);};cache.score('new','[0,1]',[0,1],2);}finally{JSON.parse=parse;}
 assert.equal(parses,0);
 assert.equal(cache.score('new','[1,0]',[0,1],2),0);
 for(const serialized of ['garbage','[0,0]','[1]','[null,1]','[1,"2"]','[1e400,1]'])assert.equal(cache.score('new',serialized,[0,1],2),undefined);
 assert.equal(cache.score('new','[0,1]',[0,0],2),undefined);
 assert.equal(cache.score('new','[0,1]',[0,1],3),undefined);
 cache.clear();assert.deepEqual(cache.cacheStats(),{entries:0,residents:0,probation:0,estimatedBytes:0,maxBytes:256*1024*1024});
});
test('typed doubles preserve exact prior cosine scoring',()=>{
 const cache=new CachedVectorSearch();
 for(let trial=1;trial<=50;trial++) {
  const vector=Array.from({length:1536},(_,index)=>Math.sin(index*trial+0.3));
  const query=Array.from({length:1536},(_,index)=>Math.cos(index+trial));
  const normalize=value=>{const magnitude=Math.sqrt(value.reduce((sum,n)=>sum+n*n,0));return value.map(n=>n/magnitude);};
  const unit=normalize(vector),q=normalize(query),expected=unit.reduce((sum,n,index)=>sum+n*q[index],0);
  assert.equal(cache.score(String(trial),JSON.stringify(vector),query,1536),expected);
 }
});
test('retained payload obeys byte and zero-capacity budgets',()=>{
 const cache=new CachedVectorSearch(4096,1000);
 for(let i=0;i<100;i++)cache.score(String(i),'[1,0]',[1,0],2);
 assert.ok(cache.cacheStats().estimatedBytes<=1000);
 const retained=cache.cacheStats().residents;
 assert.ok(retained>0);
 assert.equal(countedScan(cache,100),100-retained);
 assert.ok(cache.cacheStats().estimatedBytes<=1000);
 const oversized=new CachedVectorSearch(10,1);
 assert.equal(oversized.score('a','[1,0]',[1,0],2),1);
 assert.equal(oversized.cacheStats().entries,0);
 const disabled=new CachedVectorSearch(0);
 assert.equal(disabled.score('a','[1,0]',[1,0],2),1);assert.equal(disabled.cacheStats().entries,0);
});
