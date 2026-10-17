import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {AIEnrichments} from '../src/server/modules/ai-enrichments.ts';
import {summaryInput,summaryContentHash} from '../src/server/modules/summary-content.ts';

const preferences={model:'test',reasoningEffort:'low'};
const block=(text,extra={})=>({id:'body',type:'paragraph',checked:false,content:[{text}],...extra});
function setup(filename=':memory:') {
  const db=openDatabase(filename),store=new Store(db),knowledge=new Knowledge(store),pages=new Pages(store,knowledge);
  const enrichments=new AIEnrichments(store,pages);
  return {db,store,knowledge,pages,enrichments};
}
test('summary fingerprint ignores styling, text-run boundaries, block IDs and whitespace',()=>{
  const original={title:'My note',blocks:[block('A useful note.')]};
  const styled={title:' My   note ',blocks:[block('',{id:'new-id',type:'heading1',content:[{text:'A ',bold:true},{text:'useful',italic:true,underline:true,strike:true,code:true},{text:' note.  '}]})]};
  const hash=summaryContentHash(original,()=>undefined);
  assert.equal(summaryContentHash(styled,()=>undefined),hash);
  assert.notEqual(summaryContentHash({...original,title:'New title'},()=>undefined),hash);
  assert.notEqual(summaryContentHash({...original,blocks:[block('A different note.')]},()=>undefined),hash);
  const table={title:'My note',blocks:[block('',{type:'table',rows:[[[{text:'A cell'}],[{text:'Another cell'}]]]})]};
  const tableHash=summaryContentHash(table,()=>undefined);
  assert.notEqual(summaryContentHash({...table,blocks:[{...table.blocks[0],rows:[[[{text:'Changed cell'}],[{text:'Another cell'}]]]}]},()=>undefined),tableHash);
});
test('backend persists current and summary hashes; formatting stays fresh and reverting content restores freshness',()=>{
  const {db,pages,enrichments}=setup();
  try {
    let page=pages.create('default',{title:'Summary freshness'});
    page=pages.update('default',page.id,{...page,blocks:[block('Original text')]});
    enrichments.save('default',page.id,'summary',{summary:'Saved summary'},page.revision,preferences);
    const original=enrichments.list('default',page.id)[0];
    assert.equal(original.contentHash,page.summaryContentHash);
    assert.equal(db.prepare('SELECT summary_content_hash AS hash FROM pages WHERE id=?').get(page.id).hash,original.contentHash);
    page=pages.update('default',page.id,{...page,blocks:[block('Original text',{type:'quote',content:[{text:'Original ',bold:true},{text:'text',italic:true}]})]});
    assert.notEqual(page.revision,original.revision);
    assert.equal(page.summaryContentHash,original.contentHash);
    page=pages.update('default',page.id,{...page,blocks:[block('Changed text')]});
    assert.notEqual(page.summaryContentHash,original.contentHash);
    page=pages.update('default',page.id,{...page,blocks:[block('Original text')]});
    assert.equal(page.summaryContentHash,original.contentHash);
    page=pages.update('default',page.id,{...page,title:'Changed title'});
    assert.notEqual(page.summaryContentHash,original.contentHash);
    enrichments.save('default',page.id,'summary',{summary:'Updated summary'},page.revision,preferences);
    assert.equal(enrichments.list('default',page.id)[0].contentHash,page.summaryContentHash);
  } finally {db.close();}
});
test('freshness survives restart, and legacy summaries are backfilled only at their generating revision',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'noema-summary-hash-')),filename=path.join(dir,'test.sqlite');
  let state=setup(filename);
  try {
    let page=state.pages.create('default',{title:'Persisted fingerprint'});
    state.enrichments.save('default',page.id,'summary',{summary:'Saved'},page.revision,preferences);
    const hash=page.summaryContentHash;
    state.db.close();state=setup(filename);
    assert.equal(state.pages.get('default',page.id).summaryContentHash,hash);
    assert.equal(state.enrichments.list('default',page.id)[0].contentHash,hash);
    state.store.run('UPDATE page_ai_enrichments SET content_hash=NULL WHERE page_id=?',page.id);
    assert.equal(state.enrichments.list('default',page.id)[0].contentHash,hash);
    state.store.run('UPDATE page_ai_enrichments SET content_hash=NULL WHERE page_id=?',page.id);
    page=state.pages.update('default',page.id,{...page,title:'Edited later'});
    assert.equal(state.enrichments.list('default',page.id)[0].contentHash,null,'Older unknown content must not be assumed fresh');
  } finally {state.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('mentioned entity names invalidate cached fingerprints, while repeat reads reuse the cache',()=>{
  const {db,knowledge,pages,enrichments}=setup();
  try {
    const entity=knowledge.create('default',{name:'First name',type:'person'});
    let page=pages.create('default',{title:'Mention'});
    page=pages.update('default',page.id,{...page,blocks:[block('',{content:[{entityId:entity.id}]})]});
    enrichments.save('default',page.id,'summary',{summary:'About First name'},page.revision,preferences);
    const hash=page.summaryContentHash;
    const find=knowledge.find.bind(knowledge);let lookups=0;
    knowledge.find=(...args)=>{lookups++;return find(...args);};
    pages.get('default',page.id);pages.get('default',page.id);
    assert.equal(lookups,0,'Cached page reads do not rehash or resolve mention names');
    knowledge.update('default',entity.id,{...entity,name:'Second name'});
    assert.equal(db.prepare('SELECT summary_content_hash AS hash FROM pages WHERE id=?').get(page.id).hash,null);
    page=pages.get('default',page.id);
    assert.notEqual(page.summaryContentHash,hash);
    assert.equal(enrichments.list('default',page.id)[0].contentHash,hash);
  } finally {db.close();}
});

test('summary input and fingerprints exclude AI leaves and semantic children, including equations and tables',()=>{
 const original={title:'My note',blocks:[block('Original source')]},hash=summaryContentHash(original,()=>undefined);
 const generated=[block('Explanation',{id:'ai-leaf',semantic:'ai-explanation'}),block('Grouped answer',{id:'ai-child',semanticGroup:{id:'ai-parent',kind:'ai-explanation'}}),block('',{id:'ai-table',type:'table',semantic:'ai-explanation',rows:[[[{entityId:'ai-only-entity'}]]]}),block('x^2',{id:'ai-math',type:'math',semantic:'ai-explanation'})];
 const augmented={...original,blocks:[...original.blocks,...generated]};
 const resolve=id=>{throw new Error('AI-only mentions should not be resolved: '+id);};
 assert.equal(summaryContentHash(augmented,resolve),hash);assert.equal(summaryInput(augmented,resolve),'My note\nOriginal source\n');
 assert.equal(summaryContentHash({...augmented,blocks:[...generated.reverse(),...original.blocks]},resolve),hash);
 assert.notEqual(summaryContentHash({...original,blocks:[block('Edited original')]},resolve),hash);
 assert.notEqual(summaryContentHash({...original,title:'New title'},resolve),hash);
 assert.match(summaryInput(augmented,()=> 'AI-only name',false,true),/Grouped answer/,'explicit explanation requests can still explain generated blocks');
});
test('adding, editing, moving and deleting generated explanation blocks keep a saved summary fresh',()=>{
 const {db,pages,enrichments}=setup();try{
  let page=pages.create('default',{title:'Explained note'});page=pages.update('default',page.id,{...page,blocks:[block('Original source')]});
  enrichments.save('default',page.id,'summary',{summary:'Summary of source'},page.revision,preferences);
  const hash=page.summaryContentHash,group={id:'ai-parent',kind:'ai-explanation'};
  const ai=[block('AI explanation',{id:'ai-a',semantic:'ai-explanation',semanticGroup:group}),block('Example',{id:'ai-b',semantic:'ai-explanation',semanticGroup:group})];
  page=pages.update('default',page.id,{...page,blocks:[...page.blocks,...ai]});assert.equal(page.summaryContentHash,hash);
  page=pages.update('default',page.id,{...page,blocks:page.blocks.map(b=>b.id==='ai-a'?{...b,content:[{text:'Revised explanation'}]}:b)});assert.equal(page.summaryContentHash,hash);
  page=pages.update('default',page.id,{...page,blocks:[...page.blocks.slice(1),page.blocks[0]]});assert.equal(page.summaryContentHash,hash);
  page=pages.update('default',page.id,{...page,blocks:[page.blocks.at(-1)]});assert.equal(page.summaryContentHash,hash);assert.equal(enrichments.list('default',page.id)[0].contentHash,hash);
  page=pages.update('default',page.id,{...page,blocks:[block('Edited source')]});assert.notEqual(page.summaryContentHash,hash);
 }finally{db.close();}
});
test('legacy cached hashes migrate once, preserve current summaries, and keep truly stale summaries stale',()=>{
 const {db,store,pages,enrichments}=setup();try{
  let page=pages.create('default',{title:'Legacy AI content'});
  const blocks=[block('Original source'),block('AI explanation',{id:'ai',semantic:'ai-explanation'})];
  page=pages.update('default',page.id,{...page,blocks});
  enrichments.save('default',page.id,'summary',{summary:'Legacy summary'},page.revision,preferences);
  const hash=page.summaryContentHash,legacy=summaryContentHash(page,()=>undefined,true);assert.notEqual(legacy,hash);
  store.run('UPDATE pages SET summary_content_hash=?,summary_hash_version=1 WHERE id=?',legacy,page.id);
  store.run('UPDATE page_ai_enrichments SET content_hash=? WHERE page_id=?',legacy,page.id);
  page=pages.get('default',page.id);assert.equal(page.summaryContentHash,hash);assert.equal(enrichments.list('default',page.id)[0].contentHash,hash);
  assert.equal(store.get('SELECT summary_hash_version AS version FROM pages WHERE id=?',page.id).version,2);
  store.run('UPDATE pages SET summary_content_hash=?,summary_hash_version=1 WHERE id=?',legacy,page.id);
  store.run('UPDATE page_ai_enrichments SET content_hash=? WHERE page_id=?','different-source-hash',page.id);
  page=pages.get('default',page.id);assert.equal(page.summaryContentHash,hash);assert.equal(enrichments.list('default',page.id)[0].contentHash,'different-source-hash');
 }finally{db.close();}
});
