import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {pageProvenanceView,pageAIProvenance,nextPageAIStatus} from '../src/shared/page-ai-status.ts';
import {PageProvenanceDisclosure} from '../src/client/components/PageProvenance.tsx';
import {PageMetadata} from '../src/client/intelligence/PageMetadata.tsx';

const block=(id,text=id)=>({id,type:'paragraph',checked:false,content:[{text}]});
const answer={...block('answer'),semanticGroup:{id:'group',kind:'ai-explanation'}};
const base={id:'note',vault_id:'default',title:'Synthetic note',blocks:[block('body')],sourceIds:[],revision:1,updated_at:'2026-10-23'};
const markup=page=>renderToStaticMarkup(React.createElement(PageProvenanceDisclosure,{page}));
function services(db){const store=new Store(db);return {store,pages:new Pages(store,new Knowledge(store)),backups:new VaultBackups(store)};}

test('presentation separates creation from every contribution and uses surviving explanations',()=>{
 for(const aiStatus of [undefined,'regular','regular_with_ai_explanations']){
  const page={...base,aiStatus};
  assert.equal(pageProvenanceView(page).origin,'unknown');
  assert.equal(markup(page),''); // A stale legacy status cannot stand in for blocks.
 }
 const page={...base,creationMethod:'manual_creation',aiStatus:'ai_assisted',aiReviewAccepted:true,blocks:[...base.blocks,answer]};
 const provenance=pageAIProvenance(page);
 assert.equal(provenance.origin,'manual_creation');
 assert.deepEqual(provenance.contributions,['AI writing edits accepted','Contains AI explanations']);
 const doc=new JSDOM(markup(page)).window.document;
 assert.equal(doc.querySelectorAll('details').length,1);
 assert.match(doc.querySelector('summary').getAttribute('aria-label'),/Creation & AI history/);
 assert.match(doc.body.textContent,/Created in Noema.*AI writing edits accepted.*Contains AI explanations/);
 assert.doesNotMatch(doc.body.textContent,/Regular|AI-assisted|Human-authored|AI-free/);
 assert.equal(pageProvenanceView({...page,blocks:[]}).containsAIExplanations,false);
 assert.equal(pageProvenanceView({...page,blocks:undefined,containsAIExplanations:true}).containsAIExplanations,true);
 const metadata=renderToStaticMarkup(React.createElement(PageMetadata,{page:{...base,aiStatus:'ai_assisted',aiReviewAccepted:true}}));
 assert.match(metadata,/Creation method.*Not recorded/);assert.doesNotMatch(metadata,/>Origin</);
});

test('generated pages disclose combined contributions and historical edits without relabelling origin',()=>{
 const page={...base,aiStatus:'ai_generated_edited',aiReviewAccepted:true,blocks:[...base.blocks,answer]};
 const provenance=pageAIProvenance(page);
 assert.equal(provenance.label,'AI-generated');assert.equal(provenance.editedAfterGeneration,true);
 assert.deepEqual(provenance.contributions,['AI-generated content','AI writing edits accepted','Contains AI explanations']);
 assert.match(markup(page),/Edited after generation/);
 assert.match(markup({...page,aiStatus:'ai_generated',aiReviewAccepted:false}),/Unedited since generation/);
 assert.match(markup({...page,aiStatus:'ai_generated',editedAfterGeneration:true}),/Edited after generation/);
});

