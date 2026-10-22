import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import path from 'node:path';
import {EntityScanStream,EntityScanBatchReady} from '../src/server/modules/entity-scan-stream.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
import {EntityScans} from '../src/server/modules/entity-scan.ts';
import {scanEntities} from '../src/client/api.ts';
const candidate=(name,type='person',extra={})=>({name,type,aliases:[],subtypes:[],description:'Named in the note',evidence:name,reason:'Named entity',existingId:null,...extra});

test('partial JSON parser emits complete objects across arbitrary chunks and escaped strings',()=>{
  const parser=new EntityScanStream(),suggestions=[candidate('Alice "{[x]}"'),candidate('Bob\\Jones')];
  const json=JSON.stringify({suggestions});let latest,counts=[];
  for(const char of json){const result=parser.feed(char);if(result){latest=result;counts.push(result.length);}}
  assert.deepEqual(counts,[1,2]);assert.deepEqual(latest,suggestions);
});

test('25 suggestions remain valid and the 26th stops generation successfully without waiting for provider completion',async()=>{
  const values=Array.from({length:26},(_,i)=>candidate(`Person ${i}`));
  assert.equal(new EntityScanStream().feed(JSON.stringify({suggestions:values.slice(0,25)})).length,25);
  assert.throws(()=>new EntityScanStream().feed(JSON.stringify({suggestions:values})),error=>error instanceof EntityScanBatchReady&&JSON.parse(error.output).suggestions.length===26);
  let secret=null,cancelled=false,requestSignal;
  const errors=[],events=[];
  const ai=new Intelligence({read:()=>secret,write:value=>{secret=value;},remove(){}},async(_url,options)=>{
    requestSignal=options.signal;
    return new Response(new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify({suggestions:values})})+'\n\n'));
      // Intentionally never close or send response.completed.
    },cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/event-stream'}});
  });ai.save({apiKey:'sk-test-batched-entity-secret'});
  const parser=new EntityScanStream();
  const output=await ai.generate({kind:'entityScan',input:'{}',onDelta:delta=>{parser.feed(delta);},onRequest:()=>({request(){},headers(){},body(){},response(){},error:message=>errors.push(message),event:(type,data)=>events.push({type,data})})});
  assert.equal(JSON.parse(output).suggestions.length,26);
  assert.equal(cancelled,true);assert.equal(requestSignal.aborted,true);
  assert.deepEqual(errors,[]);assert.ok(events.some(event=>event.data.category==='batch_checkpoint'));
});

test('saved checkpoints resume remaining text across three batches and preserve bulk review decisions',()=>{
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),enrichments=new AIEnrichments(store,pages),scans=new EntityScans(store,pages,knowledge,enrichments);
  const preferences={model:'gpt-6-luna',reasoningEffort:'none'};
  try {
    const names=Array.from({length:60},(_,i)=>`Person${String(i).padStart(2,'0')}`);
    let page=pages.create('default',{title:'Many names'});
    page=pages.update('default',page.id,{...page,blocks:[{id:'body',type:'paragraph',content:[{text:names.join(' met ')}]}]});
    let scan=scans.save('default',page,JSON.stringify({suggestions:names.slice(0,26).map(name=>candidate(name))}),preferences);
    assert.equal(scan.suggestions.length,25);assert.equal(scan.batchCount,25);assert.ok(scan.continuation);
    const firstIds=scan.suggestions.map(item=>item.id),firstToken=scan.continuation.token;
    let result=scans.review('default',page.id,{revision:page.revision,scanId:scan.id,suggestionIds:firstIds,decision:'accepted'});
    page=result.page;scan=result.scan;
    assert.equal(page.blocks[0].content.filter(item=>item.entityId).length,25,'Bulk acceptance supports all 25');
    assert.throws(()=>scans.continuation('default',page,scan.id,firstToken),/changed/);
    // A new service instance demonstrates persistence across reloads/restarts.
    const resumed=new EntityScans(store,pages,knowledge,enrichments);
    const previous=resumed.continuation('default',page,scan.id,scan.continuation.token);
    const input=JSON.parse(resumed.input('default',page,previous));
    assert.ok(input.untrusted_note.bodyTextRuns.some(run=>run.text.includes(names[25])));
    assert.ok(input.untrusted_note.bodyTextRuns.every(run=>!run.text.includes(names[0])),'Completed text is not scanned again');
    assert.ok(input.continuation.excluded.some(item=>item.name===names[0]));
    scan=resumed.save('default',page,JSON.stringify({suggestions:names.slice(25,51).map(name=>candidate(name))}),preferences,true,previous);
    assert.equal(scan.suggestions.length,50);assert.deepEqual(scan.suggestions.slice(0,25).map(item=>item.id),firstIds);
    assert.ok(scan.suggestions.slice(0,25).every(item=>item.status==='accepted'));
    assert.throws(()=>resumed.save('default',page,JSON.stringify({suggestions:[]}),preferences,true,previous),/changed/,'An old continuation cannot overwrite a newer batch');
    const rejectedIds=scan.suggestions.slice(25).map(item=>item.id);
    result=resumed.review('default',page.id,{revision:page.revision,scanId:scan.id,suggestionIds:rejectedIds,decision:'rejected'});scan=result.scan;
    const finalPrevious=resumed.continuation('default',page,scan.id,scan.continuation.token);
    const finalInput=JSON.parse(resumed.input('default',page,finalPrevious));
    assert.ok(finalInput.untrusted_note.bodyTextRuns.every(run=>!run.text.includes(names[49])));
    assert.ok(finalInput.continuation.excluded.some(item=>item.name===names[49]),'Rejected identities stay excluded');
    // A provider repeats an earlier identity at a later occurrence: server-side dedup still wins.
    scan=resumed.save('default',page,JSON.stringify({suggestions:[...names.slice(50).map(name=>candidate(name)),candidate(names[49])]}),preferences,true,finalPrevious);
    assert.equal(scan.suggestions.length,60);assert.equal(scan.batchCount,10);assert.equal(scan.continuation,undefined);
    assert.equal(new Set(scan.suggestions.map(item=>item.name)).size,60);
    assert.ok(scan.suggestions.slice(25,50).every(item=>item.status==='rejected'));
    const changed=pages.update('default',page.id,{...page,title:'Edited'});
    assert.throws(()=>resumed.continuation('default',changed,finalPrevious.id,finalPrevious.continuation.token),/changed/);
  }finally{db.close();}
});

