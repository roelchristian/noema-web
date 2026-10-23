import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act} from 'react';
import {fixture} from './fixtures/editor-rendering.mjs';
import {readSegments} from '../src/client/editor/segments.tsx';

test('native typing, selection, composition, paste and history input retain browser-owned nodes',async()=>{
  await fixture(async({dom,host,caret,blocks,rerender})=>{
    assert.equal(document.querySelectorAll('[data-block-id]').length,200,'retain native-node behavior in a large editor');
    const el=host('b87'),text=el.firstChild.firstChild,other=host('b86').firstChild;
    caret(el,5);
    const range=getSelection().getRangeAt(0);range.setEnd(text,10);
    await rerender();assert.equal(getSelection().anchorNode,text);assert.equal(getSelection().getRangeAt(0).endOffset,10);
    for(const [inputType,data,isComposing] of [['insertText','x',false],['insertCompositionText','語',true],['historyUndo','',false],['historyRedo','x',false]]) {
      text.appendData(data);caret(el,text.length);
      document.querySelector('.page').toggleAttribute('data-entity-composing',isComposing);
      const event=new dom.window.InputEvent('input',{bubbles:true,inputType,data,isComposing});
      await act(async()=>el.dispatchEvent(event));
      assert.equal(el.firstChild.firstChild,text);assert.equal(host('b86').firstChild,other);
      assert.equal(getSelection().anchorNode,text);assert.equal(getSelection().anchorOffset,text.length);
      assert.deepEqual(blocks()[86].content,readSegments(el));
    }
    document.querySelector('.page').removeAttribute('data-entity-composing');
    const paste=new dom.window.Event('paste',{bubbles:true,cancelable:true});
    Object.defineProperty(paste,'clipboardData',{value:{getData:type=>type==='text/plain'?' fictitious paste':'',files:[]}});
    await act(async()=>el.dispatchEvent(paste));assert.ok(paste.defaultPrevented);
    assert.match(el.textContent,/ fictitious paste$/);assert.deepEqual(blocks()[86].content,readSegments(el));
  },{blockCount:200});
});

