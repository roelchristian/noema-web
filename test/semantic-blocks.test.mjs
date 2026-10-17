import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {isAIExplanation,preserveAIExplanationTags,applySemantic,normalizeSemanticGroups,semanticRuns,removeSemanticGroup,retagSemanticGroup,reorderSemanticBlock,semanticDragItems} from '../src/shared/semantic-blocks.ts';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {Knowledge} from '../src/server/modules/knowledge.ts';
import {Pages} from '../src/server/modules/pages.ts';
import {VaultBackups} from '../src/server/modules/vault-backups.ts';
const block=(id,text=id)=>({id,type:'paragraph',checked:false,content:[{text,bold:true}]});
const parent={id:'parent',kind:'question'};

test('one selected block gains a semantic function without changing content or block formatting',()=>{
 const blocks=[block('a'),block('b')],next=applySemantic(blocks,['a'],'definition');
 assert.equal(next[0].semantic,'definition');assert.equal(next[0].content,blocks[0].content);assert.equal(next[0].id,'a');assert.equal(next[1],blocks[1]);assert.equal(blocks[0].semantic,undefined);
});
test('a multi-block semantic selection creates a parent with ordered subblocks',()=>{
 const blocks=[block('a'),{...block('b'),type:'heading2',semantic:'example'},block('c'),block('d')];
 const next=applySemantic(blocks,['b','c'],'question',()=>parent.id),runs=semanticRuns(next);
 assert.deepEqual(runs.map(run=>run.type),['block','group','block']);assert.equal(runs[1].kind,'question');assert.deepEqual(runs[1].blocks.map(b=>b.id),['b','c']);
 assert.equal(runs[1].blocks[0].type,'heading2');assert.equal(runs[1].blocks[0].semantic,'example');assert.equal(runs[1].blocks[0].content,blocks[1].content);
 assert.equal(retagSemanticGroup(next,parent.id,'definition')[1].semanticGroup.kind,'definition');
 const ungrouped=removeSemanticGroup(next,parent.id);assert.ok(ungrouped.every(b=>!b.semanticGroup));assert.equal(ungrouped[1].semantic,'example');assert.deepEqual(ungrouped.map(b=>b.content),blocks.map(b=>b.content));
});
test('regrouping part of an existing parent includes all its children without losing tags',()=>{
 const blocks=[block('a'),{...block('b'),semanticGroup:parent},{...block('c'),semanticGroup:parent},block('d')];
 const next=applySemantic(blocks,['c','d'],'evidence',()=> 'new-parent');
 assert.ok(next.slice(1).every(b=>b.semanticGroup.id==='new-parent'));assert.equal(next[0],blocks[0]);assert.deepEqual(next.map(b=>b.id),['a','b','c','d']);
});
test('normalization repairs group fragments and retains both parent and child functions',()=>{
 const blocks=[{...block('a'),semanticGroup:parent},{...block('b'),semanticGroup:parent},block('gap'),{...block('c'),semanticGroup:parent},{...block('d'),semanticGroup:parent}];
 const next=normalizeSemanticGroups(blocks,()=> 'split-parent');assert.equal(next[0].semanticGroup.id,'parent');assert.equal(next[3].semanticGroup.id,'split-parent');
 const [single]=normalizeSemanticGroups([{...block('single'),semanticGroup:parent}]);assert.equal(single.semantic,'question');assert.equal(single.semanticGroup,undefined);
 const child={...block('child'),semantic:'example',semanticGroup:parent};assert.equal(normalizeSemanticGroups([child])[0],child);
});
test('dragging a parent moves all subblocks atomically while child reordering retains its parent',()=>{
 const blocks=[block('a'),{...block('b'),semanticGroup:parent},{...block('c'),semanticGroup:parent},block('d')];
 assert.deepEqual(semanticDragItems(blocks,'parent').map(b=>b.id),['a','parent','d']);
 const moved=reorderSemanticBlock(blocks,'parent',null);assert.deepEqual(moved.map(b=>b.id),['a','d','b','c']);assert.equal(moved[2],blocks[1]);assert.equal(moved[3],blocks[2]);
 const child=reorderSemanticBlock(blocks,'c','b');assert.deepEqual(child.map(b=>b.id),['a','c','b','d']);assert.equal(child[1].semanticGroup.id,'parent');
 const adopted=reorderSemanticBlock(blocks,'a','c');assert.equal(adopted[1].id,'a');assert.equal(adopted[1].semanticGroup.id,'parent');
 const detached=reorderSemanticBlock(blocks,'b',null);assert.equal(detached.at(-1).semanticGroup,undefined);assert.equal(detached.find(b=>b.id==='c').semantic,'question');
 assert.equal(reorderSemanticBlock(blocks,'parent','b'),blocks,'cannot drop a group into itself');
});
test('semantic metadata survives saving, restarting and vault backup round trips',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'noema-semantic-')),filename=path.join(dir,'vault.sqlite');let db=openDatabase(filename);
 try{
  let store=new Store(db),pages=new Pages(store,new Knowledge(store)),page=pages.create('default',{title:'Semantic notes'});
  const blocks=applySemantic([{...block('definition'),semantic:'definition'},block('question'),{...block('math'),type:'math',content:[{text:'x^2'}]}],['question','math'],'question',()=>parent.id);
  blocks.push({...block('ai-answer'),semantic:'ai-explanation',semanticGroup:{id:'explanation-parent',kind:'ai-explanation'}});
  page=pages.update('default',page.id,{...page,blocks});assert.deepEqual(page.blocks,blocks);
  db.close();db=openDatabase(filename);store=new Store(db);pages=new Pages(store,new Knowledge(store));assert.deepEqual(pages.get('default',page.id).blocks,blocks);
  const backups=new VaultBackups(store),archive=await backups.export('default'),vault=await backups.import(archive.bytes,'Imported semantics');
  const imported=pages.list(vault.id).find(p=>p.title==='Semantic notes');assert.deepEqual(pages.get(vault.id,imported.id).blocks,blocks);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('server rejects unknown functions, malformed parents, collisions and discontiguous groups',()=>{
 const db=openDatabase(':memory:');
 try{
  const store=new Store(db),pages=new Pages(store,new Knowledge(store));
  for(const blocks of [
   [{...block('a'),semantic:'bogus'}],[{...block('a'),semanticGroup:null}],
   [{...block('a'),semanticGroup:{id:'g',kind:'bogus'}}],
   [{...block('a'),semanticGroup:{id:'a',kind:'question'}}],
   [{...block('a'),semanticGroup:parent},block('b'),{...block('c'),semanticGroup:parent}],
   [{...block('a'),semanticGroup:parent},{...block('b'),semanticGroup:{id:'parent',kind:'definition'}}],
  ])assert.throws(()=>pages.validateBlocks('default',blocks),e=>e.status===400);
 }finally{db.close();}
});

test('AI Explanation children cannot move independently; parents cannot be retagged or ungrouped',()=>{
 const group={id:'ai-parent',kind:'ai-explanation'},blocks=[{...block('a'),semantic:'ai-explanation',semanticGroup:group},{...block('b'),semantic:'ai-explanation',semanticGroup:group},block('c')];
 assert.deepEqual(applySemantic(blocks,['a'],'definition'),blocks);assert.deepEqual(applySemantic(blocks,['a','c'],'question'),blocks);
 assert.deepEqual(removeSemanticGroup(blocks,group.id),blocks);assert.deepEqual(retagSemanticGroup(blocks,group.id,'question'),blocks);
 const next=preserveAIExplanationTags(blocks,[{...blocks[0],semantic:undefined,semanticGroup:undefined}]);assert.equal(next[0].semantic,'ai-explanation');
 assert.equal(reorderSemanticBlock(blocks,'a',null),blocks);assert.deepEqual(semanticDragItems(blocks,'a'),[]);
 const moved=reorderSemanticBlock(blocks,group.id,null);assert.deepEqual(moved.map(b=>b.id),['c','a','b']);
 const inserted=reorderSemanticBlock(blocks,'c','b');assert.deepEqual(inserted.map(b=>b.id),['c','a','b']);assert.equal(inserted[0].semanticGroup,undefined);
 assert.equal(normalizeSemanticGroups([blocks[0]])[0].semanticGroup.id,group.id);
});
test('saving cannot strip AI provenance but permits deleting an explanation',()=>{
 const db=openDatabase(':memory:');try {
  const store=new Store(db),pages=new Pages(store,new Knowledge(store)),page=pages.create('default',{title:'Explained'});
  const group={id:'ai-parent',kind:'ai-explanation'};
  const saved=pages.update('default',page.id,{...page,blocks:[block('source'),{...block('answer'),semantic:'ai-explanation',semanticGroup:group}]});
  assert.throws(()=>pages.update('default',page.id,{...saved,blocks:saved.blocks.map(b=>({...b,semantic:undefined,semanticGroup:undefined}))}),/cannot be removed/);
  const edited=pages.update('default',page.id,{...saved,blocks:saved.blocks.map(b=>b.id==='answer'?{...b,content:[{text:'Edited answer'}]}:b)});assert.equal(edited.blocks[1].semantic,'ai-explanation');
  assert.equal(pages.update('default',page.id,{...edited,blocks:[edited.blocks[0]]}).blocks.length,1);
 }finally{db.close();}
});

test('explanation passage references persist after source edits and deletion',()=>{
 const db=openDatabase(':memory:');try {
  const store=new Store(db),pages=new Pages(store,new Knowledge(store));
  let page=pages.create('default',{title:'Passage'});
  const source={blockIds:['passage'],excerpt:'Original passage, before editing.'};
  const answer={...block('answer'),semantic:'ai-explanation',semanticGroup:{id:'explanation',kind:'ai-explanation',source}};
  page=pages.update('default',page.id,{...page,blocks:[block('passage',source.excerpt),answer]});
  assert.deepEqual(page.blocks[1].semanticGroup.source,source);
  page=pages.update('default',page.id,{...page,blocks:[answer]});
  assert.deepEqual(pages.get('default',page.id).blocks[0].semanticGroup.source,source);
  assert.throws(()=>pages.update('default',page.id,{...page,blocks:[{...answer,semanticGroup:{...answer.semanticGroup,source:{blockIds:'invalid',excerpt:'Passage'}}}]}),/Invalid explanation source/);
 }finally{db.close();}
});
