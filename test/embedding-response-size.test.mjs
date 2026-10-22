import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Intelligence,embeddingBatchMaxInputs} from '../src/server/modules/intelligence.ts';
import {readOpenAIResponse} from '../src/server/modules/openai-response.ts';

function setup(transport) {
 const secrets={value:null,read(){return this.value;},write(value){this.value=value;},remove(){this.value=null;}};
 const ai=new Intelligence(secrets,transport);
 ai.save({apiKey:'sk-embedding-size-test-123456789'});
 return ai;
}
const vector=Array.from({length:1536},(_,i)=>i%2?-0.022552490234375:0.051544189453125);
function payload(count) {
 return {model:'text-embedding-3-small',data:Array.from({length:count},(_,index)=>({index,embedding:vector})),usage:{prompt_tokens:123,total_tokens:123}};
}

test('nine-input and maximum embedding batches accept float JSON above the old 128 KB limit',async()=>{
 for(const count of [9,embeddingBatchMaxInputs]) {
  const body=JSON.stringify(payload(count));
  assert.ok(Buffer.byteLength(body)>128000);
  let usage,parsed,debugBody;
  const trace={request(){},headers(){},event(){},response(value){parsed=value;},body(value){debugBody=value;},error(message){assert.fail(message);},usage(value){usage=value;}};
  const ai=setup(async()=>new Response(body,{headers:{'Content-Type':'application/json'}}));
  const result=await ai.embedBatch(Array(count).fill('A source passage'),()=>trace,true);
  assert.equal(result.embeddings.length,count);
  assert.deepEqual(result.embeddings[0],vector);
  assert.equal(result.tokens,123);
  assert.equal(usage.prompt_tokens,123);
  assert.equal(parsed.vectorCount,count);
  assert.ok(parsed.vectors.every(item=>item.dimensions===1536&&item.valid));
  assert.equal(debugBody,undefined);
  assert.ok(!JSON.stringify(parsed).includes(String(vector[0])));
 }
});

test('embedding responses remain bounded and cancel oversized bodies',async()=>{
 const body=JSON.stringify({...payload(9),padding:'x'.repeat(600000)});
 let cancelled=false;
 const ai=setup(async()=>new Response(new ReadableStream({
  start(controller){controller.enqueue(new TextEncoder().encode(body));},
  cancel(){cancelled=true;},
 }),{headers:{'Content-Type':'application/json'}}));
 await assert.rejects(ai.embedBatch(Array(9).fill('A source passage')),error=>error.status===502&&error.message.includes('size limit'));
 assert.equal(cancelled,true);
});

test('ordinary JSON responses retain the existing 128 KB cap',async()=>{
 await assert.rejects(readOpenAIResponse(Response.json({text:'x'.repeat(128000)})),error=>error.status===502&&error.message.includes('size limit'));
});