test('formatting, external content, entity labels/types/title, removal and numbered order remain live',async()=>{
  await fixture(async({dom,host,blocks,set,entities,onOpen})=>{
    await set(blocks().map(block=>block.id==='b3'?{...block,content:[{text:'Formatted',bold:true}]}:block));
    assert.ok(host('b3').querySelector('strong'));
    await set(blocks().map(block=>block.id==='b3'?{...block,content:[{entityId:'fiction'},{text:' '},{entityId:'fiction',mentionText:'Alias'}]}:block));
    const entity={id:'fiction',name:'Fictional One',type:'person',aliases:[],subtypes:[],properties:{}};
    await entities([entity]);assert.match(host('b3').textContent,/Fictional One/);
    await entities([{...entity,name:'Fictional Two',type:'organization'}]);
    const mentions=host('b3').querySelectorAll('[data-entity]');
    assert.match(mentions[0].textContent,/Fictional Two/);assert.ok(mentions[0].classList.contains('organization'));
    assert.match(mentions[1].textContent,/Alias/);assert.equal(mentions[1].title,'Fictional Two');
    dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
    dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
    const opened=[];await onOpen(id=>opened.push(id));
    await act(async()=>mentions[0].dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    assert.deepEqual(opened,[],'click opens occurrence correction');
    await act(async()=>Array.from(document.querySelectorAll('.entity-link-dialog button')).find(button=>button.textContent==='Open entity details').click());
    assert.deepEqual(opened,['fiction'],'correction can open details using the latest callback');
    await entities([]);assert.match(host('b3').textContent,/Unknown entity/);
    await set(blocks().map(block=>['b2','b3'].includes(block.id)?{...block,type:'numbered'}:block));
    assert.equal(host('b2').parentElement.querySelector('.numbered-marker').textContent,'1.');
    assert.equal(host('b3').parentElement.querySelector('.numbered-marker').textContent,'2.');
    const next=[...blocks()];[next[1],next[2]]=[next[2],next[1]];await set(next);
    assert.equal(host('b3').parentElement.querySelector('.numbered-marker').textContent,'1.');
    assert.equal(host('b2').parentElement.querySelector('.numbered-marker').textContent,'2.');
    await set(structuredClone(blocks()).map(block=>block.id==='b3'?{...block,type:'todo',checked:true,semantic:'definition'}:block));
    assert.equal(host('b3').parentElement.querySelector('input').checked,true);
    assert.equal(host('b3').parentElement.dataset.semanticKind,'definition');
  });
});

test('citation numbering and review decorations update through the memo boundary',async()=>{
  await fixture(async({host,blocks,set,reviews})=>{
    const ref=(id,sourceId)=>({id,sourceId,fileId:sourceId,sourceHash:'fictional',startLine:1,endLine:2,sourceNumber:1});
    await set(blocks().map(block=>block.id==='b3'?{...block,content:[{text:'Cited',sourceReference:ref('c87','source87')}]}:block));
    assert.equal(host('b3').querySelector('[data-citation-number]').dataset.citationNumber,'1');
    await set(blocks().map(block=>block.id==='b2'?{...block,content:[{text:'Prior',sourceReference:ref('c86','source86')}]}:block));
    assert.equal(host('b3').querySelector('[data-citation-number]').dataset.citationNumber,'2');
    await reviews([{id:'review',blockId:'b1',start:0,end:10}]);
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(host('b1').querySelector('[data-entity-review]').dataset.entityReview,'review');
    await reviews([]);assert.equal(host('b1').querySelector('[data-entity-review]'),null);
  });
});

test('keyboard correction in a table preserves lowercase wording and excludes removed text',async()=>{
  await fixture(async({dom,host,blocks,set,entities})=>{
    dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
    dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
    await entities([{id:'fiction',name:'Fictional Idea',mentionCase:'lowercase',type:'concept',subtypes:[],description:''}]);
    await set(blocks().map(block=>block.id==='b3'?{...block,type:'table',content:[],rows:[[[{entityId:'fiction',skipAutoTag:true}]]]}:block));
    const mention=host('b3').querySelector('.mention');
    await act(async()=>mention.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    assert.ok(document.querySelector('.entity-link-dialog'));
    await act(async()=>Array.from(document.querySelectorAll('.entity-link-dialog button')).find(button=>button.textContent==='Remove link').click());
    assert.deepEqual(blocks()[2].rows[0][0],[{text:'fictional idea',skipAutoTag:true}]);
  });
});

test('pasting mixed HTML and files saves images in order without losing surrounding text',async()=>{
 await fixture(async({dom,host,caret,blocks})=>{
  const previousFetch=globalThis.fetch,previousFile=globalThis.File;
  const uploads=[];
  globalThis.fetch=async(url,options)=>{
   if(url==='/api/images'){uploads.push(options.body);return {ok:true,json:async()=>({id:'pasted-'+uploads.length})};}
   throw new Error('Unexpected image fetch '+url);
  };
  globalThis.File=dom.window.File;
  try{
   const el=host('b3');caret(el,10);
   const file=new dom.window.File(['fake gif'],'clipboard.gif',{type:'image/gif'});
   const paste=new dom.window.Event('paste',{bubbles:true,cancelable:true});
   Object.defineProperty(paste,'clipboardData',{value:{getData:type=>type==='text/html'?'<p>Before<img src="file:///clipboard.gif" alt="Diagram">After</p>':type==='text/plain'?'BeforeAfter':'',files:[file]}});
   await act(async()=>{el.dispatchEvent(paste);await new Promise(resolve=>setTimeout(resolve,20));});
   assert.ok(paste.defaultPrevented);assert.equal(uploads.length,1);
   const inserted=blocks().slice(2,6);
   assert.deepEqual(inserted.map(b=>b.type),['paragraph','image','paragraph','paragraph']);
   assert.equal(inserted[0].content.map(s=>s.text).join(''),'FictitiousBefore');
   assert.equal(inserted[1].imageId,'pasted-1');assert.equal(inserted[1].alt,'Diagram');
   assert.equal(inserted[2].content.map(s=>s.text).join(''),'After');
   assert.equal(inserted[3].content.map(s=>s.text).join(''),' paragraph 3');
  }finally{globalThis.fetch=previousFetch;globalThis.File=previousFile;}
 });
});

test('an inaccessible clipboard image reports an error and preserves the pasted text',async()=>{
 await fixture(async({dom,host,caret,blocks})=>{
  const el=host('b3');caret(el,0);
  const paste=new dom.window.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{getData:type=>type==='text/html'?'<p>Before<img src="file:///unavailable.png">After</p>':'',files:[]}});
  await act(async()=>{el.dispatchEvent(paste);await new Promise(resolve=>setTimeout(resolve,20));});
  assert.match(document.querySelector('[role="alert"]').textContent,/not accessible/);
  assert.equal(blocks().some(b=>b.type==='image'),false);
  assert.ok(blocks().some(b=>b.content.some(s=>s.text==='Before')));
  assert.ok(blocks().some(b=>b.content.some(s=>s.text==='After')));
 });
});

