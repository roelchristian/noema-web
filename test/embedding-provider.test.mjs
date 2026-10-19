import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Intelligence} from '../src/server/modules/intelligence.ts';
const key='sk-embedding-test-secret-123456789';
function setup(transport){const secrets={value:null,read(){return this.value;},write(value){this.value=value;},remove(){this.value=null;}};const ai=new Intelligence(secrets,transport);ai.save({apiKey:key});return ai;}
const result=(changes={})=>Response.json({model:'text-embedding-3-small',data:[{index:0,embedding:Array(1536).fill(0.025)}],usage:{total_tokens:12},...changes});
test('embedding provider uses the fixed small model, bounded input and float vectors',async()=>{
 let request;
 const ai=setup(async(url,options)=>{request={url,...options};return result();});
 const output=await ai.embed('A note about connected ideas');
 assert.equal(output.embedding.length,1536);assert.equal(output.tokens,12);
 assert.equal(request.url,'https://api.openai.com/v1/embeddings');assert.equal(request.redirect,'error');
 assert.deepEqual(JSON.parse(request.body),{model:'text-embedding-3-small',input:['A note about connected ideas'],encoding_format:'float',dimensions:1536});
 assert.equal(request.headers.Authorization,'Bearer '+key);
 for(const input of ['', ' ', '😀'.repeat(2001)])await assert.rejects(()=>ai.embed(input),e=>e.status===400);
});
test('embedding provider rejects malformed vectors and sanitizes provider errors',async()=>{
 for(const payload of [{model:'other'},{data:[{index:0,embedding:[1,2]}]},{data:[{index:0,embedding:Array(1536).fill(0)}]}]){
  const ai=setup(async()=>result(payload));await assert.rejects(()=>ai.embed('note'),e=>e.status===502);
 }
 const ai=setup(async()=>new Response(key,{status:401}));
 await assert.rejects(()=>ai.embed('note'),e=>e.status===502&&!e.message.includes(key));
 const network=setup(async()=>{throw Error(key);});
 await assert.rejects(()=>network.embed('note'),e=>e.status===502&&!e.message.includes(key));
});
test('embedding provider discards an in-flight vector after credential removal',async()=>{
 let finish;
 const ai=setup(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=ai.embed('private note');ai.remove();finish(result());
 await assert.rejects(()=>pending,e=>e.status===409);
});
