import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installBlockSelection,selectedEditorBlocks,editorSelectionClipboard,replaceEditorSelection,editorSelectionRanges,setEditorCaret} from '../src/client/editor/block-selection.ts';
import {segmentHTML} from '../src/client/editor/segments.tsx';
const paragraph=(id,text,type='paragraph')=>({id,type,checked:false,content:[{text}]});
function fixture(blocks){
 const dom=new JSDOM('<div id="blocks"></div>'),keys=['window','document','Node','Element','HTMLElement','Range'],prior=keys.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));
 keys.forEach(k=>Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:dom.window[k]}));
 const root=document.querySelector('#blocks'),state={blocks,focus:null};
 root.innerHTML=blocks.map(b=>`<div data-block-id="${b.id}"><div class="block-controls"><button>Block options</button></div>${b.type==='table'?'<table>'+b.rows.map(row=>'<tr>'+row.map(c=>'<td><div class="block-content table-cell" contenteditable="true">'+segmentHTML(c,[])+'</div></td>').join('')+'</tr>').join('')+'</table>':'<div class="block-content" contenteditable="true">'+segmentHTML(b.content,[])+'</div>'}</div>`).join('');
 const options={blocks:()=>state.blocks,entities:()=>[],commit:(blocks,focus)=>{state.blocks=blocks;state.focus=focus;}};
 const cleanup=installBlockSelection(root,options);
 function select(start,from,end,to){const range=document.createRange();range.setStart(document.createTreeWalker(root.querySelector(`[data-block-id="${start}"] .block-content`),4).nextNode(),from);range.setEnd(document.createTreeWalker(root.querySelector(`[data-block-id="${end}"] .block-content`),4).nextNode(),to);document.getSelection().removeAllRanges();document.getSelection().addRange(range);return range;}
 const fire=(id,key,extra={})=>{const event=new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra});root.querySelector(`[data-block-id="${id}"] .block-content`).dispatchEvent(event);return event;};
 return {dom,root,state,options,select,fire,close(){cleanup();dom.window.close();keys.forEach((k,i)=>{if(prior[i])Object.defineProperty(globalThis,k,prior[i]);else delete globalThis[k];});}};
}
test('Command-A selects the current block, then document, and stays within the editor',()=>{
 const f=fixture([paragraph('a','Alpha'),paragraph('b','Bravo'),paragraph('c','Charlie')]);
 try{
  f.select('b',2,'b',2);
  assert.ok(f.fire('b','a',{metaKey:true}).defaultPrevented);assert.equal(document.getSelection().toString(),'Bravo');
  f.fire('b','a',{metaKey:true});assert.equal(selectedEditorBlocks(f.root).elements.length,3);
  assert.deepEqual(editorSelectionClipboard(f.root,f.state.blocks,[]).text,'Alpha\n\nBravo\n\nCharlie');
  assert.doesNotMatch(editorSelectionClipboard(f.root,f.state.blocks,[]).html,/Block options/);
  f.fire('b','a',{metaKey:true});assert.equal(selectedEditorBlocks(f.root).elements.length,3);
  f.select('a',1,'a',1);f.fire('a','a',{ctrlKey:true});assert.equal(document.getSelection().toString(),'Alpha');
 }finally{f.close();}
});
test('moving the caret or pressing another key resets progressive Select All',()=>{
 const f=fixture([paragraph('a','Alpha'),paragraph('b','Bravo')]);
 try{f.select('a',0,'a',0);f.fire('a','a',{metaKey:true});f.fire('a','ArrowLeft');f.fire('a','a',{metaKey:true});assert.equal(document.getSelection().toString(),'Alpha');}finally{f.close();}
});
test('cross-block ranges copy only selected text and formatting, and deletion merges unselected edges',()=>{
 const first=paragraph('a','Alpha');first.content[0].bold=true;
 const f=fixture([first,paragraph('b','Middle','heading1'),paragraph('c','Charlie')]);
 try{
  f.select('a',2,'c',3);
  assert.deepEqual(selectedEditorBlocks(f.root).elements.map(e=>e.dataset.blockId),['a','b','c']);
  assert.deepEqual(editorSelectionRanges(f.root,document.getSelection().getRangeAt(0)).map(r=>r.toString()),['pha','Middle','Cha']);
  const copied=editorSelectionClipboard(f.root,f.state.blocks,[]);assert.equal(copied.text,'pha\n\nMiddle\n\nCha');assert.match(copied.html,/<strong>pha<\/strong>/);assert.match(copied.html,/<h2 data-noema-block-type="heading1">/);
  assert.ok(f.fire('a','Backspace').defaultPrevented);assert.equal(f.state.blocks.length,1);
  assert.equal(f.state.blocks[0].content.map(s=>s.text).join(''),'Alrlie');assert.ok(f.state.blocks[0].content[0].bold);
  assert.deepEqual(f.state.focus,{id:'a',offset:2});
 }finally{f.close();}
});
test('typing, cutting and pasting replace cross-block selections without deleting editor containers',()=>{
 for(const action of ['type','cut','paste']){
  const f=fixture([paragraph('a','Alpha'),paragraph('b','Bravo')]);
  try{
   f.select('a',2,'b',3);const host=f.root.querySelector('.block-content');
   if(action==='type'){const event=new f.dom.window.InputEvent('beforeinput',{inputType:'insertText',data:'X',bubbles:true,cancelable:true});host.dispatchEvent(event);assert.ok(event.defaultPrevented);}
   else {
    const values=new Map(action==='paste'?[['text/plain','NEW'],['text/html','']]:[]);
    const event=new f.dom.window.Event(action,{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{files:[],getData:key=>values.get(key)||'',setData:(key,value)=>values.set(key,value)}});host.dispatchEvent(event);assert.ok(event.defaultPrevented);
    if(action==='cut')assert.equal(values.get('text/plain'),'pha\n\nBra');
   }
   assert.equal(f.state.blocks.length,1);assert.equal(f.state.blocks[0].content.map(s=>s.text).join(''),action==='type'?'AlXvo':action==='paste'?'AlNEWvo':'Alvo');
   assert.equal(f.root.querySelectorAll('[data-block-id]').length,2,'DOM remains under React ownership');
  }finally{f.close();}
 }
});
test('Select All then deletion leaves an editable empty paragraph',()=>{
 const f=fixture([paragraph('a','Alpha'),paragraph('b','Bravo')]);
 try{f.select('a',0,'a',0);f.fire('a','a',{metaKey:true});f.fire('a','a',{metaKey:true});f.fire('a','Delete');assert.equal(f.state.blocks.length,1);assert.equal(f.state.blocks[0].type,'paragraph');assert.deepEqual(f.state.blocks[0].content,[]);}finally{f.close();}
});
test('a selection ending at a block start does not include that block',()=>{
 const f=fixture([paragraph('a','Alpha'),paragraph('b','Bravo')]);
 try{f.select('a',0,'b',0);assert.equal(editorSelectionClipboard(f.root,f.state.blocks,[]).text,'Alpha');}finally{f.close();}
});
test('pointer drags cross independent editing hosts in both directions',()=>{
 for(const reverse of [false,true]){
  const f=fixture([paragraph('a','Alpha'),paragraph('b','Bravo')]);
  try{
   document.caretRangeFromPoint=(x)=>{const range=document.createRange(),text=f.root.querySelector(`[data-block-id="${x<100?'a':'b'}"] .block-content`).firstChild.firstChild;range.setStart(text,2);range.collapse(true);return range;};
   const start=reverse?'b':'a',end=reverse?'a':'b';
   f.root.querySelector(`[data-block-id="${start}"] .block-content`).dispatchEvent(new f.dom.window.MouseEvent('pointerdown',{button:0,buttons:1,clientX:reverse?150:50,bubbles:true}));
   const move=new f.dom.window.MouseEvent('pointermove',{buttons:1,clientX:reverse?50:150,bubbles:true,cancelable:true});document.dispatchEvent(move);
   assert.ok(move.defaultPrevented);assert.equal(selectedEditorBlocks(f.root).elements.length,2);assert.equal(document.getSelection().anchorNode.parentElement.closest('[data-block-id]').dataset.blockId,start);assert.equal(document.getSelection().focusNode.parentElement.closest('[data-block-id]').dataset.blockId,end);
  }finally{f.close();}
 }
});
test('partial table selections preserve unselected cells when deleting across blocks',()=>{
 const table={id:'table',type:'table',checked:false,content:[],rows:[[[{text:'First'}],[{text:'Second'}]]]};
 const f=fixture([table,paragraph('b','Bravo')]);
 try{
  const range=document.createRange(),cells=f.root.querySelectorAll('.table-cell');range.setStart(cells[1].firstChild.firstChild,3);range.setEnd(f.root.querySelector('[data-block-id="b"] .block-content').firstChild.firstChild,3);document.getSelection().addRange(range);
  assert.ok(replaceEditorSelection(f.root,f.options));assert.equal(f.state.blocks[0].type,'table');assert.equal(f.state.blocks[0].rows[0][0][0].text,'First');assert.equal(f.state.blocks[0].rows[0][1][0].text,'Sec');assert.equal(f.state.blocks[1].content[0].text,'vo');
 }finally{f.close();}
});
test('caret restoration places typing after the inserted prefix',()=>{
 const f=fixture([paragraph('a','Alpha')]);
 try{const host=f.root.querySelector('.block-content');setEditorCaret(host,2);assert.equal(document.getSelection().anchorOffset,2);assert.equal(document.getSelection().anchorNode.textContent,'Alpha');}finally{f.close();}
});

