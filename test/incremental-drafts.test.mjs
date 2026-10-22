import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PageDraftJournal} from '../src/client/state/page-draft-journal.ts';
import {PageSaver} from '../src/client/state/page-saver.ts';
import {immutableBlocks,immutablePage} from '../src/shared/immutable-blocks.ts';
function storage(){
 const data=new Map(),writes=[];
 return {data,writes,get length(){return data.size;},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,setItem(k,v){data.set(k,v);writes.push({k,v});},removeItem:k=>data.delete(k)};
}
const fixture=(count=200)=>({id:'note',vault_id:'synthetic',title:'Draft',revision:1,updated_at:'2026-10-21',sourceIds:[],blocks:immutableBlocks(Array.from({length:count},(_,i)=>({id:'b'+i,type:'paragraph',checked:false,content:[{text:'Synthetic text '+i}]})))});
const edit=(page,i,text)=>({...page,blocks:immutableBlocks(page.blocks.map((block,index)=>index===i?{...block,content:[{text}]}:block),page.blocks)});
const recovered=(store,page)=>new PageDraftJournal(store).entries(page.vault_id,page.id).find(entry=>entry.snapshot.title===page.title)?.snapshot;

test('continuous typing journals each final edit before any idle/save and keeps payload bounded',()=>{
 for(const count of [200,1000,2000]){
  const store=storage(),journal=new PageDraftJournal(store);let page=fixture(count);
  journal.prime(page);store.writes.length=0;
  for(let i=0;i<30;i++){
   page=edit(page,Math.floor(count/2),'continuous '+i);journal.writeIncremental(page);
   // Simulate abrupt process loss after every stroke, before any debounce.
   assert.deepEqual(recovered(store,page).blocks,page.blocks);
  }
  assert.equal(store.writes.length,30);
  assert.ok(store.writes.every(({v})=>JSON.parse(v).changed.length===1 && v.length<1200));
 }
});
test('overlay captures split/merge, reorder, nested annotations, metadata and undo to checkpoint',()=>{
 const store=storage(),journal=new PageDraftJournal(store),base=fixture(3);journal.prime(base);
 const variants=[
  {...base,blocks:immutableBlocks([{...base.blocks[0],content:[{entityId:'entity',mentionText:'Alias',bold:true,sourceReference:{id:'ref',sourceId:'source',fileId:'file',sourceHash:'hash',startLine:1,endLine:2}}]},...base.blocks.slice(1)])},
  {...base,title:'Renamed',sourceIds:['source'],featuredImageId:null,blocks:immutableBlocks([...base.blocks].reverse())},
  {...base,blocks:immutableBlocks([...base.blocks.slice(0,1),{...base.blocks[0],id:'split'},...base.blocks.slice(1)])},
  {...base,blocks:immutableBlocks(base.blocks.slice(1))},base,
 ];
 for(const page of variants){journal.writeIncremental(page);assert.deepEqual(recovered(store,page).blocks,page.blocks);assert.equal(recovered(store,page).title,page.title);}
});
test('late acknowledgement cannot delete newer overlay or another writer; cleanup removes overlays',()=>{
 const store=storage(),journal=new PageDraftJournal(store),other=new PageDraftJournal(store),base=fixture(3);
 journal.prime(base);const first=journal.writeIncremental(edit(base,1,'first'));
 journal.markSent(first,first.snapshot);
 const second=journal.writeIncremental(edit(first.snapshot,1,'last'));
 const competing=other.write({...base,title:'Other tab'});
 journal.discard(first);
 let entries=new PageDraftJournal(store).entries(base.vault_id,base.id);
 assert.ok(entries.some(entry=>entry.id===second.id));assert.ok(entries.some(entry=>entry.id===competing.id));
 journal.discardPage(base.vault_id,base.id);assert.equal(store.length,0);
 journal.writeIncremental(base);assert.deepEqual(recovered(store,base).blocks,base.blocks);
});
test('corrupt or stale overlays retain the complete checkpoint; v1 drafts still recover',()=>{
 const store=storage(),journal=new PageDraftJournal(store),base=fixture(3);journal.prime(base);
 const key=[...store.data.keys()][0];
 for(const value of ['{broken',JSON.stringify({version:2,baseId:'stale',changed:[]}),JSON.stringify({version:2,baseId:JSON.parse(store.getItem(key)).id,entry:{snapshot:{}},changed:[],order:['missing']})]){
  store.setItem(key+':delta:bad',value);assert.deepEqual(recovered(store,base).blocks,base.blocks);
 }
 store.removeItem(key+':delta:bad');assert.deepEqual(recovered(store,base).blocks,base.blocks);
});
test('quota failure retains in-memory final edit and reports failure; retry recovers it',()=>{
 const store=storage(),journal=new PageDraftJournal(store),base=fixture(3);journal.prime(base);
 const original=store.setItem;store.setItem=()=>{throw Error('Quota exceeded');};
 const final=edit(base,1,'final');assert.throws(()=>journal.writeIncremental(final),/Quota/);
 assert.deepEqual(journal.entries(base.vault_id,base.id)[0].snapshot.blocks,final.blocks);
 store.setItem=original;journal.writeIncremental(final);assert.deepEqual(recovered(store,final).blocks,final.blocks);
});
test('saver preserves typing during pending async preparation and writes latest revision',async()=>{
 const store=storage(),journal=new PageDraftJournal(store),base=fixture(3);let resume,prepares=0;const sent=[];
 const saver=new PageSaver(async page=>{sent.push(page);return {...page,revision:page.revision+1};},()=>{},()=>{},async page=>{if(++prepares===1)await new Promise(resolve=>resume=resolve);return page;},()=>{},journal);
 try{
  saver.prime(base);saver.enqueue(edit(base,1,'first'));const saving=saver.flush();
  const final=edit(base,1,'final');saver.enqueue(final);assert.deepEqual(recovered(store,final).blocks,final.blocks);
  resume();await saving;assert.equal(sent.length,1);assert.deepEqual(sent[0].blocks,final.blocks);
  // Boundary checkpoint is saved content; another immediate key still uses a delta.
  store.writes.length=0;saver.enqueue(edit({...final,revision:2},1,'next'));
  assert.equal(JSON.parse(store.writes.at(-1).v).version,2);
  assert.equal(JSON.parse(store.writes.at(-1).v).changed.length,1);
 }finally{saver.dispose();}
});

