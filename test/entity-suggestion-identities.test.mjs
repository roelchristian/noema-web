import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeSuggestionIdentities} from '../src/shared/entity-suggestion-identities.ts';
import {EntityScans} from '../src/server/modules/entity-scan.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
const suggestion=(name,aliases=[],extra={})=>({id:name,name,aliases,type:'organization',subtypes:[],proposedSubtypeIds:[],domainIds:[],description:'Named club',evidence:name,reason:'Named in note',existingId:null,status:'pending',...extra});

test('reciprocal aliases keep the first canonical name and converge across streamed prefixes',()=>{
  const first=suggestion('Team Socceroo FC',['Team Socceroo F.C.']);
  const second=suggestion('Team Socceroo F.C.',['Team Socceroo FC']);
  const merged=mergeSuggestionIdentities([first,second]);
  assert.deepEqual(merged,[first]);
  assert.equal(mergeSuggestionIdentities([first])[0].name,merged[0].name);
  assert.deepEqual(mergeSuggestionIdentities([second,first]),[second],'First proposal wins in either order');
  assert.deepEqual(first.aliases,['Team Socceroo F.C.'],'Input is not mutated');
});

test('reciprocal identity rules preserve distinct categories, shared aliases and distinct saved entities',()=>{
  const first=suggestion('Alpha',['Beta']),second=suggestion('Beta',['Alpha']);
  assert.equal(mergeSuggestionIdentities([first,{...second,type:'person'}]).length,2);
  assert.equal(mergeSuggestionIdentities([suggestion('Alpha',['Club']),suggestion('Beta',['Club'])]).length,2);
  assert.equal(mergeSuggestionIdentities([first,suggestion('Beta')]).length,2,'One-way aliases alone do not prove identity');
  assert.equal(mergeSuggestionIdentities([{...first,existingId:'a'},{...second,existingId:'b'}]).length,2);
  const merged=mergeSuggestionIdentities([first,{...second,existingId:'b'}]);
  assert.equal(merged.length,1);assert.equal(merged[0].name,'Beta');assert.equal(merged[0].existingId,'b');
  assert.deepEqual(merged[0].aliases,['Alpha']);
});

test('reciprocal chains combine aliases and subtype proposals deterministically',()=>{
  const result=mergeSuggestionIdentities([
    suggestion('Alpha',['Beta'],{proposedSubtypeIds:['one']}),
    suggestion('Gamma',['Beta']),
    suggestion('Beta',['Alpha','Gamma'],{proposedSubtypeIds:['two']}),
  ]);
  assert.equal(result.length,1);assert.equal(result[0].name,'Alpha');
  assert.deepEqual(new Set(result[0].aliases),new Set(['Beta','Gamma']));
  assert.deepEqual(result[0].proposedSubtypeIds,['one','two']);
});

test('scan workflow merges reciprocal spellings before preview, persistence and acceptance',()=>{
  const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),enrichments=new AIEnrichments(store,pages),scans=new EntityScans(store,pages,knowledge,enrichments);
  try {
    let page=pages.create('default',{title:'Jake Cuenca'});
    page=pages.update('default',page.id,{...page,blocks:[{id:'b',type:'paragraph',checked:false,content:[{text:'He played for Team Socceroo FC, also written Team Socceroo F.C.'}]}]});
    const output=JSON.stringify({suggestions:[suggestion('Team Socceroo FC',['Team Socceroo F.C.']),suggestion('Team Socceroo F.C.',['Team Socceroo FC'])]});
    const preferences={model:'gpt-5-mini',reasoningEffort:'low'};
    const preview=scans.save('default',page,output,preferences,false);
    assert.equal(preview.suggestions.length,1);assert.equal(preview.suggestions[0].name,'Team Socceroo FC');
    assert.equal(enrichments.list('default',page.id).filter(e=>e.kind==='entity_scan').length,0);
    const scan=scans.save('default',page,output,preferences);
    assert.equal(scan.suggestions.length,1);assert.deepEqual(scan.suggestions[0].aliases,['Team Socceroo F.C.']);
    const result=scans.review('default',page.id,{scanId:scan.id,suggestionIds:scan.suggestions.map(s=>s.id),revision:page.revision,decision:'accepted'});
    const club=result.entities.find(e=>e.name==='Team Socceroo FC');assert.ok(club);
    assert.deepEqual(club.aliases,[],'Suggested spellings stay local unless alias reuse is explicitly selected');
    assert.equal(result.entities.some(e=>e.name==='Team Socceroo F.C.'),false);
    assert.equal(result.page.blocks[0].content.find(s=>s.entityId)?.entityId,club.id);
  }finally{db.close();}
});

