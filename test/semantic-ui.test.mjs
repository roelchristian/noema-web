import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM} from './helpers/dom.mjs';
import {api} from '../src/client/api.ts';
import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BlockEditor} from '../src/client/editor/BlockEditor.tsx';
import {clipboardBlocks} from '../src/client/editor/paste.ts';
import {editorSelectionClipboard} from '../src/client/editor/block-selection.ts';
const block=(id,text)=>({id,type:'paragraph',checked:false,content:[{text}]});
async function fixture(t,blocks,onExplain){
 const env=setupDOM(t,{rect:{left:100,right:350,top:200,bottom:240,width:250,height:40}}),{dom}=env;
 const originalSchema=api.entitySchema;api.entitySchema=async()=>({properties:[],subtypes:[],subtypeProperties:{}});
 env.defer(()=>{api.entitySchema=originalSchema;});
 // Explicit trailing typing surface keeps the scenario selection separate from editor padding.
 blocks=[...blocks,block('fixture-tail','')];
 let current=blocks;
 function App(){const [value,setValue]=useState(blocks);return React.createElement(BlockEditor,{onExplain,vaultId:'default',blocks:value,entities:[],onChange:next=>{current=next;setValue(next);},onOpenEntity:()=>{},onCreateEntity:()=>{},onSave:()=>{},onAddAlias:async()=>{}});}
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));await act(async()=>root.render(React.createElement(App)));
 async function click(node){assert.ok(node,'expected control');await act(async()=>node.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,cancelable:true})));}
 function select(){const contents=document.querySelectorAll('[data-block-id]:not([data-block-id="fixture-tail"]) .block-content'),range=document.createRange();range.setStart(contents[0],0);range.setEnd(contents[contents.length-1],contents[contents.length-1].childNodes.length);document.getSelection().removeAllRanges();document.getSelection().addRange(range);return range;}
 return {dom,current:()=>current,click,select,close:env.close};
}
test('block options apply a colored semantic function without changing editable text',async t=>{
 const f=await fixture(t,[block('a','A definition')]);try{
  await f.click(document.querySelector('.block-handle'));
  await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Semantic function')));
  await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Definition')));
  assert.equal(f.current()[0].semantic,'definition');assert.equal(document.querySelector('.block-content').textContent,'A definition');
  const tagged=document.querySelector('.semantic-block');assert.equal(tagged.dataset.semanticKind,'definition');assert.match(tagged.style.getPropertyValue('--semantic-color'),/^#/);assert.equal(tagged.querySelector('.block-handle').getAttribute('aria-label'),'Definition block options');assert.ok(tagged.querySelector('.semantic-function-icon'));assert.ok(tagged.querySelector('.semantic-grip-icon'));
 }finally{await f.close();}
});
test('selecting multiple blocks creates a semantic parent, which can be retagged and ungrouped',async t=>{
 const f=await fixture(t,[block('a','First subblock'),block('b','Second subblock')]);try{
  await act(async()=>{f.select();document.dispatchEvent(new Event('selectionchange'));});
  await f.click(document.querySelector('.block-handle'));
  await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Semantic function')));
  await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Question')));
  const group=document.querySelector('[data-block-group-id]');assert.ok(group);assert.equal(group.querySelectorAll('[data-block-id]').length,2);assert.deepEqual(f.current().map(b=>b.content[0].text),['First subblock','Second subblock','']);
  assert.ok(f.current().filter(b=>b.id!=='fixture-tail').every(b=>b.semanticGroup.kind==='question'));await f.click(group.querySelector('[data-semantic-parent-handle]'));
  await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Evidence')));assert.ok(f.current().filter(b=>b.id!=='fixture-tail').every(b=>b.semanticGroup.kind==='evidence'));
  await f.click(document.querySelector('[data-semantic-parent-handle]'));
  await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Ungroup blocks')));assert.equal(document.querySelector('[data-block-group-id]'),null);assert.ok(f.current().every(b=>!b.semanticGroup));
 }finally{await f.close();}
});
test('copy and paste preserve semantic parents, child tags and unique group ownership',async t=>{
 const parent={id:'original-parent',kind:'question'},blocks=[{...block('a','A'),semantic:'definition',semanticGroup:parent},{...block('b','B'),semanticGroup:parent}];
 const f=await fixture(t,blocks);try{
  f.select();const data=editorSelectionClipboard(document.querySelector('#blocks'),f.current(),[]),pasted=clipboardBlocks(data.text,data.html);
  assert.equal(pasted[0].semantic,'definition');assert.equal(pasted[0].semanticGroup.kind,'question');assert.equal(pasted[0].semanticGroup.id,pasted[1].semanticGroup.id);assert.notEqual(pasted[0].semanticGroup.id,parent.id);assert.deepEqual(pasted.map(b=>b.content[0].text),['A','B']);
 }finally{await f.close();}
});

test('a semantic parent handle reorders all child blocks as one unit',async t=>{
 const group={id:'g',kind:'example'},blocks=[block('a','Before'),{...block('b','Child one'),semanticGroup:group},{...block('c','Child two'),semanticGroup:group},block('d','After')];
 const f=await fixture(t,blocks);try{
  const handle=document.querySelector('[data-semantic-parent-handle]');
  async function key(value){await act(async()=>handle.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true})));}
  await key(' ');await key('ArrowDown');await key('Enter');
  assert.deepEqual(f.current().map(b=>b.id),['a','d','b','c','fixture-tail']);assert.equal(document.querySelector('[data-block-group-id]').querySelectorAll('[data-block-id]').length,2);
  assert.deepEqual(f.current().slice(2,4).map(b=>b.content[0].text),['Child one','Child two']);
 }finally{await f.close();}
});

