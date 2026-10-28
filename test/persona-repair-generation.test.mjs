import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Intelligence} from '../src/server/modules/intelligence.ts';
import {completedResponse} from './helpers/providers.ts';

// Capture the harness clock before any test freezes the production timers.
const harnessSetTimeout=setTimeout,harnessClearTimeout=clearTimeout;

const original='An archive preserves some records and loses others. Because survival is selective, the absence of a record does not by itself prove that an event never occurred; historians must distinguish the surviving evidence from the larger past they seek to understand.';
const repaired='Although an archive preserves some records whilst others perish, the absence of a record, because survival is selective, does not by itself prove that an event never occurred; historians must therefore distinguish the surviving evidence from the larger past which they seek to understand.';
const modelSettings={model:'gpt-6-luna',reasoningEffort:'none'};
class Secrets {value=null;read(){return this.value;}write(value){this.value=structuredClone(value);}remove(){this.value=null;}}
function configured(transport,extra={}){
 const ai=new Intelligence(new Secrets(),transport);ai.save({apiKey:'sk-synthetic-persona-repair-key'});ai.savePreferences({...modelSettings,personaId:'antiquarian',personaExpression:'immersive',manualRequestsPerMinute:120,...extra});return ai;
}
async function waitForRepair(started,pending,timeoutMs=1000){
 let timer;
 try{
  await Promise.race([
   started,
   pending.then(()=>{throw new Error('Generation settled before repair transport was entered');},cause=>{throw new Error('Generation rejected before repair transport was entered',{cause});}),
   new Promise((_resolve,reject)=>{timer=harnessSetTimeout(()=>reject(new Error('Expected repair transport was not entered within '+timeoutMs+'ms')),timeoutMs);})
  ]);
 }finally{harnessClearTimeout(timer);}
}
async function duringRepair(ai,request,started,release,check,timeoutMs=1000){
 const controller=new AbortController(),pending=ai.generate({...request,signal:controller.signal});
 try{await waitForRepair(started,pending,timeoutMs);await check(pending,controller);}
 finally{
  // Release even an abort-insensitive fixture, then drain before timers reset or another test starts.
  controller.abort();release();await pending.catch(()=>{});
 }
}
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
 let calls=0,started,finish;const secondStarted=new Promise(resolve=>started=resolve),deltas=[];
 const ai=configured(async(_url,options)=>{calls++;if(calls===1)return streamed(JSON.stringify({claims:[{text:original,attribution:'supported',citationIds:['E1']}]}));if(calls===2){started();return new Promise((resolve,reject)=>{finish=resolve;options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});}return completedResponse('OK');});
 await duringRepair(ai,{kind:'chat',input:JSON.stringify({question:'What can an archive establish?'}),instructions:'Return claims JSON.',onDelta:delta=>deltas.push(delta)},secondStarted,()=>finish?.(completedResponse({texts:[repaired]})),async(pending,controller)=>{
  controller.abort();await assert.rejects(()=>pending,error=>error.status===409);assert.deepEqual(deltas,[]);
 });
 assert.equal(await ai.generate({kind:'validation'}),'OK');
});

test('a model settings change during repair invalidates the whole answer',async()=>{
 let calls=0,started,finish;const secondStarted=new Promise(resolve=>started=resolve);
 const ai=configured(async()=>{calls++;if(calls===1)return completedResponse(original);started();return new Promise(resolve=>finish=resolve);});
 await duringRepair(ai,preview(),secondStarted,()=>finish?.(completedResponse({texts:[repaired]})),async pending=>{
  ai.savePreferences({model:'gpt-5-mini',reasoningEffort:'low'});finish(completedResponse({texts:[repaired]}));
  await assert.rejects(()=>pending,error=>error.status===409);assert.equal(calls,2);
 });
});

test('repair deadline falls back to the completed original and releases the active slot',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0,started,finish,repairSignal;const secondStarted=new Promise(resolve=>started=resolve);
 const ai=configured(async(_url,options)=>{calls++;if(calls===1)return completedResponse(original);if(calls===2){repairSignal=options.signal;started();return new Promise((resolve,reject)=>{finish=resolve;options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});}return completedResponse('OK');});
 await duringRepair(ai,preview(),secondStarted,()=>finish?.(completedResponse({texts:[repaired]})),async pending=>{
  t.mock.timers.tick(15001);
  assert.equal(await pending,original);assert.equal(repairSignal.aborted,true);assert.equal(calls,2);
 });
 assert.equal(await ai.generate({kind:'validation'}),'OK');
});

// Controlled mutations of the first provider call exercise the same lifecycle as the deadline test.
for(const mode of ['rejected','settled','never entered']){
 test('repair harness fails and drains when generation '+mode+' with a frozen clock',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0,finish,signal,checks=0;
  const ai=configured(async(_url,options)=>{
   calls++;
   if(calls>1)return completedResponse('OK');
   signal=options.signal;
   if(mode==='rejected')throw new TypeError('Synthetic initial provider rejection');
   if(mode==='settled')return completedResponse('OK');
   // Deliberately ignore abort so cleanup must also release the fixture.
   return new Promise(resolve=>finish=resolve);
  });
  await assert.rejects(
   duringRepair(ai,preview(),new Promise(()=>{}),()=>finish?.(completedResponse(original)),()=>{checks++;},25),
   error=>{
    if(mode==='rejected'){assert.match(error.message,/Generation rejected before repair transport was entered/);assert.equal(error.cause.status,502);}
    else if(mode==='settled')assert.match(error.message,/Generation settled before repair transport was entered/);
    else assert.match(error.message,/Expected repair transport was not entered within 25ms/);
    return true;
   }
  );
  assert.equal(checks,0);assert.equal(calls,1);
  if(mode==='never entered')assert.equal(signal.aborted,true);
  assert.equal(await ai.generate({kind:'validation'}),'OK','Cleanup releases the active slot before the next request');
 });
}

