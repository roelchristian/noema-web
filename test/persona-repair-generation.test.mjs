import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Intelligence} from '../src/server/modules/intelligence.ts';
import {completedResponse} from './helpers/providers.ts';

const original='An archive preserves some records and loses others. Because survival is selective, the absence of a record does not by itself prove that an event never occurred; historians must distinguish the surviving evidence from the larger past they seek to understand.';
const repaired='Although an archive preserves some records whilst others perish, the absence of a record, because survival is selective, does not by itself prove that an event never occurred; historians must therefore distinguish the surviving evidence from the larger past which they seek to understand.';
const modelSettings={model:'gpt-6-luna',reasoningEffort:'none'};
class Secrets {value=null;read(){return this.value;}write(value){this.value=structuredClone(value);}remove(){this.value=null;}}
function configured(transport,extra={}){
 const ai=new Intelligence(new Secrets(),transport);ai.save({apiKey:'sk-synthetic-persona-repair-key'});ai.savePreferences({...modelSettings,personaId:'antiquarian',personaExpression:'immersive',manualRequestsPerMinute:120,...extra});return ai;
}
async function waitForRepair(started){let timer;try{await Promise.race([started,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Expected repair transport was not entered')),1000);timer.unref();})]);}finally{clearTimeout(timer);}}
const preview=(extra={})=>({kind:'personaPreview',input:original,personaId:'antiquarian',personaExpression:'immersive',modelSettings,signal:new AbortController().signal,...extra});
function withUsage(output,usage){return Response.json({status:'completed',usage,output:[{type:'message',content:[{type:'output_text',text:typeof output==='string'?output:JSON.stringify(output)}]}]});}
function streamed(output){
 const event=value=>'data: '+JSON.stringify(value)+'\n\n';
 return new Response(new ReadableStream({start(controller){
  controller.enqueue(new TextEncoder().encode(event({type:'response.output_text.delta',delta:output})+event({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]}})));controller.close();
 }}),{headers:{'content-type':'text/event-stream'}});
}

test('eligible Antiquarian preview makes one bounded repair with frozen model/persona settings and combined usage',async()=>{
 const calls=[],usage=[],bytes=[];
 const ai=configured(async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.redirect,'error');
  if(calls.length===1){ai.savePreferences({...modelSettings,personaId:'editor',personaExpression:'subtle',manualRequestsPerMinute:120});return withUsage(original,{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:2},output_tokens_details:{reasoning_tokens:0}});}
  return withUsage({texts:[repaired]},{input_tokens:20,output_tokens:7,input_tokens_details:{cached_tokens:3},output_tokens_details:{reasoning_tokens:0}});
 });
 const output=await ai.generate(preview({onRequest:value=>{bytes.push(value);return {usage:value=>usage.push(value)};}}));
 assert.equal(output,repaired);assert.equal(calls.length,2,'No recursive or repeated repair');
 for(const body of calls){assert.equal(body.model,modelSettings.model);assert.deepEqual(body.reasoning,{effort:'none'});assert.equal(body.store,false);assert.deepEqual(body.tools,[]);assert.equal(body.tool_choice,'none');}
 assert.match(calls[1].instructions,/Browne/);assert.match(calls[1].instructions,/immersive/);assert.ok(calls[1].max_output_tokens<=4096);
 assert.ok(JSON.stringify(calls[1].input).includes(original));
 assert.equal(usage.at(-1).input_tokens,30);assert.equal(usage.at(-1).output_tokens,12);assert.equal(usage.at(-1).input_tokens_details.cached_tokens,5);
 assert.ok(bytes.at(-1)>Buffer.byteLength(calls[0].instructions+original),'Prompt accounting includes the repair request');
 assert.equal(ai.status().personaId,'editor','In-flight persona snapshot does not restore or overwrite newer preferences');
});

test('Antiquarian chat buffers original deltas and emits only the repaired structured answer',async()=>{
 const deltas=[],calls=[];
 const envelope={claims:[{text:original,attribution:'supported',citationIds:['E1']}],title:'Archives and evidence'};
 const ai=configured(async(_url,options)=>{calls.push(JSON.parse(options.body));if(calls.length===1)return streamed(JSON.stringify(envelope));assert.deepEqual(deltas,[],'No unrepaired prose reaches the user');return completedResponse({texts:[repaired]});});
 const output=await ai.generate({kind:'chat',input:JSON.stringify({question:'What can an archive establish?',evidence:[{id:'E1',excerpt:original}]}),instructions:'Return JSON claims with text, attribution and citationIds. Use only E1.',onDelta:delta=>deltas.push(delta)});
 assert.equal(calls.length,2);assert.equal(JSON.parse(output).claims[0].text,repaired);
 assert.deepEqual(JSON.parse(output),{...envelope,claims:[{...envelope.claims[0],text:repaired}]});
 assert.equal(deltas.join(''),output,'Stream consumer and completed validator receive exactly the same answer');
});