test('document selection can group equation and image blocks without text editing hosts',async t=>{
 const blocks=[{...block('math','x^2'),type:'math'},{...block('image',''),type:'image',imageId:'example.png',alt:'Diagram'}];
 const f=await fixture(t,blocks);try{
  await act(async()=>{const range=document.createRange();const first=document.querySelector('[data-block-id="math"]'),last=document.querySelector('[data-block-id="image"]');range.setStartBefore(first);range.setEndAfter(last);document.getSelection().removeAllRanges();document.getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await f.click(document.querySelector('.block-handle'));
  await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Semantic function')));
  await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Example')));
  assert.equal(f.current()[0].type,'math');assert.equal(f.current()[1].imageId,'example.png');assert.ok(f.current().filter(b=>b.id!=='fixture-tail').every(b=>b.semanticGroup.kind==='example'));assert.equal(document.querySelector('[data-block-group-id]').querySelectorAll('[data-block-id]').length,2);
 }finally{await f.close();}
});

test('Explain with AI on selected blocks inserts one locked semantic parent with formatted subblocks',async t=>{
 let finish,calls=0,received;
 const f=await fixture(t,[block('a','First idea'),block('b','Second idea')],blocks=>{calls++;received=blocks;return new Promise(resolve=>finish=resolve);});
 try {
  await act(async()=>{f.select();document.dispatchEvent(new Event('selectionchange'));});
  await f.click(document.querySelector('.block-handle'));await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('AI actions')));await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Explain with AI')));
  assert.equal(calls,1);assert.deepEqual(received.map(b=>b.id),['a','b']);assert.match(document.body.textContent,/Explaining selected blocks/);
  await f.click(document.querySelector('.block-handle'));
  await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('AI actions')));
  const busy=Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.includes('Explaining'));assert.ok(busy);await f.click(busy);
  assert.equal(calls,1);
  await act(async()=>finish('The ideas connect.\n\n- A concrete example\n\n\\[x^2\\]'));
  const next=f.current();assert.deepEqual(next.slice(0,2).map(b=>b.content[0].text),['First idea','Second idea']);
  assert.equal(next.length,6);assert.ok(next.slice(2,5).every(b=>b.semantic==='ai-explanation'&&b.semanticGroup.kind==='ai-explanation'));
  const group=document.querySelector('[data-block-group-id]');assert.equal(group.querySelectorAll('[data-block-id]').length,3);assert.equal(next[4].type,'math');
  assert.equal(document.querySelector('.ai-explanation-label').textContent,'AI explanation');
  await f.click(group.querySelector('[data-semantic-parent-handle]'));
  assert.ok(!document.querySelector('.command-menu').textContent.includes('Ungroup'));assert.ok(!document.querySelector('.command-menu').textContent.includes('Definition'));
  assert.equal(group.querySelector('[data-block-id] .block-handle'),null);
  assert.equal(group.querySelector('[contenteditable="true"]'),null);
  assert.equal(group.querySelector('.ai-explanation-source blockquote').textContent,'First idea Second idea');
  assert.ok(group.querySelector('details[open] > summary'));
 } finally {await f.close();}
});
test('block handle explains its own block and failed generation can retry without inserting a placeholder',async t=>{
 let calls=0;
 const f=await fixture(t,[block('a','Only this'),block('b','Other block')],async selected=>{assert.deepEqual(selected.map(b=>b.id),['a']);if(++calls===1)throw new Error('Provider unavailable');return 'An explanation';});
 try {
  await f.click(document.querySelector('.block-handle'));await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('AI actions')));await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Explain with AI')));
  assert.equal(f.current().length,3);assert.match(document.querySelector('[role="alert"]').textContent,/Provider unavailable/);
  await f.click(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry'));
  assert.equal(f.current().length,4);assert.equal(f.current()[1].semanticGroup.kind,'ai-explanation');assert.equal(f.current()[2].id,'b');
 } finally {await f.close();}
});
test('generation discards changed source blocks and never inserts after unmount',async t=>{
 let finish;
 const f=await fixture(t,[block('a','Original')],()=>new Promise(resolve=>finish=resolve));
 try {
  await f.click(document.querySelector('.block-handle'));await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('AI actions')));await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Explain with AI')));
  await act(async()=>{const el=document.querySelector('.block-content');el.textContent='Edited while waiting';el.dispatchEvent(new f.dom.window.InputEvent('input',{bubbles:true}));});
  await act(async()=>finish('Stale explanation'));
  assert.equal(f.current().length,2);assert.equal(f.current()[0].content[0].text,'Edited while waiting');assert.match(document.querySelector('[role="alert"]').textContent,/selected blocks changed/);
 } finally {await f.close();}
 const other=await fixture(t,[block('a','Navigated away')],()=>new Promise(resolve=>finish=resolve));
 await other.click(document.querySelector('.block-handle'));await other.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('AI actions')));await other.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Explain with AI')));
 await other.close();finish('Late response');await new Promise(resolve=>setImmediate(resolve));assert.equal(other.current().length,2);
});
test('explanations preserve unrelated edits and remain outside the selected semantic parent',async t=>{
 let finish;
 const group={id:'source-parent',kind:'question'};
 const f=await fixture(t,[{...block('a','Question one'),semanticGroup:group},{...block('b','Question two'),semanticGroup:group},block('c','Unrelated')],()=>new Promise(resolve=>finish=resolve));
 try {
  await f.click(document.querySelector('[data-block-id="a"] .block-handle'));await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('AI actions')));await f.click(Array.from(document.querySelectorAll('.command-menu button')).find(b=>b.textContent.startsWith('Explain with AI')));
  await act(async()=>{const el=document.querySelector('[data-block-id="c"] .block-content');el.textContent='Keep this edit';el.dispatchEvent(new f.dom.window.InputEvent('input',{bubbles:true}));});
  await act(async()=>finish('Explanation'));
  assert.deepEqual(f.current().map(b=>b.id).slice(0,2),['a','b']);assert.equal(f.current()[2].semanticGroup.kind,'ai-explanation');assert.equal(f.current()[3].content[0].text,'Keep this edit');
 } finally {await f.close();}
});