test('narrative variants retain reciprocal names and scanner status remains explicit and reviewable',()=>{
 const first=suggestion('Merlin (Novel A)',['Merlin (Film B)'],{type:'person',subtypes:['person:fictional-character'],referentStatus:'fictional'});
 const second=suggestion('Merlin (Film B)',['Merlin (Novel A)'],{type:'person',subtypes:['person:fictional-character'],referentStatus:'fictional'});
 assert.equal(mergeSuggestionIdentities([first,second]).length,2);
 const db=openDatabase(':memory:');
 try {
  const store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),scans=new EntityScans(store,pages,knowledge,new AIEnrichments(store,pages));
  let page=pages.create('default',{title:'Synthetic story'});
  page=pages.update('default',page.id,{...page,blocks:[{id:'b',type:'paragraph',checked:false,content:[{text:'In the novel, Mira meets Sora. The account also mentions a contested figure.'}]}]});
  const prefs={model:'gpt-5-mini',reasoningEffort:'low'};
  const scan=scans.save('default',page,JSON.stringify({suggestions:[suggestion('Mira',[],{type:'person',evidence:'Mira',referentStatus:'fictional'}),suggestion('Sora',[],{type:'person',evidence:'Sora'})]}),prefs);
  assert.deepEqual(scan.suggestions.map(s=>s.referentStatus),['fictional','unspecified']);
  const result=scans.review('default',page.id,{scanId:scan.id,suggestionIds:scan.suggestions.map(s=>s.id),revision:page.revision,decision:'accepted'});
  assert.equal(result.entities.find(e=>e.name==='Mira').referentStatus,'fictional');
  assert.equal(result.entities.find(e=>e.name==='Sora').referentStatus,'unspecified');
  assert.throws(()=>scans.save('default',result.page,JSON.stringify({suggestions:[suggestion('contested figure',[],{type:'person',evidence:'contested figure',referentStatus:'false'})]}),prefs));
 } finally {db.close();}
});

test('narrative continuation collisions require qualified identity while repeated explicit saved IDs deduplicate',()=>{
 const db=openDatabase(':memory:');
 try {
  const store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),scans=new EntityScans(store,pages,knowledge,new AIEnrichments(store,pages));
  let page=pages.create('default',{title:'Synthetic adaptations'});
  const names=[...Array.from({length:24},(_,i)=>'Agent'+i),'Merlin','Next'];
  page=pages.update('default',page.id,{...page,blocks:[{id:'b',type:'paragraph',checked:false,content:[{text:names.join(' met ')+' then Merlin in another adaptation.'}]}]});
  const prefs={model:'gpt-5-mini',reasoningEffort:'low'};
  const proposed=name=>suggestion(name,[],{type:'person',referentStatus:'fictional'});
  const first=scans.save('default',page,JSON.stringify({suggestions:names.map(proposed)}),prefs);
  assert.ok(first.continuation);
  const previous=scans.continuation('default',page,first.id,first.continuation.token);
  assert.throws(()=>scans.save('default',page,JSON.stringify({suggestions:[proposed('Merlin')]}),prefs,true,previous),/Narrative identity cannot be established/);
  const saved=knowledge.create('default',{name:'Merlin',type:'person',referentStatus:'fictional',subtypes:['person:fictional-character']});
  const same={...proposed('Merlin'),existingId:saved.id};
  const explicit=scans.save('default',page,JSON.stringify({suggestions:[same,same]}),prefs,false);
  assert.equal(explicit.suggestions.length,1);assert.equal(explicit.suggestions[0].existingId,saved.id);
 } finally {db.close();}
});
