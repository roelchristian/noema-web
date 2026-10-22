import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {projectEntityMentions} from '../src/shared/entity-mentions.ts';
import {projectPageText} from '../src/shared/page-text.ts';
import {entityMentionName} from '../src/shared/domain.ts';
import {validateEntityMention} from '../src/client/search/entity-mention-navigation.ts';
import {entityPageMentions} from '../src/server/modules/entity-page-mentions.ts';
import {Store} from '../src/server/store.ts';

const entity={id:'ada',vault_id:'v',name:'Ada',mentionCase:'lowercase',type:'person',subtypes:[],description:'',updated_at:''};
const name=id=>id==='ada'?entityMentionName(entity):undefined;
const block=(id,type,content=[],rows)=>({id,type,content,rows,checked:false});
const page={id:'p',vault_id:'v',title:'History',updated_at:'',sourceIds:[],revision:3,blocks:[
 block('h','heading1',[{text:'History'}]),
 block('a','paragraph',[{text:'😀 Ada unlinked; '},{entityId:'ada'},{text:' met '},{entityId:'ada'},{text:'.'}]),
 block('h2','heading2',[{text:'Tables'}]),
 block('t','table',[],[[[{text:'😀 '},{entityId:'ada',mentionText:'A. Lovelace'}],[{entityId:'ada'}]],[[{text:'Another'}],[{entityId:'ada'}]]]),
 block('c','columns',[],[[[{text:'Column one'}],[{entityId:'ada'},{text:' and '},{entityId:'ada'}]]]),
]};

test('explicit mentions preserve unique UTF-16 occurrence offsets, table separators and heading ancestry',()=>{
 const contexts=projectEntityMentions(page,'ada',name),projection=projectPageText(page.blocks,name);
 assert.equal(contexts.length,3);assert.deepEqual(contexts.map(context=>context.heading),[['History'],['History','Tables'],['History','Tables']]);
 const occurrences=contexts.flatMap(context=>context.occurrences);
 assert.equal(occurrences.length,7);assert.equal(new Set(occurrences.map(occurrence=>occurrence.id)).size,7);
 for(const {reference,label} of occurrences){assert.equal(projection.text.slice(reference.startOffset,reference.endOffset),label);assert.equal(validateEntityMention(reference,page,[entity]),true);}
 assert.equal(occurrences[0].reference.startOffset,'History\n😀 Ada unlinked; '.length);
 assert.equal(occurrences[1].reference.startOffset,occurrences[0].reference.endOffset+' met '.length);
 assert.deepEqual([occurrences[4].reference.row,occurrences[4].reference.column],[1,1]);
 assert.deepEqual([occurrences[6].reference.row,occurrences[6].reference.column,occurrences[6].reference.segmentIndex],[0,1,2]);
});

test('navigation rejects stale revisions, renamed canonical labels, foreign entities and altered occurrence paths',()=>{
 const contexts=projectEntityMentions(page,'ada',name),first=contexts[0].occurrences[0].reference,custom=contexts[1].occurrences[0].reference;
 assert.equal(validateEntityMention(first,{...page,revision:4},[entity]),false);
 assert.equal(validateEntityMention(first,page,[{...entity,name:'Ada Byron'}]),false);
 assert.equal(validateEntityMention(first,page,[{...entity,vault_id:'other'}]),false);
 assert.equal(validateEntityMention({...first,pageId:'other'},page,[entity]),false);
 assert.equal(validateEntityMention({...first,segmentIndex:3},page,[entity]),false);
 assert.equal(validateEntityMention({...first,startOffset:first.startOffset-1},page,[entity]),false);
 assert.equal(validateEntityMention({...custom,row:1},page,[entity]),false);
 assert.equal(validateEntityMention({...custom,column:0.5},page,[entity]),false);
 const customOnly={...page,blocks:[block('custom','paragraph',[{entityId:'ada',mentionText:'Countess'}])]};
 const customReference=projectEntityMentions(customOnly,'ada',name)[0].occurrences[0].reference;
 assert.equal(validateEntityMention(customReference,customOnly,[{...entity,name:'Renamed'}]),true);
});

