import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {SourceReading} from '../src/server/modules/source-reading.ts';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {SourceFiles} from '../src/server/modules/source-files.ts';
import {SourcePages,SourcePageDraft} from '../src/server/modules/source-pages.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
import {defaultSourcePageOptions,sourcePageFormats,normalizeSourcePageOptions} from '../src/shared/source-page.ts';
import {parsePageGenerationMetadata} from '../src/shared/page-generation.ts';
import {PageMetadata} from '../src/client/intelligence/PageMetadata.tsx';

async function fixture() {
 const dir=mkdtempSync(path.join(tmpdir(),'noema-generation-')),filename=path.join(dir,'test.sqlite');
 const db=openDatabase(filename),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),files=new SourceFiles(store),sources=new SourcePages(store,knowledge,pages);
 const file=files.add('default','source.txt',Buffer.from('A group has an identity. Every element has an inverse.'));
 const source=knowledge.create('default',{name:'Group source',type:'source',attachmentIds:[file.id]});
 await files.tick();
 function stage(options={...defaultSourcePageOptions,language:'English'},focus='Explain the identity.',revision) {
  const prepared=sources.prepare('default',source.id,{requestId:randomUUID(),focus,options,...(revision?{revision}:{})});
  const draft=new SourcePageDraft(()=>{},prepared.file.text,prepared.file,options.language);
  draft.feed(JSON.stringify({type:'title',title:'Group identity',language:'en'})+'\n');
  draft.feed(JSON.stringify({type:'block',blockType:'paragraph',basis:'source',text:'The source explains the identity element.',citations:[{startLine:1,endLine:1}]})+'\n');
  draft.finish();
  const review=sources.stage('default',prepared,draft,'missing-activity');
  return {prepared,review};
 }
 return {dir,filename,db,store,knowledge,pages,files,sources,source,stage,close(){files.close();db.close();rmSync(dir,{recursive:true,force:true});}};
}

test('generation snapshots survive acceptance, retained draft history, edits, database reopen, and backup restoration',async()=>{
 const env=await fixture();
 try {
  const options={...defaultSourcePageOptions,format:'critique',language:'English',detail:'brief',familiarity:'expert',beyondSources:true};
  const first=env.stage(options,'Compare the reasoning.'),second=env.stage(options,'Compare the reasoning.',{draftId:first.review.id,feedback:'Focus on the assumptions.',mode:'changes'});
  const draftSnapshot={...env.store.get('SELECT * FROM source_page_drafts WHERE request_id=?',second.review.id)};
  const accepted=env.sources.accept('default',env.source.id,second.review.id),metadata=accepted.page.generationMetadata;
  assert.equal(accepted.page.creationMethod,'ai_generated');
  assert.equal(metadata.type,'source_page');assert.deepEqual(metadata.options,options);
  assert.equal(metadata.formatPrompt,sourcePageFormats.critique.prompt);
  assert.equal(metadata.userPrompt,'Compare the reasoning.');
  assert.deepEqual(metadata.revisionFeedback,['Focus on the assumptions.']);
  assert.match(metadata.instructions,/OUTPUT LANGUAGE: Write the complete page in en/);
  assert.deepEqual(env.sources.accept('default',env.source.id,second.review.id).page.generationMetadata,metadata);
  const retained=env.store.get('SELECT * FROM source_page_drafts WHERE request_id=?',second.review.id);
  assert.deepEqual({...retained},{...draftSnapshot,status:'accepted'},'Acceptance preserves the complete immutable draft snapshot');
  const page=env.pages.update('default',accepted.page.id,{...accepted.page,title:'Edited group note'});
  assert.equal(page.aiStatus,'ai_generated_edited');assert.deepEqual(page.generationMetadata,metadata);
  const reopened=openDatabase(env.filename);
  try{const store=new Store(reopened);assert.deepEqual(new Pages(store,new Knowledge(store)).get('default',page.id).generationMetadata,metadata);}finally{reopened.close();}
  const backups=new VaultBackups(env.store),archive=await backups.export('default'),restored=await backups.import(archive.bytes,'Restored generation');
  const imported=env.pages.list(restored.id).find(item=>item.title===page.title);
  assert.deepEqual(env.pages.get(restored.id,imported.id).generationMetadata,metadata);
 }finally{env.close();}
});

test('old AI pages and pending drafts remain unavailable; regular pages cannot supply generation metadata',async()=>{
 const env=await fixture();
 try {
  const old=env.pages.create('default',{title:'Old AI page'});
  env.store.run("UPDATE pages SET ai_status='ai_generated' WHERE id=?",old.id);
  assert.equal(env.pages.get('default',old.id).generationMetadata,null);
  const pending=env.stage();
  env.store.run('UPDATE source_page_drafts SET generation_metadata=NULL WHERE request_id=?',pending.review.id);
  assert.equal(env.sources.accept('default',env.source.id,pending.review.id).page.generationMetadata,null);
  const regular=env.pages.create('default',{title:'Manual',generationMetadata:{type:'source_page'}});
  assert.equal(regular.generationMetadata,null);
  env.db.close();
  const reopened=openDatabase(env.filename);
  try{assert.equal(reopened.prepare('SELECT generation_metadata FROM pages WHERE id=?').get(old.id).generation_metadata,null);}finally{reopened.close();}
 }finally{env.files.close();try{env.db.close();}catch{}rmSync(env.dir,{recursive:true,force:true});}
});