test('invalid, unsafe or failed repairs return the original once, without retrying',async()=>{
 for(const response of [()=>completedResponse('{broken'),()=>completedResponse({texts:[repaired+' This proves every event occurred.'],extra:true}),()=>completedResponse({texts:[repaired+' In 1800 this was established.']}),()=>new Response('Synthetic provider failure',{status:502}),()=>{throw new TypeError('synthetic transport failure');}]){
  let calls=0;const ai=configured(async()=>{calls++;return calls===1?completedResponse(original):response();});
  assert.equal(await ai.generate(preview()),original);assert.equal(calls,2);
 }
});

test('v1, other personas, utility work, routine corrections and protected prose never request repair',async()=>{
 const requests=[preview({personaVersion:1}),preview({personaId:'oxford_don'}),{kind:'summary',input:original},{kind:'review',action:'proofread',personaId:'antiquarian',input:JSON.stringify([{id:'a',text:original}])},{kind:'review',action:'refine',personaId:'antiquarian',input:JSON.stringify([{id:'a',text:original}])},preview({input:'The equation is $x^2 = 4$. Preserve this notation.'})];
 for(const request of requests){let calls=0;const output=request.kind==='review'?JSON.stringify({suggestions:[]}):request.input.includes('$')?request.input:original;const ai=configured(async()=>{calls++;return completedResponse(output);});assert.equal(await ai.generate(request),output);assert.equal(calls,1,request.kind);}
});

test('repair respects the manual request limit and falls back without bypassing admission',async()=>{
 let calls=0;const ai=configured(async()=>{calls++;return completedResponse(original);},{manualRequestsPerMinute:1});
 assert.equal(await ai.generate(preview()),original);assert.equal(calls,1);
 await assert.rejects(()=>ai.generate({kind:'validation'}),error=>error.status===429);
});

test('cancellation during repair discards buffered prose and releases the active slot',async()=>{
 let calls=0,started,finish;const secondStarted=new Promise(resolve=>started=resolve),deltas=[],controller=new AbortController();
 const ai=configured(async(_url,options)=>{calls++;if(calls===1)return streamed(JSON.stringify({claims:[{text:original,attribution:'supported',citationIds:['E1']}]}));if(calls===2){started();return new Promise((resolve,reject)=>{finish=resolve;options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});}return completedResponse('OK');});
 const pending=ai.generate({kind:'chat',input:JSON.stringify({question:'What can an archive establish?'}),instructions:'Return claims JSON.',signal:controller.signal,onDelta:delta=>deltas.push(delta)});
 await waitForRepair(secondStarted);controller.abort();await assert.rejects(()=>pending,error=>error.status===409);assert.deepEqual(deltas,[]);
 finish?.(completedResponse({texts:[repaired]}));assert.equal(await ai.generate({kind:'validation'}),'OK');
});

test('a model settings change during repair invalidates the whole answer',async()=>{
 let calls=0,started,finish;const secondStarted=new Promise(resolve=>started=resolve);
 const ai=configured(async()=>{calls++;if(calls===1)return completedResponse(original);started();return new Promise(resolve=>finish=resolve);});
 const pending=ai.generate(preview());await waitForRepair(secondStarted);ai.savePreferences({model:'gpt-5-mini',reasoningEffort:'low'});finish(completedResponse({texts:[repaired]}));
 await assert.rejects(()=>pending,error=>error.status===409);assert.equal(calls,2);
});

test('repair deadline falls back to the completed original and releases the active slot',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0,started,repairSignal;const secondStarted=new Promise(resolve=>started=resolve);
 const ai=configured(async(_url,options)=>{calls++;if(calls===1)return completedResponse(original);if(calls===2){repairSignal=options.signal;started();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}return completedResponse('OK');});
 const pending=ai.generate(preview());await waitForRepair(secondStarted);t.mock.timers.tick(15001);
 assert.equal(await pending,original);assert.equal(repairSignal.aborted,true);assert.equal(calls,2);
 assert.equal(await ai.generate({kind:'validation'}),'OK');
});

test('source-page repair preserves NDJSON structure and emits only canonical final prose',async()=>{
 const rows=[{type:'title',title:'Archives',language:'en'},{type:'block',blockType:'paragraph',basis:'source',text:original,citations:[{startLine:1,endLine:1}]}],initial=rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
 const deltas=[],previews=[];let calls=0,resets=0;
 const ai=configured(async()=>{calls++;return calls===1?streamed(initial):completedResponse({texts:[repaired]});});
 const output=await ai.generate({kind:'sourcePage',input:'{}',personaId:'antiquarian',personaExpression:'immersive',signal:new AbortController().signal,onDelta:delta=>deltas.push(delta),onPreviewDelta:delta=>previews.push(delta),onPreviewReset:()=>resets++});
 assert.equal(calls,2);assert.equal(deltas.join(''),output);assert.deepEqual(previews,[],'Commentary preview never receives canonical NDJSON');assert.equal(resets,0);
 const final=output.trim().split('\n').map(row=>JSON.parse(row));assert.deepEqual(final,[rows[0],{...rows[1],text:repaired}]);
});