test('editing many blocks does not reserialize earlier dirty blocks on the next key',()=>{
 const store=storage(),journal=new PageDraftJournal(store);let page=fixture(200);journal.prime(page);
 for(let i=0;i<100;i++){page=edit(page,i,'Changed '+i);journal.writeIncremental(page);}
 store.writes.length=0;page=edit(page,100,'Last key');journal.writeIncremental(page);
 assert.equal(JSON.parse(store.writes[0].v).changed.length,1);assert.ok(store.writes[0].v.length<1000);
 assert.deepEqual(recovered(store,page).blocks,page.blocks);
 // Revisit a block around intervening structural operations; replay order must
 // remain correct when its earlier single-block slot is replaced.
 page={...page,blocks:immutableBlocks([...page.blocks].reverse())};journal.writeIncremental(page);
 page=edit(page,199,'Revisited');journal.writeIncremental(page);
 assert.deepEqual(recovered(store,page).blocks,page.blocks);
});


test('large unchanged metadata is adopted once and shared with pending edit snapshots',()=>{
 const metadata={revision:1,key:'synthetic',matches:Array.from({length:1000},(_,i)=>({id:'m'+i,context:'Synthetic context'}))};
 const initial=immutablePage({...fixture(200),entityMatchCache:metadata});
 metadata.matches[0].context='Mutated caller';
 assert.equal(initial.entityMatchCache.matches[0].context,'Synthetic context');
 let clones=0;const original=globalThis.structuredClone;globalThis.structuredClone=(...args)=>{clones++;return original(...args);};
 try {
  const next=immutablePage(edit(initial,100,'Next key'));
  assert.equal(next.entityMatchCache,initial.entityMatchCache);
  assert.equal(clones,1,'only the changed block is cloned');
  assert.throws(()=>{next.entityMatchCache.matches[0].context='Mutated snapshot';},TypeError);
 }finally{globalThis.structuredClone=original;}
});