test('generation metadata is a dedicated subsection only for AI-created pages',()=>{
 const base={id:'page',title:'Note',blocks:[],sourceIds:[],revision:1,vault_id:'default',updated_at:'2026-10-19T00:00:00Z'};
 for(const aiStatus of ['regular','regular_with_ai_explanations'])assert.doesNotMatch(renderToStaticMarkup(React.createElement(PageMetadata,{page:{...base,aiStatus}})),/Generation details|Not available/);
 for(const aiStatus of ['ai_generated','ai_generated_edited'])assert.match(renderToStaticMarkup(React.createElement(PageMetadata,{page:{...base,aiStatus}})),/Generation details.*Not available/);
 const generationMetadata={version:1,type:'source_page',options:{...defaultSourcePageOptions,format:'custom',language:'English'},formatPrompt:'A saved format prompt.',userPrompt:'Focus on <assumptions>.',instructions:'Saved system instructions.',revisionFeedback:['Explain the reasoning.']};
 const html=renderToStaticMarkup(React.createElement(PageMetadata,{page:{...base,aiStatus:'ai_generated',generationMetadata}}));
 assert.match(html,/Create your own/);assert.match(html,/Focus on &lt;assumptions&gt;/);assert.match(html,/A saved format prompt/);assert.doesNotMatch(html,/System instructions|Saved system instructions|View instructions/);assert.match(html,/Explain the reasoning/);
 assert.doesNotMatch(html,/Not available/);
 const explanation=renderToStaticMarkup(React.createElement(PageMetadata,{page:{...base,aiStatus:'ai_generated',generationMetadata:{version:1,type:'reading_explanation',options:{language:'English',familiarity:'beginner'},instructions:'Saved explanation system instructions.'}}}));
 assert.match(explanation,/Passage explanation/);
 assert.doesNotMatch(explanation,/Saved explanation system instructions|View instructions|View prompt/);
});

test('import validation rejects malformed snapshots rather than inventing generation settings',()=>{
 assert.equal(parsePageGenerationMetadata(null),null);
 assert.throws(()=>parsePageGenerationMetadata({version:1,type:'source_page',options:{},instructions:'prompt'}),/Invalid generation metadata/);
});


test('new passage explanation pages record their form options while authored reading notes remain regular',async()=>{
 const env=await fixture();
 try {
  const file=env.store.get('SELECT * FROM source_files WHERE entity_id=?',env.source.id),reading=new SourceReading(env.store);
  const selection={sourceId:env.source.id,fileId:file.id,sourceHash:createHash('sha256').update(file.text).digest('hex'),startOffset:0,endOffset:file.text.length,excerpt:file.text};
  const explanation=reading.createReadingNote('default',file.id,{...selection,requestId:randomUUID(),text:'The identity preserves each element.'},{language:'English',familiarity:'beginner'});
  assert.equal(explanation.generationMetadata.type,'reading_explanation');
  assert.deepEqual(explanation.generationMetadata.options,{language:'English',familiarity:'beginner'});
  assert.match(explanation.generationMetadata.instructions,/Assume no prior knowledge/);
  const manual=reading.createReadingNote('default',file.id,{...selection,requestId:randomUUID(),text:'My own reading note.'});
  assert.equal(manual.creationMethod,'manual_creation');assert.equal(explanation.creationMethod,'ai_generated');assert.equal(manual.aiStatus,'regular');assert.equal(manual.generationMetadata,null);
 }finally{env.close();}
});

test('all source generation formats and legacy aliases retain generated creation evidence',async()=>{
 const env=await fixture();
 try{
  // Older option names are normalized by the existing workflow, never by provenance.
  for(const format of [...Object.keys(sourcePageFormats),'legacy-format']){
   const staged=env.stage(normalizeSourcePageOptions({...defaultSourcePageOptions,format,language:'English'}),'Synthetic '+format);
   const result=env.sources.accept('default',env.source.id,staged.review.id);
   assert.equal(result.page.creationMethod,'ai_generated');
   assert.equal(result.page.aiStatus,'ai_generated');
   assert.equal(result.page.generationMetadata.type,'source_page');
   const again=env.sources.accept('default',env.source.id,staged.review.id);
   assert.equal(again.page.id,result.page.id);assert.equal(again.page.creationMethod,'ai_generated');
  }
 }finally{env.close();}
});