test('Shift-click and Shift-arrow extend across block boundaries',()=>{
 const f=fixture([paragraph('a','Alpha'),paragraph('b','Bravo')]);
 try{
  f.select('a',5,'a',5);assert.ok(f.fire('a','ArrowRight',{shiftKey:true}).defaultPrevented);assert.equal(selectedEditorBlocks(f.root).elements.length,2);
  f.select('a',2,'a',2);
  document.caretRangeFromPoint=()=>{const range=document.createRange();range.setStart(f.root.querySelector('[data-block-id="b"] .block-content').firstChild.firstChild,3);range.collapse(true);return range;};
  const event=new f.dom.window.MouseEvent('pointerdown',{button:0,buttons:1,shiftKey:true,bubbles:true,cancelable:true});f.root.querySelector('[data-block-id="b"] .block-content').dispatchEvent(event);
  assert.ok(event.defaultPrevented);assert.equal(editorSelectionClipboard(f.root,f.state.blocks,[]).text,'pha\n\nBra');
 }finally{f.close();}
});
test('arrow navigation after document Select All collapses inside editable text',()=>{
 const f=fixture([paragraph('a','Alpha'),paragraph('b','Bravo')]);
 try{f.select('a',0,'a',0);f.fire('a','a',{metaKey:true});f.fire('a','a',{metaKey:true});assert.ok(f.fire('a','ArrowRight').defaultPrevented);const selection=document.getSelection();assert.ok(selection.isCollapsed);assert.equal(selection.anchorNode.closest('[data-block-id]').dataset.blockId,'b');}finally{f.close();}
});

