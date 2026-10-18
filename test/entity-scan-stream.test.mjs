import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import path from 'node:path';
import {EntityScanStream} from '../src/server/modules/entity-scan-stream.ts';
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

test('aliases apply to any entity type only on acceptance, including existing entities',()=>{
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
    const result=scans.review('default',page.id,{revision:page.revision,scanId:scan.id,suggestionIds:scan.suggestions.map(s=>s.id),decision:'accepted'});
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
