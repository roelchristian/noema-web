import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatResearchTransport} from '../scripts/helpers/chat-research-transport.mjs';

const chat={instructions:'You are Noema Knowledge Chat, a neutral read-only research interface.',input:'{}'};
const options=payload=>({body:JSON.stringify(payload)});
for(const mode of ['answer','error','pending'])test(`non-Chat dispatch cannot consume the ${mode} mode or satisfy a Chat request count`,async()=>{
 let calls=0;
 const transport=chatResearchTransport(async(_payload,options)=>{
  calls++;
  return mode==='pending'?new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true})):new Response('',{status:mode==='error'?503:200});
 });
 for(const payload of [{instructions:'Enrich this source',input:'source text'},{instructions:'Extract source authors',input:'{}'},{},null,{instructions:7}]) {
  await assert.rejects(transport.send('synthetic',options(payload)),/Unexpected non-Chat/);
  assert.equal(transport.requests.length,0);
  assert.equal(calls,0,'Background traffic never reaches the Chat mode');
 }
 assert.equal(transport.unexpected.length,5,'Unexpected traffic remains visible even if the application catches its error');
 const controller=new AbortController();
 const response=transport.send('synthetic',{...options(chat),signal:controller.signal});
 assert.equal(transport.requests.length,1);assert.equal(calls,1);
 if(mode==='pending'){controller.abort();await assert.rejects(response,{name:'AbortError'});}
 else assert.equal((await response).status,mode==='error'?503:200);
});

test('Chat validation failures propagate and remain counted',async()=>{
 const transport=chatResearchTransport(async payload=>assert.match(payload.instructions,/AI PERSONA:/));
 await assert.rejects(transport.send('synthetic',options(chat)),/AI PERSONA/);
 assert.equal(transport.requests.length,1);assert.deepEqual(transport.unexpected,[]);
});