test('mixed image paste replaces a cross-block selection and survives subsequent editing',async()=>{
 await fixture(async({dom,host,blocks})=>{
  const previousFetch=globalThis.fetch;
  let release;const upload=new Promise(resolve=>{release=resolve;});
  globalThis.fetch=async()=>{await upload;return {ok:true,json:async()=>({id:'cross-block-image'})};};
  try{
   const {setEditorSelectionRange}=await import('../src/client/editor/block-selection.ts');
   const range=document.createRange();range.setStart(host('b3').firstChild.firstChild,10);range.setEnd(host('b4').firstChild.firstChild,10);
   setEditorSelectionRange(document.querySelector('#blocks'),range);
   const paste=new dom.window.Event('paste',{bubbles:true,cancelable:true});
   const file=new File(['gif'],'clipboard.gif',{type:'image/gif'});
   Object.defineProperty(paste,'clipboardData',{value:{getData:type=>type==='text/html'?'<p>Before<img src="file:///clipboard.gif">After</p>':'BeforeAfter',files:[file]}});
   await act(async()=>host('b3').dispatchEvent(paste));
   assert.ok(paste.defaultPrevented);assert.equal(blocks().filter(b=>b.type==='divider').length,1,'upload placeholders remain valid for autosave');
   const trailing=blocks().find(b=>b.content.some(s=>s.text==='After'));
   assert.ok(trailing);
   await act(async()=>{release();await new Promise(resolve=>setTimeout(resolve,20));});
   assert.equal(blocks().find(b=>b.type==='image').imageId,'cross-block-image');
   assert.ok(blocks().some(b=>b.id===trailing.id));
  }finally{globalThis.fetch=previousFetch;}
 });
});

test('copying a note selection exports its image and remote images use the download endpoint',async()=>{
 await fixture(async({dom,host,caret,blocks,set})=>{
  await set([{id:'before',type:'paragraph',checked:false,content:[{text:'Before'}]},{id:'image',type:'image',checked:false,content:[],imageId:'original.png',alt:'Diagram'},{id:'after',type:'paragraph',checked:false,content:[{text:'After'}]}]);
  const {setEditorSelectionRange,editorSelectionClipboard}=await import('../src/client/editor/block-selection.ts');
  const editor=document.querySelector('#blocks'),range=document.createRange();range.selectNodeContents(editor);setEditorSelectionRange(editor,range);
  const copied=editorSelectionClipboard(editor,blocks(),[]);
  assert.match(copied.html,/<img[^>]+src="http:\/\/localhost\/api\/images\/original.png\?vault=fixture"[^>]+alt="Diagram"/);
  const previousFetch=globalThis.fetch,previousFile=globalThis.File,calls=[];
  globalThis.File=dom.window.File;
  globalThis.fetch=async(url,options)=>{
   calls.push(url);
   if(url==='/api/images/fetch'){assert.deepEqual(JSON.parse(options.body),{url:'https://example.test/image.gif'});return {ok:true,blob:async()=>new Blob(['gif'],{type:'image/gif'})};}
   assert.equal(url,'/api/images');return {ok:true,json:async()=>({id:'remote.gif'})};
  };
  try{
   caret(host('after'),5);
   const paste=new dom.window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{getData:type=>type==='text/html'?'<img src="https://example.test/image.gif">':'',files:[]}});
   await act(async()=>{host('after').dispatchEvent(paste);await new Promise(resolve=>setTimeout(resolve,20));});
   assert.deepEqual(calls,['/api/images/fetch','/api/images']);assert.ok(blocks().some(b=>b.imageId==='remote.gif'));
  }finally{globalThis.fetch=previousFetch;globalThis.File=previousFile;}
 });
});

test('undo and redo treat an uploaded clipboard image as part of its paste',async()=>{
 const previousHistory=process.env.MEASURE_HISTORY;process.env.MEASURE_HISTORY='1';
 try{await fixture(async({dom,host,caret,blocks})=>{
  const page=document.querySelector('.page'),article=document.createElement('article');article.className='page';
  page.replaceWith(article);while(page.firstChild)article.append(page.firstChild);
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>({id:'history.gif'})});
  try{
   const original=blocks(),el=host('b3');caret(el,10);
   const file=new File(['gif'],'clipboard.gif',{type:'image/gif'}),paste=new dom.window.Event('paste',{bubbles:true,cancelable:true});
   Object.defineProperty(paste,'clipboardData',{value:{getData:type=>type==='text/html'?'<p>Before<img src="file:///clipboard.gif">After</p>':'BeforeAfter',files:[file]}});
   await act(async()=>{el.dispatchEvent(paste);await new Promise(resolve=>setTimeout(resolve,20));});
   assert.ok(blocks().some(b=>b.imageId==='history.gif'));
   const target=document.querySelector('.block-content');
   await act(async()=>target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true})));
   assert.deepEqual(blocks(),original,'one undo removes the whole paste');
   await act(async()=>host('b3').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true})));
   assert.ok(blocks().some(b=>b.imageId==='history.gif'),'redo restores the saved image');assert.equal(blocks().some(b=>b.type==='divider'),false);
  }finally{globalThis.fetch=previousFetch;}
 });}finally{if(previousHistory===undefined)delete process.env.MEASURE_HISTORY;else process.env.MEASURE_HISTORY=previousHistory;}
});