test('server uses indexed candidates and skips trash, foreign pages, phantom candidates and plain names',()=>{
 const db=new DatabaseSync(':memory:'),store=new Store(db);
 try {
  db.exec('CREATE TABLE entities(id TEXT,vault_id TEXT,name TEXT,mention_case TEXT); CREATE TABLE pages(id TEXT,title TEXT,icon TEXT,updated_at TEXT,revision INTEGER,blocks TEXT,vault_id TEXT,deleted_at TEXT); CREATE TABLE page_mentioned_entities(page_id TEXT,entity_id TEXT)');
  store.run('INSERT INTO entities VALUES(?,?,?,?)','ada','v','Ada','lowercase');
  for(const [id,vault,deleted,blocks] of [['p','v',null,page.blocks],['trash','v','deleted',page.blocks],['foreign','other',null,page.blocks],['phantom','v',null,[block('a','paragraph',[{text:'Ada ada'}])]]]){
   store.run('INSERT INTO pages VALUES(?,?,?,?,?,?,?,?)',id,'History',null,'2026',3,JSON.stringify(blocks),vault,deleted);
   store.run('INSERT INTO page_mentioned_entities VALUES(?,?)',id,'ada');
  }
  const result=entityPageMentions(store,'v','ada');assert.equal(result.length,1);assert.equal(result[0].id,'p');assert.equal(result[0].mentionCount,7);
  assert.match(result[0].contexts[0].occurrences[0].reference.projectionHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(entityPageMentions(store,'other','ada'),[]);
 } finally {db.close();}
});

test('highlighter selects the requested first and later DOM occurrence, including tables and columns',async t=>{
 const {setupDOM}=await import('./helpers/dom.mjs');
 const {highlightPagePassage}=await import('../src/client/search/page-passage-highlight.ts');
 const env=setupDOM(t,{html:'<div id="content"></div>'}),root=document.querySelector('#content');
 const globals=['CSS','Highlight','matchMedia'],previous=globals.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 const highlights=new Map();
 Object.defineProperty(globalThis,'CSS',{configurable:true,value:{escape:value=>value,highlights}});
 Object.defineProperty(globalThis,'Highlight',{configurable:true,value:class {constructor(...ranges){this.ranges=ranges;}}});
 Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:()=>({matches:true})});
 env.dom.window.scrollBy=()=>{};
 env.dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 t.after(()=>globals.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];}));
 const targets=new Map();
 for(const block of page.blocks){
  const wrapper=document.createElement('div');wrapper.dataset.blockId=block.id;root.append(wrapper);
  const render=(segments,row,column)=>{
   const surface=document.createElement('div');surface.className='block-content';wrapper.append(surface);
   segments.forEach((segment,index)=>{if(segment.entityId){const span=document.createElement('span');span.className='mention';span.dataset.entity=segment.entityId;span.textContent=segment.mentionText??name(segment.entityId);surface.append(span);targets.set(JSON.stringify([block.id,row,column,index]),span);}else surface.append(document.createTextNode(segment.text));});
  };
  if(block.type==='table'||block.type==='columns')block.rows.forEach((row,i)=>row.forEach((cell,j)=>render(cell,i,j)));
  else render(block.content);
 }
 const occurrences=projectEntityMentions(page,'ada',name).flatMap(context=>context.occurrences);
 for(const {reference} of occurrences){
  const cleanup=highlightPagePassage(reference,page,[entity]);
  const range=highlights.get('page-search-evidence').ranges[0],target=targets.get(JSON.stringify([reference.blockId,reference.row??null,reference.column??null,reference.segmentIndex]));
  assert.equal(range.startContainer,target);assert.equal(range.toString(),reference.excerpt);cleanup();assert.equal(highlights.size,0);
 }
 highlightPagePassage({...occurrences[0].reference,revision:1},page,[entity]);assert.equal(highlights.size,0);assert.equal(document.querySelector('.page-search-passage'),null);
 await env.close();
});

test('distant mentions in one block receive separate nearby context windows without truncating labels or astral text',()=>{
 const label='A'.repeat(200),long={...page,blocks:[block('long','paragraph',[{text:'😀'.repeat(100)},{entityId:'ada',mentionText:label},{text:' first context. '+'.'.repeat(400)+' second context '},{entityId:'ada'},{text:' near '},{entityId:'ada'},{text:'😀'.repeat(100)}])]};
 const contexts=projectEntityMentions(long,'ada',name);
 assert.equal(contexts.length,2);assert.deepEqual(contexts.map(context=>context.blockId),['long','long']);assert.deepEqual(contexts.map(context=>context.occurrences.length),[1,2]);
 assert.ok(contexts[0].excerpt.includes(label));assert.match(contexts[1].excerpt,/second context ada near ada/);
 assert.ok(contexts.every(context=>context.excerpt.length<600));
 for(const context of contexts)assert.equal(context.excerpt.isWellFormed(),true);
 assert.equal(new Set(contexts.map(context=>context.occurrences[0].id)).size,2);
});