test('repair harness aborts, releases and drains after an assertion fails inside repair',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0,started,finish,repairSignal;const secondStarted=new Promise(resolve=>started=resolve);
 const ai=configured(async(_url,options)=>{
  calls++;if(calls===1)return completedResponse(original);
  if(calls>2)return completedResponse('OK');
  repairSignal=options.signal;started();
  return new Promise(resolve=>finish=resolve); // Cleanup must release this abort-insensitive repair.
 });
 const failure=new Error('Synthetic assertion failure inside repair');
 await assert.rejects(duringRepair(ai,preview(),secondStarted,()=>finish?.(completedResponse({texts:[repaired]})),()=>{throw failure;}),error=>error===failure);
 assert.equal(repairSignal.aborted,true);assert.equal(calls,2);
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

test('two-call repair debug recovery preserves aggregate usage and cost when optional cache-write usage is absent',async()=>{
 const {openDatabase}=await import('../src/server/database.ts'),{Store}=await import('../src/server/store.ts'),{AIActivityLog}=await import('../src/server/modules/ai-activity.ts');
 const db=openDatabase(':memory:'),store=new Store(db),log=new AIActivityLog(store);log.saveDebugSettings({enabled:true});
 let calls=0;const ai=configured(async()=>{calls++;return withUsage(calls===1?original:{texts:[repaired]},{input_tokens:calls===1?10:20,output_tokens:calls===1?5:7,input_tokens_details:{cached_tokens:calls===1?2:3},output_tokens_details:{reasoning_tokens:0}});});
 try{
  const id=log.start('persona_preview',ai.selection());
  assert.equal(await ai.generate(preview({onRequest:bytes=>log.request(id,bytes,null)})),repaired);log.finish(id,'completed',200);
  const row=()=>store.get('SELECT input_tokens,output_tokens,cached_input_tokens,cache_write_tokens,reasoning_tokens,estimated_cost FROM ai_activity WHERE id=?',id);
  const before=row();assert.equal(calls,2);assert.equal(before.input_tokens,30);assert.equal(before.output_tokens,12);assert.equal(before.cached_input_tokens,5);assert.equal(before.cache_write_tokens,null,'An omitted counter remains unknown');assert.ok(before.estimated_cost>0);
  const debug=JSON.parse(store.get('SELECT response FROM ai_activity_debug WHERE activity_id=?',id).response);assert.equal(debug.usage.input_tokens,30);assert.equal(debug.usage.output_tokens,12);
  new AIActivityLog(store);assert.deepEqual(row(),before,'Restart preserves logical operation accounting and its matching cost');
 }finally{db.close();}
});

test('missing or interrupted repair usage cannot become first-request-only logical totals on restart',async()=>{
 const {openDatabase}=await import('../src/server/database.ts'),{Store}=await import('../src/server/store.ts'),{AIActivityLog}=await import('../src/server/modules/ai-activity.ts');
 for(const second of [()=>withUsage({texts:[repaired]},undefined),()=>{throw new TypeError('synthetic interrupted paid repair');}]){
  const db=openDatabase(':memory:'),store=new Store(db),log=new AIActivityLog(store);log.saveDebugSettings({enabled:true});let calls=0;
  const ai=configured(async()=>{calls++;return calls===1?withUsage(original,{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}):second();});
  try{
   const id=log.start('persona_preview',ai.selection());await ai.generate(preview({onRequest:bytes=>log.request(id,bytes,null)}));log.finish(id,'completed',200);
   const row=()=>store.get('SELECT input_tokens,output_tokens,cached_input_tokens,cache_write_tokens,reasoning_tokens,estimated_cost FROM ai_activity WHERE id=?',id);
   const before=row();assert.equal(calls,2);for(const count of Object.values(before))assert.equal(count,null,'Unknown aggregate usage/cost is not zero or a partial count');
   new AIActivityLog(store);assert.deepEqual(row(),before);
  }finally{db.close();}
 }
});

test('legacy one-call debug recovery fills missing counts without overwriting known operation totals',async()=>{
 const {openDatabase}=await import('../src/server/database.ts'),{Store}=await import('../src/server/store.ts'),{AIActivityLog}=await import('../src/server/modules/ai-activity.ts');
 const db=openDatabase(':memory:'),store=new Store(db),log=new AIActivityLog(store);log.saveDebugSettings({enabled:true});
 try{
  const id=log.start('persona_preview',modelSettings),trace=log.request(id,100,null);
  trace.response({status:'completed',usage:{input_tokens:10,output_tokens:5,input_tokens_details:{cached_tokens:2,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}});
  log.finish(id,'completed',200);new AIActivityLog(store);
  let row=store.get('SELECT input_tokens,output_tokens,cached_input_tokens,cache_write_tokens,reasoning_tokens FROM ai_activity WHERE id=?',id);assert.deepEqual({...row},{input_tokens:10,output_tokens:5,cached_input_tokens:2,cache_write_tokens:0,reasoning_tokens:0});
  store.run('UPDATE ai_activity SET input_tokens=30,output_tokens=12,cache_write_tokens=NULL WHERE id=?',id);new AIActivityLog(store);
  row=store.get('SELECT input_tokens,output_tokens,cache_write_tokens FROM ai_activity WHERE id=?',id);assert.deepEqual({...row},{input_tokens:30,output_tokens:12,cache_write_tokens:0});
 }finally{db.close();}
});
