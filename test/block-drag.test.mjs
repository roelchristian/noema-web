import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {blockDropBefore,reorderBlock,installBlockDrag} from '../src/client/editor/block-drag.ts';
const block=(id,type='paragraph')=>({id,type,checked:false,content:[{text:id}]});
test('block moves preserve every field and identity while handling all insertion positions',()=>{
 const blocks=[block('a'),{...block('table','table'),rows:[[[{text:'Cell',bold:true}]]]}, {...block('image','image'),imageId:'file.png',alt:'Caption'},block('math','math')];
 for(const [source,before,ids] of [['a',null,['table','image','math','a']],['math','a',['math','a','table','image']],['image','table',['a','image','table','math']]]){
  const next=reorderBlock(blocks,source,before);assert.deepEqual(next.map(b=>b.id),ids);assert.equal(new Set(next.map(b=>b.id)).size,4);assert.ok(next.every(b=>b===blocks.find(original=>original.id===b.id)));
 }
 assert.deepEqual(blocks.map(b=>b.id),['a','table','image','math']);
 for(const [id,before] of [['missing',null],['a','missing'],['a','a'],['a','table'],['math',null]])assert.equal(reorderBlock(blocks,id,before),blocks);
});
test('drop targets use block midpoints and omit the source block',()=>{
 const bounds=[{id:'a',top:0,bottom:40},{id:'b',top:50,bottom:250},{id:'c',top:260,bottom:300}];
 assert.equal(blockDropBefore(bounds,'b',0),'a');assert.equal(blockDropBefore(bounds,'b',100),'c');assert.equal(blockDropBefore(bounds,'b',400),null);
 assert.equal(blockDropBefore(bounds,'a',140),'b');assert.equal(blockDropBefore(bounds,'a',160),'c');
});
function fixture(){
 const dom=new JSDOM('<div id="blocks"></div>'),keys=['window','document','Element','HTMLElement'],previous=keys.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));
 keys.forEach(k=>Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:dom.window[k]}));
 const root=document.querySelector('#blocks'),state={blocks:['a','b','c'].map(id=>block(id)),preview:null,commits:0,messages:[],clicks:0,scrolls:[]};
 root.innerHTML=state.blocks.map(b=>`<div data-block-id="${b.id}"><button class="block-handle">Options</button><div class="block-content" contenteditable="true">${b.id}</div></div>`).join('');
 const box=(top,bottom)=>({left:100,right:700,top,bottom,width:600,height:bottom-top,x:100,y:top,toJSON(){}});
 root.getBoundingClientRect=()=>box(20,280);Array.from(root.children).forEach((row,index)=>{row.getBoundingClientRect=()=>box(20+index*100,80+index*100);});
 const frames=new Map();let frame=0;
 window.requestAnimationFrame=callback=>{frames.set(++frame,callback);return frame;};window.cancelAnimationFrame=id=>frames.delete(id);window.scrollBy=(x,y)=>state.scrolls.push(y);
 const cleanup=installBlockDrag(root,{blocks:()=>state.blocks,commit:blocks=>{state.blocks=blocks;state.commits++;},preview:value=>state.preview=value,announce:message=>state.messages.push(message)});
 root.addEventListener('click',event=>{if(event.target.closest('.block-handle'))state.clicks++;});
 const handle=id=>root.querySelector(`[data-block-id="${id}"] .block-handle`);
 function pointer(target,type,x,y,extra={}){const event=new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,...extra});Object.defineProperties(event,{pointerId:{value:1},isPrimary:{value:true},pointerType:{value:'mouse'}});target.dispatchEvent(event);return event;}
 const key=(id,value,extra={})=>{const event=new dom.window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra});handle(id).dispatchEvent(event);return event;};
 return {dom,root,state,handle,pointer,key,frames,close(){cleanup();dom.window.close();keys.forEach((k,i)=>{if(previous[i])Object.defineProperty(globalThis,k,previous[i]);else delete globalThis[k];});}};
}
test('a short handle click opens options and never reorders',()=>{
 const f=fixture();try{f.pointer(f.handle('a'),'pointerdown',85,50);f.pointer(document,'pointermove',87,51);f.pointer(document,'pointerup',87,51);f.handle('a').dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));assert.equal(f.state.clicks,1);assert.equal(f.state.preview,null);assert.equal(f.state.commits,0);}finally{f.close();}
});
test('dragging the handle previews and commits a move, then suppresses its click menu',()=>{
 const f=fixture();try{
  f.pointer(f.handle('a'),'pointerdown',85,50);assert.ok(f.pointer(document,'pointermove',250,275).defaultPrevented);
  assert.deepEqual(f.state.preview,{id:'a',beforeId:null,valid:true,keyboard:false});assert.equal(f.state.commits,0);
  f.pointer(document,'pointerup',250,275);assert.equal(f.state.preview,null);assert.deepEqual(f.state.blocks.map(b=>b.id),['b','c','a']);assert.equal(f.state.commits,1);assert.match(f.state.messages.at(-1),/position 3 of 3/);
  const click=new f.dom.window.MouseEvent('click',{bubbles:true,cancelable:true,detail:1});f.handle('a').dispatchEvent(click);assert.ok(click.defaultPrevented);assert.equal(f.state.clicks,0);assert.equal(document.activeElement,f.handle('a'));
 }finally{f.close();}
});
test('Escape, pointer cancellation and out-of-document drops do not change order',()=>{
 for(const reason of ['escape','pointercancel','outside','blur']){
  const f=fixture();try{f.pointer(f.handle('c'),'pointerdown',85,250);f.pointer(document,'pointermove',200,25);
   if(reason==='escape')f.key('c','Escape');else if(reason==='pointercancel')f.pointer(document,'pointercancel',200,25);else if(reason==='blur')window.dispatchEvent(new f.dom.window.Event('blur'));else f.pointer(document,'pointerup',900,25);
   assert.equal(f.state.commits,0);assert.deepEqual(f.state.blocks.map(b=>b.id),['a','b','c']);assert.equal(f.state.preview,null);assert.equal(f.frames.size,0);assert.match(f.state.messages.at(-1),/cancelled/);
  }finally{f.close();}
 }
});
test('keyboard pickup, movement, drop and cancellation are scoped to the block handle',()=>{
 const f=fixture();try{
  assert.equal(f.key('b','Enter').defaultPrevented,false,'Enter still opens the normal options button');
  assert.ok(f.key('b',' ').defaultPrevented);assert.equal(f.state.preview.keyboard,true);
  f.key('b','ArrowUp');assert.equal(f.state.preview.beforeId,'a');f.key('b','Enter');assert.deepEqual(f.state.blocks.map(b=>b.id),['b','a','c']);
  f.key('b',' ');f.key('b','End');f.key('b','Escape');assert.equal(f.state.commits,1);assert.equal(f.state.preview,null);
  f.key('b',' ');f.key('b','End');f.key('b',' ');assert.deepEqual(f.state.blocks.map(b=>b.id),['a','c','b']);
 }finally{f.close();}
});
test('ordinary text drags and external drag/drop never reorder editor blocks',()=>{
 const f=fixture();try{f.pointer(f.root.querySelector('.block-content'),'pointerdown',200,50);f.pointer(document,'pointermove',200,275);f.pointer(document,'pointerup',200,275);f.root.dispatchEvent(new f.dom.window.Event('drop',{bubbles:true,cancelable:true}));assert.equal(f.state.preview,null);assert.equal(f.state.commits,0);}finally{f.close();}
});
test('edge dragging scrolls and cancellation cleans up animation work',()=>{
 const f=fixture();try{f.pointer(f.handle('a'),'pointerdown',85,50);f.pointer(document,'pointermove',250,window.innerHeight-5);const [id,callback]=Array.from(f.frames)[0];f.frames.delete(id);callback();assert.ok(f.state.scrolls[0]>0);assert.ok(f.frames.size>0);f.key('a','Escape');assert.equal(f.frames.size,0);}finally{f.close();}
});
test('drop uses the latest block state and does not overwrite an edit made during dragging',()=>{
 const f=fixture();try{f.pointer(f.handle('a'),'pointerdown',85,50);f.pointer(document,'pointermove',250,275);const edited={...f.state.blocks[0],content:[{text:'New edit'}]};f.state.blocks=[edited,...f.state.blocks.slice(1)];f.pointer(document,'pointerup',250,275);assert.equal(f.state.blocks.at(-1),edited);assert.equal(f.state.blocks.at(-1).content[0].text,'New edit');}finally{f.close();}
});

