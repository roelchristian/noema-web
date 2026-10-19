import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tokenHistogram,validTokenHistogram,upgradeTokenHistogram,compareTokenHistograms} from '../src/server/modules/token-histogram.ts';

const roundtrip=value=>JSON.parse(JSON.stringify(value));
const current=tokens=>({version:2,tokenCounts:tokenHistogram(tokens),tokenCount:tokens.length});
const legacy=(tokens,version)=>({...(version===undefined?{}:{version}),tokenCounts:tokens.reduce((counts,token)=>{counts[token]=(counts[token]??0)+1;return counts;},Object.create(null)),tokenCount:tokens.length});
const words=Array.from({length:5000},(_,index)=>`word${index}`);

test('bounded histogram conserves all token mass beyond the vocabulary limit',()=>{
 const tokens=[...words,...Array(6000).fill('tail')];
 const histogram=roundtrip(current(tokens));
 assert.ok(Object.keys(histogram.tokenCounts).length<=4096);
 assert.equal(Object.values(histogram.tokenCounts).reduce((sum,count)=>sum+count,0),tokens.length);
 assert.equal(validTokenHistogram(histogram),true);
 assert.deepEqual(compareTokenHistograms(histogram,roundtrip(histogram)),{score:0,overlap:tokens.length,retainedFraction:1});
});

for(const version of [undefined,1])test(`complete legacy histogram ${version??'unmarked'} upgrades weighted counts without losing novelty`,()=>{
 const tokens=['apple','apple','apple','pear','pear','constructor','prototype','b1'];
 const baseline=roundtrip(legacy(tokens,version));
 assert.deepEqual(upgradeTokenHistogram(baseline),current(tokens));
 assert.equal(compareTokenHistograms(roundtrip(current(tokens)),baseline).score,0);
 assert.equal(compareTokenHistograms(baseline,roundtrip(current(tokens))).score,0);
 const changed=current(Array(tokens.length).fill('volcano'));
 assert.equal(compareTokenHistograms(changed,baseline).score,compareTokenHistograms(changed,current(tokens)).score);
 assert.ok(compareTokenHistograms(changed,baseline).score>=0.3);
 assert.equal(baseline.version,version,'conversion must not mutate persisted evidence');
});

test('truncated legacy evidence fails closed even when the retained vocabulary and length match',()=>{
 const retained=words.slice(0,4096);
 const baseline=legacy(retained,1);baseline.tokenCount+=6000;
 const changed=roundtrip(current([...retained,...Array(6000).fill('newtail')]));
 assert.equal(validTokenHistogram(baseline),true);
 assert.equal(upgradeTokenHistogram(baseline),undefined);
 assert.equal(compareTokenHistograms(changed,roundtrip(baseline)).score,1);
 assert.equal(compareTokenHistograms(roundtrip(baseline),changed).score,1);
});

test('empty histograms upgrade consistently across legacy and current encodings',()=>{
 for(const version of [undefined,1,2]){
  const baseline={...(version===undefined?{}:{version}),tokenCounts:{},tokenCount:0};
  assert.deepEqual(upgradeTokenHistogram(baseline),current([]));
  assert.equal(compareTokenHistograms(current([]),baseline).score,0);
  assert.equal(compareTokenHistograms(current(['apple']),baseline).score,1);
 }
});

test('malformed histograms never provide evidence of stability',()=>{
 for(const malformed of [null,[],{}, {version:3,tokenCounts:{apple:1},tokenCount:1}, {version:2,tokenCounts:{apple:1},tokenCount:1}, {version:2,tokenCounts:{b4096:1},tokenCount:1}, {version:2,tokenCounts:{b1:1},tokenCount:2}, {version:1,tokenCounts:{apple:2},tokenCount:1}, {version:1,tokenCounts:{apple:0},tokenCount:0}, {version:1,tokenCounts:{apple:1.5},tokenCount:2}, {version:1,tokenCounts:{},tokenCount:1}]){
  assert.equal(upgradeTokenHistogram(malformed),undefined,JSON.stringify(malformed));
  assert.equal(compareTokenHistograms(current(['apple']),malformed).score,1,JSON.stringify(malformed));
 }
});

test('legacy migration adds weighted counts when distinct words share a bucket',()=>{
 const buckets=new Map();let pair;
 for(const word of words){
  const bucket=Object.keys(tokenHistogram([word]))[0];
  if(buckets.has(bucket)){pair=[buckets.get(bucket),word];break;}
  buckets.set(bucket,word);
 }
 assert.ok(pair,'5000 distinct words must collide in 4096 buckets');
 const tokens=[...Array(7).fill(pair[0]),...Array(11).fill(pair[1])];
 const upgraded=upgradeTokenHistogram(roundtrip(legacy(tokens,1)));
 assert.deepEqual(upgraded,current(tokens));
 assert.deepEqual(Object.values(upgraded.tokenCounts),[18]);
});
