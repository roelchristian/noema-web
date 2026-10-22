import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { openDatabase } from '../src/server/database.ts';
import { Store } from '../src/server/store.ts';
import { createApp } from '../src/server/http.ts';
import { Intelligence } from '../src/server/modules/intelligence.ts';
import { mentionEvidence } from '../src/shared/entity-scan.ts';

import {completedResponse as completed} from './helpers/providers.ts';
const candidate = (name,type='person',extra={}) => ({name,type,subtypes:[],description:'Mentioned in this note',evidence:name,reason:'Named in the note',existingId:null,...extra});
test('entity scan reviews are explicit, persistent, scoped and revision safe', async()=>{
  const db=openDatabase(':memory:');
  let output, providerBody, finish, calls=0;
  const secrets={value:null,read(){return this.value;},write(v){this.value=v;},remove(){this.value=null;}};
  const ai=new Intelligence(secrets,async(_url,options)=>{
    calls++;providerBody=JSON.parse(options.body);
    if(finish===true)return new Promise(resolve=>{finish=resolve;});
    return completed(output);
  });
  ai.save({apiKey:'sk-test-entity-scanning-secret'});
  const server=createApp(new Store(db),path.resolve('dist/client'),ai);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/`;
  async function call(route,method='GET',body,expected=200,vault='default',headers={}){
    const response=await fetch(base+route,{method,headers:{'X-Noema-Request':'1','Content-Type':'application/json','X-Vault-Id':vault,...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
  }
  try{
    const baseline=(await call('entities')).length;
    const alice=await call('entities','POST',{name:'Alice',type:'person',subtypes:['person:scientist']},201);
    await call('entity-schema/subtypes','POST',{type:'place',name:'Research station'},201);
    const schema=await call('entity-schema');
    let page=await call('pages','POST',{title:'Meeting'},201);
    page=await call(`pages/${page.id}`,'PUT',{...page,blocks:[{id:'body',type:'paragraph',checked:false,content:[{text:'Alice met '},{text:'Bo',bold:true},{text:'b in Paris.',italic:true}]}]});
    const route=`pages/${page.id}`;
    output=JSON.stringify({suggestions:[candidate('Alice'),candidate('Bob'),candidate('Paris','place',{subtypes:[schema.subtypes.find(s=>s.name==='Research station').id]}),candidate('Ghost')]});
    let scan=await call(route+'/entity-scan','POST',{revision:page.revision});
    assert.equal(scan.suggestions.length,3,'Unsupported evidence is filtered');
    assert.equal(scan.suggestions[0].existingId,alice.id,'Exact existing names deduplicate');
    assert.equal((await call('entities')).length,baseline+1,'Scan creates no entities');
    assert.deepEqual((await call(route)).blocks,page.blocks,'Scan leaves note unchanged');
    assert.ok(providerBody.instructions.includes('never instructions'));
    const prompt=JSON.parse(providerBody.input[0].content[0].text);
    assert.ok(prompt.schema.subtypes.some(s=>s.name==='Research station'));
    assert.ok(prompt.existingEntities.some(e=>e.id===alice.id));
    async function review(index,decision,status=200,extra={}){
      return call(route+'/entity-review','POST',{scanId:scan.id,suggestionId:scan.suggestions[index].id,revision:page.revision,decision,...extra},status);
    }
    const dirtyRevision=()=>db.prepare('SELECT p.revision FROM page_index_dirty d JOIN pages p ON p.id=d.page_id WHERE d.page_id=?').get(page.id)?.revision;
    assert.equal(dirtyRevision(),page.revision);
    let result=await review(0,'accepted');page=result.page;scan=result.scan;
    assert.equal(dirtyRevision(),page.revision,'Acceptance retains durable indexing work for the new revision');
    assert.equal(result.entities.length,baseline+1);assert.equal(page.blocks[0].content[0].entityId,alice.id);
    await review(0,'accepted',400);
    result=await review(1,'accepted');page=result.page;scan=result.scan;
    const bob=result.entities.find(e=>e.name==='Bob');assert.ok(bob);
    assert.ok(page.blocks[0].content.some(s=>s.entityId===bob.id));
    assert.ok(page.blocks[0].content.some(s=>s.text===' in Paris.'&&s.italic),'Surrounding formatting is retained');
    const beforeReject=page, beforeRejectRevision=dirtyRevision();
    result=await review(2,'rejected');scan=result.scan;
    assert.equal(dirtyRevision(),beforeRejectRevision,'Rejecting a suggestion leaves indexing unchanged');
    assert.deepEqual(result.page,beforeReject);assert.equal(result.entities.length,baseline+2);
    const persisted=(await call(route+'/enrichments')).find(e=>e.kind==='entity_scan').data.scan;
    assert.deepEqual(persisted,scan);assert.equal(calls,1,'Reviews never call AI');
    assert.equal((await call('intelligence/activity')).items[0].action,'entity_scan');
    const other=await call('vaults','POST',{name:'Other'},201);
    await call(route+'/entity-review','POST',{revision:page.revision},404,other.id);
    await call('vaults/default/lock','POST',{passphrase:'test-lock'});
    await call(route+'/entity-scan','POST',{revision:page.revision},423);
    await call('vaults/default/unlock','POST',{passphrase:'test-lock'});
    await call(route+'/entity-scan','POST',{revision:page.revision},403,'default',{'X-Noema-Request':''});
    assert.deepEqual(await call(route+'/entity-scan','POST',{revision:page.revision}),scan,'An unchanged scan reuses saved evidence without a provider call');
    assert.equal(calls,1);
    page=await call(route,'PUT',{...page,blocks:[...page.blocks,{id:'extra',type:'paragraph',content:[{text:'New evidence expands this meeting account.'}]}]});
    output=JSON.stringify({suggestions:[candidate('Paris','invalid')]});
    await call(route+'/entity-scan','POST',{revision:page.revision},502);
    assert.deepEqual((await call(route+'/enrichments')).find(e=>e.kind==='entity_scan').data.scan,scan,'Invalid output retains prior scan');
    output=JSON.stringify({suggestions:[candidate('Paris','place')]});
    scan=await call(route+'/entity-scan','POST',{revision:page.revision});
    await review(0,'accepted',409,{scanId:persisted.id});
    page=await call(route,'PUT',{...page,title:'Changed'});
    await review(0,'accepted',409);
    finish=true;
    const pending=call(route+'/entity-scan','POST',{revision:page.revision},409);
    while(typeof finish!=='function')await new Promise(resolve=>setTimeout(resolve,5));
    page=await call(route,'PUT',{...page,title:'Changed while scanning'});
    finish(completed(JSON.stringify({suggestions:[]})));await pending;
    assert.equal((await call('entities')).length,baseline+2);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
});

test('evidence replacement handles tables, formatting boundaries and existing mentions',()=>{
  const page={blocks:[{type:'paragraph',content:[{entityId:'already'},{text:'unrelated'}]},{type:'table',rows:[[[{text:'New ',bold:true},{text:'York',italic:true},{text:' City'}]]],content:[]}]};
  const result=mentionEvidence(page,'New York','ny');
  assert.deepEqual(result.blocks[1].rows[0][0],[{entityId:'ny', mentionText: 'New York'},{text:' City'}]);
  assert.deepEqual(result.blocks[0],{...page.blocks[0],rows:undefined});
  assert.equal(mentionEvidence(page,'unrelatedNew','none'),null);
  assert.equal(mentionEvidence(page,'','none'),null);
});

test('bulk entity review is atomic, advances revision once and rejects invalid selections', async()=>{
  const {EntityScans}=await import('../src/server/modules/entity-scan.ts');
  const {Knowledge}=await import('../src/server/modules/knowledge.ts');
  const {Pages}=await import('../src/server/modules/pages.ts');
  const {AIEnrichments}=await import('../src/server/modules/ai-enrichments.ts');
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
  const scans=new EntityScans(store,pages,knowledge,new AIEnrichments(store,pages));
  const preferences={model:'gpt-5-mini',reasoningEffort:'low'};
  const baseline=knowledge.list('default').length;
  let page=pages.create('default',{title:'Bulk review'});
  page=pages.update('default',page.id,{...page,blocks:[{id:'b',type:'paragraph',checked:false,content:[{text:'Alice and Bob visited New York.'}]}]});
  try {
    let scan=scans.save('default',page,JSON.stringify({suggestions:[candidate('Alice'),candidate('Bob'),candidate('New York','place')]}),preferences);
    const review=(ids,decision,revision=page.revision)=>scans.review('default',page.id,{scanId:scan.id,suggestionIds:ids,decision,revision});
    assert.throws(()=>review([],'accepted'),e=>e.status===400);
    assert.throws(()=>review([scan.suggestions[0].id,scan.suggestions[0].id],'accepted'),e=>e.status===400);
    assert.throws(()=>review([scan.suggestions[0].id,'missing'],'accepted'),e=>e.status===400);
    const accepted=review(scan.suggestions.slice(0,2).map(s=>s.id),'accepted');
    assert.equal(accepted.page.revision,page.revision+1,'Bulk acceptance advances revision once');
    assert.equal(accepted.entities.length,baseline+2);
    assert.equal(accepted.scan.suggestions.filter(s=>s.status==='accepted').length,2);
    assert.equal(accepted.page.blocks[0].content.filter(s=>s.entityId).length,2);
    page=accepted.page;scan=accepted.scan;
    const rejected=review([scan.suggestions[2].id],'rejected');
    assert.deepEqual(rejected.page,page);
    assert.equal(rejected.entities.length,baseline+2);
    scan=scans.save('default',page,JSON.stringify({suggestions:[candidate('New York','place'),candidate('York','place')]}),preferences);
    assert.throws(()=>review(scan.suggestions.map(s=>s.id),'accepted'),e=>e.status===409&&e.message.includes('overlap'));
    assert.equal(knowledge.list('default').length,baseline+2,'Failed batch rolls back newly created entities');
    assert.deepEqual(pages.get('default',page.id),page,'Failed batch leaves page unchanged');
    assert.ok(new AIEnrichments(store,pages).list('default',page.id).find(e=>e.kind==='entity_scan').data.scan.suggestions.every(s=>s.status==='pending'));
    const rejectedAll=review(scan.suggestions.map(s=>s.id),'rejected');
    assert.ok(rejectedAll.scan.suggestions.every(s=>s.status==='rejected'));
    assert.deepEqual(rejectedAll.page,page);
  }finally{db.close();}
});

test('review edits support renamed entities, category/subtype changes and matching existing entities', async()=>{
  const {EntityScans}=await import('../src/server/modules/entity-scan.ts');
  const {Knowledge}=await import('../src/server/modules/knowledge.ts');
  const {Pages}=await import('../src/server/modules/pages.ts');
  const {AIEnrichments}=await import('../src/server/modules/ai-enrichments.ts');
  const {Vaults}=await import('../src/server/modules/vaults.ts');
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
  const scans=new EntityScans(store,pages,knowledge,new AIEnrichments(store,pages));
  const preferences={model:'gpt-5-mini',reasoningEffort:'low'};
  const existing=knowledge.create('default',{name:'Robert Smith',type:'person',subtypes:['person:scientist'],description:'Saved description'});
  const foreignVault=new Vaults(store).create({name:'Foreign'});
  const foreign=knowledge.create(foreignVault.id,{name:'Other vault entity',type:'place'});
  knowledge.addSubtype('default',{type:'organization',name:'Research group'});
  const custom=knowledge.schema('default').subtypes.find(s=>s.name==='Research group').id;
  let page=pages.create('default',{title:'Editable review'});
  page=pages.update('default',page.id,{...page,blocks:[{id:'b',type:'paragraph',checked:false,content:[{text:'Atlas and Bob met Alice.'}]}]});
  try {
    let scan=scans.save('default',page,JSON.stringify({suggestions:[candidate('Atlas','place'),candidate('Bob'),candidate('Alice')]}),preferences);
    const baseline=knowledge.list('default').length;
    const atlas=scan.suggestions[0].id,bob=scan.suggestions[1].id;
    const edit=(id,name,type='person',subtypes=[],existingId=null)=>({id,name,type,subtypes,existingId});
    const review=(ids,edits,decision='accepted')=>scans.review('default',page.id,{scanId:scan.id,suggestionIds:ids,decision,revision:page.revision,edits});
    assert.throws(()=>review([atlas],[edit(atlas,' ','organization')]),e=>e.status===400);
    assert.throws(()=>review([atlas],[edit(atlas,'Atlas','unknown')]),e=>e.status===400);
    assert.throws(()=>review([atlas],[edit(atlas,'Atlas','organization',['person:scientist'])]),e=>e.status===400);
    assert.throws(()=>review([atlas],[edit(atlas,'Atlas','organization',['missing'])]),e=>e.status===400);
    assert.throws(()=>review([atlas],[edit(bob,'Bob')]),e=>e.status===400);
    assert.throws(()=>review([atlas],[edit(atlas,'Atlas'),edit(atlas,'Atlas')]),e=>e.status===400);
    assert.throws(()=>review([atlas],[edit(atlas,'Atlas','person',[],foreign.id)]),e=>e.status===404);
    assert.throws(()=>review([atlas],[edit(atlas,'Atlas')],'rejected'),e=>e.status===400);
    assert.equal(knowledge.list('default').length,baseline);
    assert.deepEqual(pages.get('default',page.id),page);
    const result=review([atlas,bob],[edit(atlas,'Atlas Research','organization',[custom]),edit(bob,'Bob','person',[],existing.id)]);
    assert.equal(result.entities.length,baseline+1,'Matching an existing entity does not create a duplicate');
    const created=result.entities.find(e=>e.name==='Atlas Research');
    assert.equal(created.type,'organization');assert.deepEqual(created.subtypes,[custom]);
    assert.equal(result.page.blocks[0].content[0].entityId,created.id,'Renaming retains the original evidence match');
    assert.ok(result.page.blocks[0].content.some(s=>s.entityId===existing.id));
    const {pageMentions,...afterEntity}=knowledge.detail('default',existing.id);
    const {pageMentions:beforeMentions,...beforeEntity}=existing;
    assert.deepEqual(afterEntity,beforeEntity,'Review matching never edits saved entity fields');
    assert.equal(beforeMentions.length,0);assert.equal(pageMentions.length,1);assert.equal(pageMentions[0].id,page.id);assert.equal(pageMentions[0].mentionCount,1);
    assert.equal(result.scan.suggestions[0].name,'Atlas Research');assert.equal(result.scan.suggestions[0].evidence,'Atlas');
    assert.equal(result.scan.suggestions[1].name,'Robert Smith');assert.deepEqual(result.scan.suggestions[1].subtypes,['person:scientist']);
    page=result.page;scan=result.scan;
    // Turning an existing match into a new entity remains possible.
    const other=knowledge.create('default',{name:'Alice',type:'person'});
    scan=scans.save('default',page,JSON.stringify({suggestions:[candidate('Alice','person',{existingId:other.id})]}),preferences);
    const final=review([scan.suggestions[0].id],[edit(scan.suggestions[0].id,'Alice Cooper','person',['person:artist'])]);
    assert.ok(final.entities.some(e=>e.name==='Alice Cooper'&&e.subtypes.includes('person:artist')));
    assert.equal(knowledge.require('default',other.id).name,'Alice');
    assert.equal(final.scan.suggestions[0].status,'accepted');
  }finally{db.close();}
});

test('discovery recovers incorrect model offsets for named entities independently of page subjects', async()=>{
  const {Domains}=await import('../src/server/modules/domains.ts');
  const {EntityScans}=await import('../src/server/modules/entity-scan.ts');
  const {Knowledge}=await import('../src/server/modules/knowledge.ts');
  const {Pages}=await import('../src/server/modules/pages.ts');
  const {AIEnrichments}=await import('../src/server/modules/ai-enrichments.ts');
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
  const scans=new EntityScans(store,pages,knowledge,new AIEnrichments(store,pages));
  try {
    let page=pages.create('default',{title:'Céline Dion'});
    page=pages.update('default',page.id,{...page,blocks:[{id:'bio',type:'paragraph',checked:false,content:[
      {text:'Born in\u00a0'}, {text:'Charlemagne, Quebec',href:'https://example.com/city'},
      {text:', she met '},{text:'René Angélil',bold:true},
      {text:' and won Eurovision Song Contest 1988.'},
    ]}]});
    // Named entities remain eligible on both music and unrelated subject classifications.
    for(const primaryDomainId of ['arts.music','mathematics']) {
      const domains=new Domains(store);
      domains.setManual('default',page.id,{primaryDomainId,secondaryDomainIds:[]},page.revision);
      page=pages.get('default',page.id);
      const {untrusted_note:{bodyTextRuns:[run]}}=JSON.parse(scans.input('default',page));
      const suggestions=[candidate('Charlemagne, Quebec','place'),candidate('René Angélil'),candidate('Eurovision Song Contest 1988','event')]
        .map(s=>({...s,runId:run.runId,evidenceStart:999}));
      const scan=scans.save('default',page,JSON.stringify({suggestions}),{model:'gpt-5-mini',reasoningEffort:'low'});
      assert.equal(scan.suggestions.length,3);
      for(const suggestion of scan.suggestions)assert.equal(suggestion.evidenceAnchor.start,run.text.indexOf(suggestion.evidence));
    }
    const {untrusted_note:{bodyTextRuns:[run]}}=JSON.parse(scans.input('default',page));
    const scan=scans.save('default',page,JSON.stringify({suggestions:[{...candidate('René Angélil'),runId:run.runId,evidenceStart:126}]}),{model:'gpt-5-mini',reasoningEffort:'low'});
    const result=scans.review('default',page.id,{scanId:scan.id,suggestionIds:scan.suggestions.map(s=>s.id),revision:page.revision,decision:'accepted'});
    assert.equal(result.page.blocks[0].content.find(s=>s.entityId)?.mentionText,'René Angélil');
    assert.ok(result.page.blocks[0].content.some(s=>s.href==='https://example.com/city'));
  }finally{db.close();}
});

test('model evidence recovery stays within its run, rejects ambiguity and preserves original whitespace',async()=>{
  const {entityTextRuns,locateRunEvidence}=await import('../src/shared/entity-scan.ts');
  const page={blocks:[{id:'table',type:'table',content:[],rows:[[
    [{text:'Paris and Paris. '}],
    [{text:'Excluded',skipAutoTag:true},{text:'René\u00a0  Angélil and '},{text:'Paris',math:true}],
  ]]}]};
  const [repeated,unique]=entityTextRuns(page);
  assert.equal(locateRunEvidence(repeated,'Paris',999),null);
  assert.deepEqual(locateRunEvidence(repeated,'Paris',10),{blockId:'table',row:0,col:0,start:10,end:15});
  assert.equal(locateRunEvidence(unique,'Paris',0),null,'Never searches another run, cell or protected text');
  assert.equal(locateRunEvidence(unique,'Excluded',0),null);
  const anchor=locateRunEvidence(unique,'René Angélil',999);
  assert.deepEqual(anchor,{blockId:'table',row:0,col:1,start:8,end:22});
  const linked=mentionEvidence(page,'René Angélil','rene',anchor);
  assert.equal(linked.blocks[0].rows[0][1][1].mentionText,'René\u00a0  Angélil');
  assert.equal(mentionEvidence(page,'René Angélil','rene',{...anchor,start:9}),null,'Review anchors stay strict');
});

test('qualified city names and region tags use independent evidence and can be accepted together', async()=>{
  const {EntityScans,entityScanPrompt}=await import('../src/server/modules/entity-scan.ts');
  const {Knowledge}=await import('../src/server/modules/knowledge.ts');
  const {Pages}=await import('../src/server/modules/pages.ts');
  const {AIEnrichments}=await import('../src/server/modules/ai-enrichments.ts');
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
  const scans=new EntityScans(store,pages,knowledge,new AIEnrichments(store,pages));
  try {
    let page=pages.create('default',{title:'Birthplace'});
    page=pages.update('default',page.id,{...page,blocks:[{id:'bio',type:'paragraph',checked:false,content:[
      {text:'Born in '},{text:'Charlemagne, Quebec',href:'https://example.com/city'},{text:'.'},
    ]}]});
    const input=scans.input('default',page),run=JSON.parse(input).untrusted_note.bodyTextRuns[0];
    const instructions=entityScanPrompt(input).instructions;
    assert.ok(instructions.includes('canonical name'));
    assert.ok(instructions.includes('non-overlapping evidence'));
    const scan=scans.save('default',page,JSON.stringify({suggestions:[
      candidate('Charlemagne, Quebec','place',{subtypes:['place:city'],evidence:'Charlemagne',runId:run.runId,evidenceStart:8}),
      candidate('Quebec','place',{subtypes:['place:region-province-state'],runId:run.runId,evidenceStart:21}),
    ]}),{model:'gpt-5-mini',reasoningEffort:'low'});
    assert.equal(scan.suggestions.length,2);
    const review=scans.review('default',page.id,{revision:page.revision,scanId:scan.id,suggestionIds:scan.suggestions.map(s=>s.id),decision:'accepted'});
    const city=review.entities.find(e=>e.name==='Charlemagne, Quebec'),region=review.entities.find(e=>e.name==='Quebec');
    assert.ok(city);assert.ok(region);assert.notEqual(city.id,region.id);
    assert.deepEqual(review.page.blocks[0].content,[
      {text:'Born in '},{entityId:city.id,mentionText:'Charlemagne'},
      {text:', ',href:'https://example.com/city'},{entityId:region.id,mentionText:'Quebec'},{text:'.'},
    ]);
    assert.ok(review.scan.suggestions.every(s=>s.status==='accepted'));
  }finally{db.close();}
});

test('bulk acceptance strips disciplines from named entities in both new and previously saved scans',async()=>{
  const {EntityScans}=await import('../src/server/modules/entity-scan.ts');
  const {Knowledge}=await import('../src/server/modules/knowledge.ts');
  const {Pages}=await import('../src/server/modules/pages.ts');
  const {AIEnrichments}=await import('../src/server/modules/ai-enrichments.ts');
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
  const scans=new EntityScans(store,pages,knowledge,new AIEnrichments(store,pages));
  try {
    const names=[['Céline Dion','person'],['Paris','place'],['Eurovision Song Contest 1988','event'],['My Heart Will Go On','creativework'],['Disney','organization'],['Homo sapiens','organism'],['French','culture'],['stiff-person syndrome','concept']];
    let page=pages.create('default',{title:'Mixed entities'});
    page=pages.update('default',page.id,{...page,blocks:[{id:'mixed',type:'paragraph',checked:false,content:[{text:names.map(([name])=>name).join('; ')}]}]});
    const output=JSON.stringify({suggestions:names.map(([name,type])=>candidate(name,type,{domainIds:[type==='concept'?'medicine':'arts.music']}))});
    let scan=scans.save('default',page,output,{model:'gpt-5-mini',reasoningEffort:'low'});
    assert.equal(scan.suggestions.length,names.length);
    for(const suggestion of scan.suggestions)assert.deepEqual(suggestion.domainIds,suggestion.type==='concept'?['medicine']:[]);
    // Reproduce the persisted scan that caused the user's failed bulk acceptance.
    for(const suggestion of scan.suggestions)if(suggestion.type!=='concept')suggestion.domainIds=['arts.music'];
    store.run("UPDATE page_ai_enrichments SET data=? WHERE page_id=? AND kind='entity_scan'",JSON.stringify({scan}),page.id);
    const result=scans.review('default',page.id,{scanId:scan.id,suggestionIds:scan.suggestions.map(s=>s.id),revision:page.revision,decision:'accepted'});
    assert.ok(result.scan.suggestions.every(s=>s.status==='accepted'));
    assert.equal(result.page.blocks[0].content.filter(s=>s.entityId).length,names.length);
    for(const suggestion of result.scan.suggestions){
      const entity=knowledge.require('default',suggestion.existingId);
      assert.deepEqual(entity.domainIds,entity.type==='concept'?['medicine']:[]);
      assert.deepEqual(suggestion.domainIds,entity.domainIds);
    }
    assert.equal(result.page.revision,page.revision+1);
  }finally{db.close();}
});

test('contextual evidence cannot swallow a named entity and legacy overlaps recover through a unique alias',async()=>{
  const {EntityScans}=await import('../src/server/modules/entity-scan.ts');
  const {Knowledge}=await import('../src/server/modules/knowledge.ts');
  const {Pages}=await import('../src/server/modules/pages.ts');
  const {AIEnrichments}=await import('../src/server/modules/ai-enrichments.ts');
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
  const scans=new EntityScans(store,pages,knowledge,new AIEnrichments(store,pages));
  const preferences={model:'gpt-5-mini',reasoningEffort:'low'};
  try {
    let page=pages.create('default',{title:'Tennis'});
    const phrase='is going wild for its home-grown star, Alex Eala';
    page=pages.update('default',page.id,{...page,blocks:[
      {id:'heading',type:'heading1',content:[{text:phrase}]},
      {id:'body',type:'paragraph',content:[{text:'Alexandra Eala is a tennis player.'}]},
    ]});
    const broad=candidate('The Philippines','place',{evidence:phrase});
    const alex=candidate('Alex Eala','person',{aliases:['Alexandra Eala']});
    let scan=scans.save('default',page,JSON.stringify({suggestions:[broad,alex]}),preferences);
    assert.deepEqual(scan.suggestions.map(s=>s.name),['Alex Eala'],'Reject broad contextual evidence overlapping a named identity');
    // Reproduce an older persisted scan which allowed both overlapping suggestions.
    const oldBroad=scans.save('default',page,JSON.stringify({suggestions:[broad]}),preferences,false).suggestions[0];
    scan.suggestions.unshift(oldBroad);
    store.run("UPDATE page_ai_enrichments SET data=? WHERE page_id=? AND kind='entity_scan'",JSON.stringify({scan}),page.id);
    let result=scans.review('default',page.id,{scanId:scan.id,suggestionId:oldBroad.id,revision:page.revision,decision:'accepted'});
    page=result.page;scan=result.scan;
    const heading=page.blocks[0];
    result=scans.review('default',page.id,{scanId:scan.id,suggestionId:scan.suggestions[1].id,revision:page.revision,decision:'accepted'});
    const entity=result.entities.find(e=>e.name==='Alex Eala');
    assert.ok(entity);
    assert.deepEqual(entity.aliases,['Alexandra Eala']);
    assert.deepEqual(result.page.blocks[0],heading,'Existing protected mentions are preserved');
    assert.equal(result.page.blocks[1].content[0].entityId,entity.id);
    assert.equal(result.page.blocks[1].content[0].mentionText,'Alexandra Eala');
    assert.equal(result.scan.suggestions[1].status,'accepted');
    assert.equal(result.scan.suggestions[1].evidence,'Alexandra Eala');
  }finally{db.close();}
});
