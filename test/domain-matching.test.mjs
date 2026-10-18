import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyEntityMentions} from '../src/shared/auto-entities.ts';
import {entitiesForPage} from '../src/shared/concept-classification.ts';
import {entityTextRuns,locateEvidence,mentionEvidence} from '../src/shared/entity-scan.ts';
const concept=(id,name,aliases=[],domainIds=['mathematics.algebra.abstract'])=>({id,name,aliases,domainIds,type:'concept',subtypes:[],vault_id:'v',description:'',updated_at:''});
const block=(text,id='p')=>({id,type:'paragraph',checked:false,content:[{text}]});
const field=concept('field','Field (algebra)',['field']);
test('unique polysemous aliases need review and ordinary uses are excluded on the same page',()=>{
 const blocks=[block('A field has multiplicative inverses. The field of research is broad.')];
 const result=identifyEntityMentions(blocks,[field],'v');
 assert.equal(result.count,0);assert.equal(result.ambiguous.length,1);
 assert.deepEqual(result.ambiguous[0].entityIds,['field']);
 const accepted=identifyEntityMentions(blocks,[field],'v',{match:result.ambiguous[0],entityId:'field'});
 assert.equal(accepted.count,1);assert.equal(accepted.blocks[0].content.at(-1).text,' has multiplicative inverses. The field of research is broad.');
});
test('fieldwork and interdisciplinary mentions are retained for contextual review without subtype gates',()=>{
 const psychology=concept('psych','field theory',[],['psychology.social_personality']);
 const page={blocks:[block("Psychology fieldwork considers Lewin's field theory alongside a field with inverses.")],pageDomains:{primaryDomainId:'psychology'}};
 assert.equal(entitiesForPage(page,[field,psychology]).length,2);
 const result=identifyEntityMentions(page.blocks,[field,psychology],'v');
 assert.equal(result.count,1);assert.equal(result.ambiguous.length,1);
 assert.equal(result.blocks[0].content.find(item=>item.entityId)?.entityId,'psych');
});
test('shared Concept aliases are never resolved by entity order or page-wide explicit mentions',()=>{
 const other=concept('other','Field (physics)',['field'],['physics']);
 const result=identifyEntityMentions([block('field')],[field,other],'v',undefined,new Set(['field']));
 assert.equal(result.count,0);assert.deepEqual(result.ambiguous[0].entityIds,['field','other']);
});
test('repeated evidence requires occurrence anchors and remains stable through earlier insertions',()=>{
 let page={blocks:[block('field of research; field has inverses.')]};
 assert.equal(mentionEvidence(page,'field','field'),null);
 const runs=entityTextRuns(page);assert.equal(runs.length,1);
 const anchor={blockId:'p',start:19,end:24};
 assert.deepEqual(locateEvidence(page,'field',anchor),anchor);
 page=mentionEvidence(page,'research','research');
 page=mentionEvidence(page,'field','field',anchor);
 assert.ok(page);assert.equal(page.blocks[0].content.filter(segment=>segment.entityId==='field').length,1);
 assert.equal(page.blocks[0].content[0].text,'field of ');
 assert.equal(mentionEvidence(page,'field','field',anchor),null);
});
test('anchors cannot cross exclusions, formulas, mentions or other blocks',()=>{
 const page={blocks:[{...block(''),content:[{text:'field',skipAutoTag:true},{text:' + '},{text:'field',math:true},{entityId:'old',mentionText:'field'},{text:'field'}]},block('field','q')]};
 assert.equal(entityTextRuns(page).length,3);
 assert.equal(mentionEvidence(page,'field','x',{blockId:'p',start:0,end:5}),null);
 assert.equal(mentionEvidence(page,'field','x',{blockId:'p',start:13,end:18}),null);
 assert.ok(mentionEvidence(page,'field','x',{blockId:'q',start:0,end:5}));
});