test('paragraph openings follow headings and dividers as blocks change', async () => {
  await fixture(async ({blocks, set, host}) => {
    const original = blocks();
    const positions = () => ['b1','b2','b3','b4','b5','b6'].map(id => host(id)?.closest('[data-block-id]').dataset.paragraphFlow);
    await set(original.slice(0, 6).map((block, index) => index === 1 ? {...block, type:'heading1'} : index === 4 ? {...block, type:'divider'} : block));
    assert.deepEqual(positions(), ['first',undefined,'first','continuation',undefined,'first']);
    await set(original.slice(0, 6));
    assert.deepEqual(positions(), ['first','continuation','continuation','continuation','continuation','continuation']);
    await set(original.slice(1, 6));
    assert.equal(host('b2').closest('[data-block-id]').dataset.paragraphFlow, 'first');
  });
});

test('empty paragraphs and callouts do not consume section openings, with independent column flow', async () => {
  const {paragraphFlow} = await import('../src/client/editor/paragraph-indent.ts');
  const block = (id, type='paragraph', extra={}) => ({id, type, content:[{text:id}], ...extra});
  const flow = paragraphFlow([
    block('empty','paragraph',{content:[]}),
    block('callout','paragraph',{semantic:'definition'}),
    block('list','bullet'),block('first'),block('next'),
    block('h','heading2'),block('quote','quote'),block('after-heading'),
    block('left','paragraph',{column:{id:'columns',index:0}}),
    block('right','paragraph',{column:{id:'columns',index:1}}),
    block('left-next','paragraph',{column:{id:'columns',index:0}}),
  ]);
  assert.deepEqual([...flow], [['empty','first'],['first','first'],['next','continuation'],['after-heading','first'],['left','first'],['right','first'],['left-next','continuation']]);
});

test('locked page paragraphs retain the same section openings as editable paragraphs', async () => {
  const {createElement} = await import('react');
  const {renderToStaticMarkup} = await import('react-dom/server');
  const {ReadOnlyPageBlocks} = await import('../src/client/editor/ReadOnlyPageBlocks.tsx');
  await fixture(async ({blocks, set, host}) => {
    const content = blocks().slice(0, 6).map((block,index) => index===2 ? {...block,type:'heading2'} : block);
    await set(content);
    const preview = document.createElement('div');
    preview.innerHTML = renderToStaticMarkup(createElement(ReadOnlyPageBlocks,{blocks:content,entities:[],pages:[],vaultId:'fixture',onOpenEntity(){},onOpenPage(){}}));
    for (const block of content) {
      const readonly = preview.querySelector(`[data-block-id="${block.id}"]`);
      assert.equal(readonly.dataset.paragraphFlow, host(block.id).closest('[data-block-id]').dataset.paragraphFlow);
      assert.equal(readonly.querySelector('.block-content').textContent, host(block.id).textContent);
    }
  });
});


test('imported spaces beside entities wrap as normal spaces without changing saved text', async () => {
  const {segmentHTML} = await import('../src/client/editor/segments.tsx');
  await fixture(async () => {
    const content=[{text:'Before\u00a0',bold:true},{entityId:'entity'},{text:'\u00a0after and nonbreaking\u00a0phrase'}];
    const entities=[{id:'entity',name:'Marian hymn',type:'concept'}];
    for (const readOnly of [false,true]) {
      const host=document.createElement('div');
      host.innerHTML=segmentHTML(content,entities,undefined,readOnly);
      const spaces=host.querySelectorAll('[data-entity-space]');
      assert.equal(spaces.length,2);
      assert.ok([...spaces].every(space=>space.textContent===' '));
      assert.deepEqual(readSegments(host),content);
      assert.ok(host.textContent.includes('nonbreaking\u00a0phrase'),'spaces within prose keep their nonbreaking behavior');
      spaces[0].remove();
      assert.deepEqual(readSegments(host),[{text:'Before',bold:true},content[1],content[2]],'deleting a boundary space stays deleted');
      spaces[1].textContent=' changed ';
      assert.equal(readSegments(host).at(-1).text,' changed after and nonbreaking\u00a0phrase','editing the space reads the new text');
    }
    const code=document.createElement('div');
    code.innerHTML=segmentHTML([{text:'code\u00a0',code:true},{entityId:'entity'}],entities);
    assert.equal(code.querySelector('[data-entity-space]'),null,'code whitespace remains literal');
  });
});

