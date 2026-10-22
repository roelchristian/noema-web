import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readOpenAIResponse,responseOutputText,redactedTrace} from '../src/server/modules/openai-response.ts';
import {SourcePageDraft} from '../src/server/modules/source-pages.ts';

const message=(id,text,phase)=>({id,type:'message',phase,content:[{type:'output_text',text}]});
const sse=events=>new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
function streamedMessages(messages){
 return messages.flatMap((item,index)=>[
  {type:'response.output_item.added',item,output_index:index},
  ...Array.from(item.content[0].text).map(delta=>({type:'response.output_text.delta',item_id:item.id,output_index:index,content_index:0,delta})),
 ]);
}
test('only the final-answer draft reaches the source parser, while stream diagnostics are aggregated',async()=>{
 const preliminary='Not JSON: preliminary reasoning\n'+JSON.stringify({type:'title',title:'Preliminary title'});
 const final=[{type:'title',title:'Groups of order 3'},{type:'block',blockType:'paragraph',basis:'source',text:'The group is cyclic.',citations:[{startLine:1,endLine:1}]}].map(JSON.stringify).join('\n');
 const messages=[message('preliminary',preliminary,'commentary'),message('final',final,'final_answer')];
 const events=[...streamedMessages(messages),{type:'response.completed',response:{status:'completed',output:messages}}];
 let summary;const traced=[],draft=new SourcePageDraft(()=>{},'The group is cyclic.');
 const trace={stream(value){summary=value;},headers(){},event(type){traced.push(type);},response(){},body(){}};
 const result=await readOpenAIResponse(sse(events),trace,delta=>draft.feed(delta));
 draft.finish();
 assert.equal(draft.title,'Groups of order 3');assert.equal(draft.blocks.length,1);
 assert.equal(responseOutputText(result),final);
 assert.equal(traced.length,0);
 assert.equal(summary.textDeltaCount,preliminary.length+final.length);
 assert.equal(summary.terminalEvent,'response.completed');
 assert.equal(summary.interrupted,false);
});
test('multiple final message parts use the same separators in streaming and final output',async()=>{
 const messages=[message('one','First','final_answer'),message('two','Second','final_answer')],deltas=[];
 const result=await readOpenAIResponse(sse([...streamedMessages(messages),{type:'response.completed',response:{status:'completed',output:messages}}]),undefined,delta=>deltas.push(delta));
 assert.equal(deltas.join(''),'First\nSecond');assert.equal(responseOutputText(result),'First\nSecond');
});
test('legacy messages without phase and JSON fallback still produce output',async()=>{
 const messages=[message('legacy','A complete response')],deltas=[];
 await readOpenAIResponse(sse([...streamedMessages(messages),{type:'response.completed',response:{status:'completed',output:messages}}]),undefined,delta=>deltas.push(delta));
 assert.equal(deltas.join(''),'A complete response');
 const fallback=[];
 await readOpenAIResponse(new Response(JSON.stringify({status:'completed',output:messages}),{headers:{'Content-Type':'application/json'}}),undefined,delta=>fallback.push(delta));
 assert.equal(fallback.join(''),'A complete response');
});
test('a real final-answer mismatch remains an error',async()=>{
 const messages=[message('final','Streamed text','final_answer')];
 await assert.rejects(readOpenAIResponse(sse([...streamedMessages(messages),{type:'response.completed',response:{status:'completed',output:[message('final','Different final text','final_answer')]}}]),undefined,()=>{}),/did not match/);
});