test('durable acceptance and creation survive last explanation deletion, save/reload, reopen and backups',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-page-provenance-')),filename=path.join(dir,'test.sqlite');
 let db=openDatabase(filename);
 try{
  let {store,pages,backups}=services(db);
  let page=pages.create('default',{title:'Combined contributions',creationMethod:'ai_generated'});
  assert.equal(page.creationMethod,'manual_creation'); // Creation clients cannot set origin.
  page=pages.update('default',page.id,{...page,aiReviewAccepted:true,blocks:[block('body'),answer]});
  assert.equal(page.aiStatus,'ai_assisted');assert.equal(pages.list('default').find(p=>p.id===page.id).containsAIExplanations,true);
  page=pages.update('default',page.id,{...page,aiReviewAccepted:false,creationMethod:'ai_generated',blocks:[]});
  assert.equal(page.aiReviewAccepted,true);assert.equal(page.creationMethod,'manual_creation');
  assert.equal(pageAIProvenance(page).containsAIExplanations,false);
  assert.equal(pages.list('default').find(p=>p.id===page.id).containsAIExplanations,false);
  // Undo restores the surviving-block fact, but does not undo accepted-edit history.
  page=pages.update('default',page.id,{...page,blocks:[block('body'),answer]});
  assert.equal(pageAIProvenance(pages.get('default',page.id)).containsAIExplanations,true);
  const id=page.id;db.close();db=openDatabase(filename);({store,pages,backups}=services(db));
  assert.equal(pages.get('default',id).aiReviewAccepted,true);
  const exported=await backups.export('default');
  const restored=await backups.import(exported.bytes,'Restored page history');
  const imported=pages.list(restored.id).find(p=>p.title===page.title);
  assert.deepEqual(pageProvenanceView(pages.get(restored.id,imported.id)),pageProvenanceView(pages.get('default',id)));
  const old=JSON.parse(gunzipSync(exported.bytes));
  for(const row of old.tables.pages){delete row.creation_method;delete row.ai_review_accepted;row.ai_status=row.title===page.title?'ai_assisted':row.ai_status;}
  const legacy=await backups.import(gzipSync(JSON.stringify(old)),'Legacy backup');
  const legacyPage=pages.get(legacy.id,pages.list(legacy.id).find(p=>p.title===page.title).id);
  assert.equal(legacyPage.creationMethod,null);assert.equal(pageProvenanceView(legacyPage).origin,'unknown');
  assert.equal(legacyPage.aiReviewAccepted,true);
  old.tables.pages[0].creation_method='human_authored';
  await assert.rejects(backups.import(gzipSync(JSON.stringify(old)),'Invalid creation'));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('migration leaves old ordinary pages unknown and preserves generated evidence through edit and undo',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-origin-migration-')),filename=path.join(dir,'test.sqlite');
 let db=openDatabase(filename);
 try{
  let {store,pages}=services(db);
  const ordinary=pages.create('default',{title:'Historical ordinary'}),generated=pages.create('default',{title:'Historical generated'});
  store.run("UPDATE pages SET ai_status='ai_generated' WHERE id=?",generated.id);
  db.exec('ALTER TABLE pages DROP COLUMN creation_method');db.close();db=openDatabase(filename);
  ({store,pages}=services(db));
  assert.equal(pages.get('default',ordinary.id).creationMethod,null);
  assert.equal(pageProvenanceView(pages.get('default',ordinary.id)).origin,'unknown');
  let page=pages.get('default',generated.id),original=page.title;
  assert.equal(pageProvenanceView(page).origin,'ai_generated');
  page=pages.update('default',page.id,{...page,title:'Edited title'});
  page=pages.update('default',page.id,{...page,title:original,editedAfterGeneration:false});
  assert.equal(page.aiStatus,'ai_generated_edited');
  assert.equal(pageProvenanceView(page).editedAfterGeneration,true);
  // An edit and undo between saves records the observed event via the additive flag.
  store.run("UPDATE pages SET ai_status='ai_generated' WHERE id=?",page.id);page=pages.get('default',page.id);
  const edited={...page,title:'Temporary edit'};edited.aiStatus=nextPageAIStatus(page,edited,()=>undefined);
  const undone={...page,editedAfterGeneration:edited.aiStatus==='ai_generated_edited'};
  assert.equal(pages.update('default',page.id,undone).aiStatus,'ai_generated_edited');
  assert.equal(pages.update('default',ordinary.id,{...ordinary,editedAfterGeneration:true}).aiStatus,'regular');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