test('typing and composition beside entity boundary spaces preserve caret, authored spaces and history',async()=>{
 const previousHistory=process.env.MEASURE_HISTORY;process.env.MEASURE_HISTORY='1';
 try{await fixture(async({dom,host,blocks,set,entities})=>{
  const page=document.querySelector('.page'),article=document.createElement('article');article.className='page';page.replaceWith(article);while(page.firstChild)article.append(page.firstChild);
  await entities([{id:'fiction',name:'Synthetic entity',type:'concept',subtypes:[],description:''}]);
  await set([{id:'b87',type:'paragraph',checked:false,content:[{text:'Before\u00a0'},{entityId:'fiction'},{text:'\u00a0after'}]},{id:'b88',type:'paragraph',checked:false,content:[]}]);
  const original=structuredClone(blocks()),el=host('b87'),space=el.querySelectorAll('[data-entity-space]')[1],text=space.firstChild;
  const place=()=>{const range=document.createRange();range.setStart(text,text.length);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);};place();
  document.querySelector('.page').setAttribute('data-entity-composing','');
  await act(async()=>el.dispatchEvent(new dom.window.CompositionEvent('compositionstart',{bubbles:true,data:''})));
  for(const data of ['語','文']){
   await act(async()=>el.dispatchEvent(new dom.window.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertCompositionText',data,isComposing:true})));
   text.appendData(data);place();await act(async()=>el.dispatchEvent(new dom.window.InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data,isComposing:true})));
   assert.equal(getSelection().anchorNode,text);assert.equal(getSelection().anchorOffset,text.length);assert.equal(space.firstChild,text);
  }
  await act(async()=>el.dispatchEvent(new dom.window.CompositionEvent('compositionend',{bubbles:true,data:'語文'})));document.querySelector('.page').removeAttribute('data-entity-composing');
  const edited=structuredClone(blocks());assert.equal(edited[0].content.at(-1).text,'\u00a0語文after','typing beside the rendered boundary must retain its authored nonbreaking space');
  await act(async()=>host('b87').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true})));assert.deepEqual(blocks(),original,'one undo restores the complete composition');
  await act(async()=>host('b87').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true})));assert.deepEqual(blocks(),edited,'redo preserves the composed text and entity reference');
 });}finally{if(previousHistory===undefined)delete process.env.MEASURE_HISTORY;else process.env.MEASURE_HISTORY=previousHistory;}
});

test('boundary-space readback preserves ordinary edits and cloned formatted selections without resurrecting deleted spaces',async()=>{
 const {segmentHTML}=await import('../src/client/editor/segments.tsx');
 await fixture(async()=>{
  const el=document.createElement('div'),content=[{entityId:'fiction'},{text:'\u00a0after'}];
  el.innerHTML=segmentHTML(content,[{id:'fiction',type:'concept',name:'Synthetic entity'}]);
  assert.deepEqual(readSegments(el),content);
  const marker=el.querySelector('[data-entity-space]'),text=marker.firstChild;
  text.appendData('語😀');
  assert.equal(readSegments(el).at(-1).text,'\u00a0語😀after');
  assert.equal(readSegments(el).at(-1).text,'\u00a0語😀after','repeated readback is stable');
  assert.deepEqual(readSegments(el.cloneNode(true)),readSegments(el),'selection clones retain the authored-space mapping');
  text.insertData(0,'X');assert.equal(readSegments(el).at(-1).text,'X\u00a0語😀after','typing before the boundary moves its mapping');
  const strong=document.createElement('strong');text.replaceWith(strong);strong.append(text);
  assert.equal(readSegments(el)[1].bold,true);assert.equal(readSegments(el)[1].text,'X\u00a0語😀');
  assert.deepEqual(readSegments(el.cloneNode(true)),readSegments(el),'formatting and selection cloning preserve mapping and style');
  text.deleteData(1,1);assert.equal(readSegments(el)[1].text,'X語😀','deleting the original space stays deleted');
  text.insertData(1,' ');assert.equal(readSegments(el)[1].text,'X 語😀','a deliberate new ordinary space stays ordinary');
  marker.textContent=' new ';assert.equal(readSegments(el).at(-1).text,' new after','whole-node replacement reads the new authored text');
 });
});