test('deleting only the boundary between two paragraphs joins them without losing text',()=>{
 const f=fixture([paragraph('a','Alpha'),paragraph('b','Bravo')]);
 try{f.select('a',5,'b',0);assert.ok(f.fire('a','Backspace').defaultPrevented);assert.equal(f.state.blocks.length,1);assert.equal(f.state.blocks[0].content.map(s=>s.text).join(''),'AlphaBravo');}finally{f.close();}
});

test('dragging through inline equations keeps the equation atomic',()=>{
 const equation=paragraph('b','');equation.content=[{text:'x_1',math:true}];
 const f=fixture([paragraph('a','Alpha'),equation]);
 try{
  const atom=f.root.querySelector('[data-math]');
  document.caretRangeFromPoint=x=>{const range=document.createRange();const node=x<100?f.root.querySelector('[data-block-id="a"] .block-content').firstChild.firstChild:document.createTreeWalker(atom,4).nextNode();range.setStart(node,1);range.collapse(true);return range;};
  f.root.querySelector('.block-content').dispatchEvent(new f.dom.window.MouseEvent('pointerdown',{button:0,buttons:1,clientX:50,bubbles:true}));
  document.dispatchEvent(new f.dom.window.MouseEvent('pointermove',{buttons:1,clientX:150,bubbles:true,cancelable:true}));
  assert.equal(document.getSelection().focusNode,atom.parentNode);assert.equal(document.getSelection().focusOffset,1);
  assert.equal(editorSelectionClipboard(f.root,f.state.blocks,[]).text,'lpha\n\nx_1');
 }finally{f.close();}
});
