import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorReviewPrompt,writingAction,reviewTexts,parseEditorReview} from '../src/server/modules/editor-review.ts';
import {generationPolicy} from '../src/server/modules/generation-request.ts';
import {defaultIntelligencePreferences} from '../src/shared/intelligence.ts';
const standard=defaultIntelligencePreferences;
const selections={personaId:'salon_wit',standard,title:standard,enrichment:standard};
test('writing actions explicitly separate voice preservation from rhetorical rewriting',()=>{
 assert.equal(writingAction(undefined),'proofread');assert.throws(()=>writingAction('extract'),e=>e.status===400);
 for(const action of ['proofread','refine','rewrite','recast']){
  const policy=generationPolicy({kind:'review',action,input:'Synthetic selected span'},selections),prompt=policy.prompt();
  assert.match(prompt.instructions,new RegExp(`WRITING ACTION: ${action}`));
  assert.match(prompt.instructions,/meaning, facts, evidence, citations, requested language and mathematical meaning/);
  if(['rewrite','recast'].includes(action)){assert.doesNotMatch(prompt.instructions,/apply persona only to explanatory rationale/);assert.doesNotMatch(editorReviewPrompt(action),/language, voice, whitespace/);}
  else assert.match(prompt.instructions,/preserve the author’s voice/);
 }
});
test('proposals reject fabricated spans and oversized malformed provider responses',()=>{
 const texts=reviewTexts([{id:'p:0',text:'An identity leaves an element unchanged.'}]);
 assert.deepEqual(parseEditorReview('{"suggestions":[{"id":"p:0","replacement":"An identity changes nothing.","reason":"Synthetic mock."}]}',texts),[{id:'p:0',replacement:'An identity changes nothing.',reason:'Synthetic mock.'}]);
 assert.throws(()=>parseEditorReview('{"suggestions":[{"id":"other","replacement":"Altered","reason":""}]}',texts),e=>e.status===502);
 assert.throws(()=>reviewTexts([{id:'p:0',text:'x'.repeat(24001)}]),e=>e.status===400);
});

test('accepted writing provenance survives page persistence and history without relabelling old blocks',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {openDatabase}=await import('../src/server/database.ts');const {Store}=await import('../src/server/store.ts');const {Knowledge}=await import('../src/server/modules/knowledge.ts');const {Pages}=await import('../src/server/modules/pages.ts');
 const dir=mkdtempSync(join(tmpdir(),'noema-writing-')),db=openDatabase(join(dir,'test.sqlite')),store=new Store(db),pages=new Pages(store,new Knowledge(store));
 try{
  const page=pages.create('default',{title:'Synthetic note'}),block={id:'p',type:'paragraph',checked:false,content:[{text:'Original prose.'}]};
  const original=pages.update('default',page.id,{...page,blocks:[block]});assert.equal(original.blocks[0].writingProvenance,undefined);
  const provenance={action:'recast',persona:{id:'editor',version:2,origin:'builtin',expression:'immersive'},acceptedAt:'2026-10-25T18:30:00.000Z'};
  const edited=pages.update('default',page.id,{...original,blocks:[{...block,content:[{text:'Recast prose.'}],writingProvenance:[provenance]}],aiReviewAccepted:true});
  assert.deepEqual(pages.get('default',page.id).blocks[0].writingProvenance,[provenance]);assert.ok(edited.revision>original.revision);
  const snapshots=store.all('SELECT snapshot_json FROM page_versions WHERE page_id=?',page.id).map(row=>JSON.parse(row.snapshot_json));
  assert.ok(snapshots.some(snapshot=>snapshot.blocks[0]?.writingProvenance?.[0]?.persona.expression==='immersive'));
  assert.ok(snapshots.some(snapshot=>snapshot.blocks[0]?.content[0]?.text==='Original prose.'&&snapshot.blocks[0].writingProvenance===undefined));
  assert.throws(()=>pages.validateBlocks('default',[{...block,writingProvenance:[{...provenance,action:'extract'}]}]),e=>e.status===400);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