test('holding Space does not repeatedly drop and pick up the block',()=>{
 const f=fixture();try{f.key('a',' ');assert.ok(f.key('a',' ',{repeat:true}).defaultPrevented);assert.equal(f.state.preview.id,'a');assert.equal(f.state.commits,0);f.key('a','Escape');}finally{f.close();}
});
test('reordered blocks retain their IDs and rich content through page save and reload',async()=>{
 const {openDatabase}=await import('../src/server/database.ts'),{Store}=await import('../src/server/store.ts'),{Knowledge}=await import('../src/server/modules/knowledge.ts'),{Pages}=await import('../src/server/modules/pages.ts');
 const db=openDatabase(':memory:');
 try{
  const store=new Store(db),pages=new Pages(store,new Knowledge(store)),page=pages.create('default',{title:'Block order'});
  const blocks=[block('a'),{...block('table','table'),content:[],rows:[[[{text:'Rich cell',bold:true},{entityId:'ursula'}]]]},block('math','math'),{...block('todo','todo'),checked:true}];
  const saved=pages.update('default',page.id,{...page,blocks});const next=reorderBlock(saved.blocks,'table',null);pages.update('default',page.id,{...saved,blocks:next});
  assert.deepEqual(pages.get('default',page.id).blocks,next);assert.deepEqual(next.map(b=>b.id),['a','math','todo','table']);
 }finally{db.close();}
});
