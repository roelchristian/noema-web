import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SemanticSearch} from '../src/client/search/semantic-search.ts';
import {combinedMatches} from '../src/client/search/matches.ts';
const result=(id,score=1)=>({id,title:id,score,updated_at:'2026-10-16'});
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
test('combined search preserves text matches, merges semantic pages once, and respects the supplied scope',()=>{
 const items=[{id:'semantic-low',kind:'page',name:'Unrelated title'},{id:'both',kind:'page',name:'Garden plan'},{id:'entity',kind:'entity',name:'Garden society'},{id:'semantic-high',kind:'page',name:'Planting notes'},{id:'collision',kind:'entity',name:'Unrelated entity'}];
 const semantic=[result('both',.9),result('semantic-high',.8),result('semantic-low',.5),result('collision',1),result('outside-scope',1)];
 assert.deepEqual(combinedMatches(items,'garden',semantic).map(item=>item.id),['both','entity','semantic-high','semantic-low']);
 assert.deepEqual(combinedMatches(items.slice(0,1),'garden',semantic).map(item=>item.id),['semantic-low']);
 assert.deepEqual(combinedMatches(items,'garden',[]).map(item=>item.id),['both','entity']);
 assert.deepEqual(combinedMatches(items,'  ',semantic),items);
});
test('semantic searches debounce typing, skip empty queries, and retain query and vault identity',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const calls=[],states=[];
 const search=new SemanticSearch(async(vault,query)=>{calls.push({vault,query});return {results:[result(query)]};},value=>states.push(value));
 search.update('one','gar');t.mock.timers.tick(400);search.update('one',' garden ');t.mock.timers.tick(599);assert.equal(calls.length,0);
 t.mock.timers.tick(1);await settle();assert.deepEqual(calls,[{vault:'one',query:'garden'}]);
 assert.equal(states.at(-1).vault,'one');assert.equal(states.at(-1).results[0].id,'garden');assert.equal(states.at(-1).loading,false);
 search.update('one','');t.mock.timers.tick(1000);assert.equal(calls.length,1);assert.deepEqual(states.at(-1).results,[]);search.cancel();
});
test('old requests are aborted and ignored after a query change, vault switch, or disposal',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const pending=[],states=[];
 const search=new SemanticSearch((vault,query,signal)=>new Promise((resolve,reject)=>pending.push({vault,query,signal,resolve,reject})),value=>states.push(value));
 search.update('one','old');t.mock.timers.tick(600);
 search.update('two','new');assert.equal(pending[0].signal.aborted,true);t.mock.timers.tick(600);
 pending[0].resolve({results:[result('private-old')]});await settle();assert.equal(states.at(-1).vault,'two');assert.deepEqual(states.at(-1).results,[]);
 pending[1].resolve({results:[result('new')]});await settle();assert.equal(states.at(-1).results[0].id,'new');
 search.update('two','last');t.mock.timers.tick(600);search.cancel();const count=states.length;pending[2].reject(Error('late failure'));await settle();assert.equal(states.length,count);
});
test('semantic errors allow the UI to keep showing text matches',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let state;
 const search=new SemanticSearch(async()=>{throw Error('Add an API key.');},value=>state=value);
 search.update('one','garden');t.mock.timers.tick(600);await settle();assert.equal(state.loading,false);assert.match(state.error,/Text matches are still shown/);assert.deepEqual(state.results,[]);search.cancel();
});