test('scanner validates domains, selects explicit identities, anchors repeats and rejects changed lexicons',async()=>{
 const {openDatabase}=await import('../src/server/database.ts');
 const {Store}=await import('../src/server/store.ts');
 const {Pages}=await import('../src/server/modules/pages.ts');
 const {Knowledge}=await import('../src/server/modules/knowledge.ts');
 const {EntityScans}=await import('../src/server/modules/entity-scan.ts');
 const {AIEnrichments}=await import('../src/server/modules/ai-enrichments.ts');
 const db=openDatabase(':memory:'),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),scans=new EntityScans(store,pages,knowledge,new AIEnrichments(store,pages));
 try {
  const savedField=knowledge.create('default',{name:'Field (algebra)',type:'concept',aliases:['field'],domainIds:['mathematics.algebra.abstract']});
  let page=pages.create('default',{title:'Unclassified interdisciplinary note'});
  page=pages.update('default',page.id,{...page,blocks:[block('The field of research; a field has multiplicative inverses.')]});
  const input=JSON.parse(scans.input('default',page));
  assert.equal(input.existingEntities.some(entity=>entity.id===savedField.id),true);
  assert.equal(input.pageConceptSubtypeIds,undefined);
  const run=input.untrusted_note.bodyTextRuns[0];
  const candidate={name:savedField.name,type:'concept',subtypes:[],domainIds:['mathematics.algebra.abstract'],description:'',existingId:savedField.id,evidence:'field',reason:'Multiplicative inverses provide algebraic context.',runId:run.runId,evidenceStart:25};
  const save=value=>scans.save('default',page,JSON.stringify({suggestions:[value]}),{model:'gpt-5-mini',reasoningEffort:'low'});
  assert.throws(()=>save({...candidate,domainIds:['invented.domain']}),error=>error.status===502);
  assert.equal(save({...candidate,evidenceStart:4}).suggestions.length,0);
  const scan=save(candidate);assert.equal(scan.suggestions.length,1);
  assert.equal(scan.suggestions[0].evidenceAnchor.start,25);
  const accepted=scans.review('default',page.id,{revision:page.revision,scanId:scan.id,suggestionId:scan.suggestions[0].id,decision:'accepted'});
  assert.equal(accepted.page.blocks[0].content[0].text,'The field of research; a ');
  assert.equal(accepted.page.blocks[0].content[1].entityId,savedField.id);
  page=pages.update('default',page.id,{...accepted.page,blocks:[block('A fresh concept here.')]});
  const fresh=save({name:'Fresh concept',type:'concept',subtypes:[],domainIds:['philosophy'],description:'',existingId:null,evidence:'fresh concept',reason:'Explicit'});
  const first=scans.review('default',page.id,{revision:page.revision,scanId:fresh.id,suggestionId:fresh.suggestions[0].id,decision:'accepted'});
  const created=first.entities.find(entity=>entity.name==='Fresh concept');
  assert.deepEqual(created.domainIds,['philosophy']);
  assert.equal(store.get('SELECT origin FROM entity_domains WHERE entity_id=?',created.id).origin,'scan');
  page=pages.update('default',page.id,{...first.page,blocks:[block('First new concept and second new concept.') ]});
  const sequential=scans.save('default',page,JSON.stringify({suggestions:[{name:'First new concept',type:'concept',subtypes:[],domainIds:[],description:'',existingId:null,evidence:'First new concept',reason:'Explicit'},{name:'Second new concept',type:'concept',subtypes:[],domainIds:[],description:'',existingId:null,evidence:'second new concept',reason:'Explicit'}]}),{model:'gpt-5-mini',reasoningEffort:'low'});
  const one=scans.review('default',page.id,{revision:page.revision,scanId:sequential.id,suggestionId:sequential.suggestions[0].id,decision:'accepted'});
  const two=scans.review('default',page.id,{revision:one.page.revision,scanId:sequential.id,suggestionId:sequential.suggestions[1].id,decision:'accepted'});
  assert.equal(two.page.blocks[0].content.filter(segment=>segment.entityId).length,2);
  page=pages.update('default',page.id,{...two.page,blocks:[block('A stale concept.')]});
  const stale=save({name:'Stale concept',type:'concept',subtypes:[],domainIds:[],description:'',existingId:null,evidence:'stale concept',reason:'Explicit'});
  knowledge.create('default',{name:'Unrelated person',type:'person'});
  assert.throws(()=>scans.review('default',page.id,{revision:page.revision,scanId:stale.id,suggestionId:stale.suggestions[0].id,decision:'accepted'}),error=>error.status===409);
 }finally{db.close();}
});

test('formatted table anchors preserve exact whitespace and distinct cell coordinates',()=>{
 const page={blocks:[{...block(''),type:'table',rows:[[[{text:'field'}],[{text:'a fi',bold:true},{text:'eld  has inverses'}]]]}]};
 const runs=entityTextRuns(page);assert.equal(runs.length,2);
 const anchor={blockId:'p',row:0,col:1,start:2,end:7};
 const result=mentionEvidence(page,'field','algebra',anchor);
 assert.equal(result.blocks[0].rows[0][0][0].text,'field');
 assert.deepEqual(result.blocks[0].rows[0][1],[{text:'a ',bold:true},{entityId:'algebra',mentionText:'field'},{text:'  has inverses'}]);
});