function observer(mode='compact'){
 const captured={requests:[],responses:[],bodies:[],events:[],streams:[]};
 return {captured,trace:{mode,request(...v){captured.requests.push(v);},headers(){},body(v){captured.bodies.push(v);},response(v){captured.responses.push(v);},event(...v){captured.events.push(v);},error(){},stream(v){captured.streams.push(v);}}};
}
test('compact projection omits large prompts and limits output excerpts before redaction',async()=>{
 const {trace,captured}=observer();const wrapped=redactedTrace(trace,'sk-secret-abcdefghijklmnop');
 wrapped.request('/responses',{model:'test',instructions:'private instructions'.repeat(10000),input:[{content:'private source'.repeat(10000)}],stream:true});
 await readOpenAIResponse(Response.json({id:'r1',status:'completed',output:[message('m','sk-secret-abcdefghijklmnop'+'output'.repeat(10000))],usage:{input_tokens:17}}),wrapped);
 assert.equal(captured.requests[0][1].inputCount,1);
 assert.ok(captured.requests[0][1].inputBytes>100000);
 assert.match(captured.requests[0][1].fingerprint,/^[a-f0-9]{64}$/);
 assert.match(captured.responses[0].outputFingerprint,/^[a-f0-9]{64}$/);
 assert.ok(JSON.stringify(captured.requests).length<500);
 assert.ok(JSON.stringify(captured.responses).length<5000);
 assert.ok(!JSON.stringify(captured.responses).includes('sk-secret-abcdefghijklmnop'));
 assert.equal(captured.responses[0].usage.input_tokens,17);assert.deepEqual(captured.bodies,[]);
});
test('full streaming capture writes a bounded body once, preserving aggregate timing',async()=>{
 const {trace,captured}=observer('full'),messages=[message('m','hello')];
 await readOpenAIResponse(sse([...streamedMessages(messages),{type:'response.completed',response:{output:messages}}]),redactedTrace(trace,'secret'));
 assert.equal(captured.bodies.length,1);assert.ok(captured.bodies[0].includes('response.completed'));
 const summary=captured.streams[0];assert.equal(summary.eventCount,7);assert.equal(summary.textBytes,5);
 assert.equal(summary.events['response.output_text.delta'].count,5);assert.ok(summary.firstOutputMs>=0);assert.ok(summary.transportBytes>0);
});
test('interrupted and malformed streams retain aggregate diagnostics without raw compact SSE',async()=>{
 for(const tail of ['', 'data: malformed\n\n']){
  const {trace,captured}=observer();
  const body='data: '+JSON.stringify({type:'response.output_text.delta',delta:'partial'})+'\n\n'+tail;
  await assert.rejects(readOpenAIResponse(new Response(body,{headers:{'Content-Type':'text/event-stream'}}),redactedTrace(trace,'secret')));
  assert.equal(captured.streams[0].textBytes,7);assert.equal(captured.streams[0].interrupted,true);
  assert.equal(captured.streams[0].terminalEvent,null);assert.equal(captured.streams[0].outputExcerpt,'partial');assert.deepEqual(captured.bodies,[]);
 }
});
test('embedding vectors never enter full trace responses or bodies',async()=>{
 const {trace,captured}=observer('full'),wrapped=redactedTrace(trace,'secret');
 wrapped.request('/v1/embeddings',{input:['sample']});
 const data={data:[{index:0,embedding:[0.123456789123456,0.987654321123456]}],usage:{prompt_tokens:3}};
 const result=await readOpenAIResponse(Response.json(data),wrapped);
 assert.deepEqual(result,data);assert.equal(captured.responses[0].data[0].embedding.dimensions,2);
 assert.ok(!JSON.stringify(captured).includes('0.123456789123456'));assert.deepEqual(captured.bodies,[]);
});

test('diagnostic observer failures never interrupt generation or provider usage',async()=>{
 const bad=()=>{throw new Error('debug storage unavailable');};
 const wrapped=redactedTrace({mode:'full',request:bad,headers:bad,body:bad,event:bad,response:bad,error:bad,stream:bad},'secret');
 wrapped.request('/responses',{input:'hello'});
 let usage;const messages=[message('m','hello')];
 const result=await readOpenAIResponse(sse([...streamedMessages(messages),{type:'response.completed',response:{output:messages,usage:{input_tokens:13}}}]),wrapped,undefined,undefined,value=>{usage=value;});
 assert.equal(responseOutputText(result),'hello');assert.equal(usage.input_tokens,13);
 wrapped.error('parser failed');
});
test('failed compact responses keep output excerpts and bounded error details',async()=>{
 const {trace,captured}=observer();
 await readOpenAIResponse(sse([{type:'response.failed',response:{id:'failed',status:'failed',error:{code:'provider_error',message:'bad request'},output:[message('m','partial result')]}}]),redactedTrace(trace,'secret'));
 assert.equal(captured.events[0][1].outputExcerpt,'partial result');
 assert.equal(captured.events[0][1].error.code,'provider_error');assert.equal(captured.responses[0].status,'failed');
});
