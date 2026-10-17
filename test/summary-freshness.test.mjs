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
import {summaryContentHash} from '../src/server/modules/summary-content.ts';

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