test('HTTP continuation resumes a saved batch, rejects stale tokens before calling the provider, and caches the combined result',async()=>{
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
  let secret=null,calls=0,inputs=[];
  const names=Array.from({length:30},(_,i)=>`Name${String(i).padStart(2,'0')}`);
  const ai=new Intelligence({read:()=>secret,write:value=>{secret=value;},remove(){}},async(_url,options)=>{
    calls++;
    const input=JSON.parse(JSON.parse(options.body).input[0].content[0].text);inputs.push(input);
    const runs=input.untrusted_note.bodyTextRuns;
    const suggestions=names.filter(name=>runs.some(run=>run.text.includes(name))).slice(0,26).map(name=>{
      const run=runs.find(run=>run.text.includes(name));return candidate(name,'person',{runId:run.runId,evidenceStart:run.text.indexOf(name)});
    });
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({suggestions})}]}]});
  });ai.save({apiKey:'sk-test-http-batch-secret'});
  let page=pages.create('default',{title:'Batches'});
  page=pages.update('default',page.id,{...page,blocks:[{id:'body',type:'paragraph',content:[{text:names.join(' met ')}]}]});
  const server=createApp(store,path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}/api/pages/${page.id}/entity-scan`;
  const request=body=>fetch(url,{method:'POST',headers:{'X-Noema-Request':'1','Content-Type':'application/json','X-Vault-Id':'default'},body:JSON.stringify({revision:page.revision,...body})});
  try {
    let response=await request({});assert.equal(response.status,200);
    const first=await response.json();assert.equal(first.suggestions.length,25);assert.ok(first.continuation);
    const continuation={continueScanId:first.id,continuationToken:first.continuation.token};
    response=await request(continuation);assert.equal(response.status,200);
    const second=await response.json();assert.equal(second.suggestions.length,30);assert.equal(second.continuation,undefined);
    assert.equal(calls,2);assert.ok(inputs[1].untrusted_note.bodyTextRuns.every(run=>!run.text.includes(names[24])));
    assert.equal((await request(continuation)).status,409);assert.equal(calls,2);
    response=await request({});assert.equal((await response.json()).suggestions.length,30);assert.equal(calls,2);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
});

test('aliases apply to any entity type only with explicit acceptance opt-in',()=>{
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),enrichments=new AIEnrichments(store,pages),scans=new EntityScans(store,pages,knowledge,enrichments);
  try {
    const organization=knowledge.create('default',{name:'World Health Organization',type:'organization'});
    let page=pages.create('default',{title:'Names'});
    page=pages.update('default',page.id,{...page,blocks:[{id:'b',type:'paragraph',checked:false,content:[{text:'Charlemagne, Quebec and the World Health Organization (WHO).'}]}]});
    const preferences={model:'gpt-5-mini',reasoningEffort:'low'};
    const output=JSON.stringify({suggestions:[candidate('Charlemagne, Quebec','place',{evidence:'Charlemagne',aliases:['Charlemagne','Invented place']}),candidate(organization.name,'organization',{evidence:'WHO',existingId:organization.id,aliases:['WHO']})]});
    const preview=scans.save('default',page,output,preferences,false);
    assert.deepEqual(preview.suggestions[0].aliases,['Charlemagne']);
    assert.equal(enrichments.list('default',page.id).some(e=>e.kind==='entity_scan'),false);
    assert.deepEqual(knowledge.require('default',organization.id).aliases,[]);
    let scan=scans.save('default',page,output,preferences);
    assert.equal(knowledge.list('default').some(e=>e.name==='Charlemagne, Quebec'),false);
    const result=scans.review('default',page.id,{revision:page.revision,scanId:scan.id,suggestionIds:scan.suggestions.map(s=>s.id),decision:'accepted',edits:scan.suggestions.map(s=>({...s,saveAliases:true}))});
    assert.deepEqual(result.entities.find(e=>e.name==='Charlemagne, Quebec').aliases,['Charlemagne']);
    assert.deepEqual(knowledge.require('default',organization.id).aliases,['WHO']);
    assert.equal(result.page.blocks[0].content.find(s=>s.entityId===organization.id).mentionText,'WHO');
    const connected=scans.save('default',result.page,JSON.stringify({suggestions:[candidate(organization.name,'organization',{existingId:organization.id,evidence:'WHO',runId:'invalid-context-only-run',evidenceStart:0})]}),preferences);
    assert.equal(connected.suggestions.length,0,'Already connected entities never need new tagging evidence');
    let overlapping=pages.create('default',{title:'Atomic aliases'});
    overlapping=pages.update('default',overlapping.id,{...overlapping,blocks:[{id:'b2',type:'paragraph',checked:false,content:[{text:'WHO, the World Health Organization.'}]}]});
    const overlapScan=scans.save('default',overlapping,JSON.stringify({suggestions:[
      candidate(organization.name,'organization',{existingId:organization.id,evidence:'WHO',aliases:['World']}),
      candidate('Another identity','person',{evidence:'WHO'}),
    ]}),preferences);
    assert.throws(()=>scans.review('default',overlapping.id,{revision:overlapping.revision,scanId:overlapScan.id,suggestionIds:overlapScan.suggestions.map(s=>s.id),decision:'accepted'}),/overlap/);
    assert.deepEqual(knowledge.require('default',organization.id).aliases,['WHO'],'Failed bulk review rolls back alias additions too');
  }finally{db.close();}
});

test('stream delivers validated results before provider completion, persists only final output and supports cache',async()=>{
  const db=openDatabase(':memory:'),store=new Store(db);
  let provider,requested;
  const started=new Promise(resolve=>requested=resolve);
  const secrets={read:()=>null,write(){},remove(){}};
  // Match the in-memory credential storage contract used by the integration tests.
  let secret=null;secrets.read=()=>secret;secrets.write=value=>{secret=value;};
  const ai=new Intelligence(secrets,async(_url,options)=>{
    assert.equal(JSON.parse(options.body).stream,true);
    const response=new Response(new ReadableStream({start(controller){provider=controller;requested();}}),{headers:{'Content-Type':'text/event-stream'}});
    return response;
  });ai.save({apiKey:'sk-test-entity-stream-secret'});
  const server=createApp(store,path.resolve('dist/client'),ai);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/`;
  const headers={'X-Noema-Request':'1','Content-Type':'application/json','X-Vault-Id':'default',Accept:'application/x-ndjson'};
  let page=new Pages(store,new Knowledge(store)).create('default',{title:'Stream'});
  const pages=new Pages(store,new Knowledge(store));page=pages.update('default',page.id,{...page,blocks:[{id:'b',type:'paragraph',checked:false,content:[{text:'Alice met Bob.'}]}]});
  const first=candidate('Alice'),second=candidate('Bob'),prefix='{"suggestions":['+JSON.stringify(first),suffix=','+JSON.stringify(second)+']}';
  const emit=event=>provider.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));
  const originalFetch=globalThis.fetch;let partial,notify;
  const progress=new Promise(resolve=>notify=resolve);
  globalThis.fetch=(url,options)=>originalFetch(typeof url==='string'&&url.startsWith('/api/')?base+url.slice(5):url,options);
  try {
    const pending=scanEntities('default',page.id,page.revision,scan=>{partial=scan;notify();});
    await started;
    emit({type:'response.output_text.delta',item_id:'answer',output_index:0,content_index:0,delta:prefix});
    await Promise.race([progress,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('No progressive results received')),3000);timer.unref();})]);
    assert.deepEqual(partial.suggestions.map(s=>s.name),['Alice']);
    assert.equal(new AIEnrichments(store,pages).list('default',page.id).some(e=>e.kind==='entity_scan'),false);
    emit({type:'response.output_text.delta',item_id:'answer',output_index:0,content_index:0,delta:suffix});
    emit({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:prefix+suffix}]}]}});provider.close();
    const scan=await pending;assert.equal(scan.suggestions.length,2);
    assert.equal(new AIEnrichments(store,pages).list('default',page.id).find(e=>e.kind==='entity_scan').data.scan.id,scan.id);
    const cached=await scanEntities('default',page.id,page.revision);assert.equal(cached.id,scan.id);
  }finally{globalThis.fetch=originalFetch;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
});

test('client rejects interrupted and error streams after showing provisional rows',async()=>{
  const originalFetch=globalThis.fetch;
  try {
    for(const tail of ['',JSON.stringify({type:'error',message:'Note changed. Scan again.'})+'\n']) {
      globalThis.fetch=async()=>new Response(JSON.stringify({type:'progress',scan:{id:'preview',revision:1,suggestions:[candidate('Alice')]}})+'\n'+tail);
      let progress=0;
      await assert.rejects(scanEntities('default','page',1,()=>progress++),/connection ended|Note changed/);
      assert.equal(progress,1);
    }
  }finally{globalThis.fetch=originalFetch;}
});
