import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act} from 'react';
import {fixture} from './fixtures/editor-rendering.mjs';
import {readSegments} from '../src/client/editor/segments.tsx';

test('native typing, selection, composition, paste and history input retain browser-owned nodes',async()=>{
  await fixture(async({dom,host,caret,blocks,rerender})=>{
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
  });
});

test('formatting, external content, entity labels/types/title, removal and numbered order remain live',async()=>{
  await fixture(async({dom,host,blocks,set,entities,onOpen})=>{
    await set(blocks().map(block=>block.id==='b87'?{...block,content:[{text:'Formatted',bold:true}]}:block));
    assert.ok(host('b87').querySelector('strong'));
    await set(blocks().map(block=>block.id==='b87'?{...block,content:[{entityId:'fiction'},{text:' '},{entityId:'fiction',mentionText:'Alias'}]}:block));
    const entity={id:'fiction',name:'Fictional One',type:'person',aliases:[],subtypes:[],properties:{}};
    await entities([entity]);assert.match(host('b87').textContent,/Fictional One/);
    await entities([{...entity,name:'Fictional Two',type:'organization'}]);
    const mentions=host('b87').querySelectorAll('[data-entity]');
    assert.match(mentions[0].textContent,/Fictional Two/);assert.ok(mentions[0].classList.contains('organization'));
    assert.match(mentions[1].textContent,/Alias/);assert.equal(mentions[1].title,'Fictional Two');
    dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
    dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
    const opened=[];await onOpen(id=>opened.push(id));
    await act(async()=>mentions[0].dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
    assert.deepEqual(opened,[],'click opens occurrence correction');
    await act(async()=>Array.from(document.querySelectorAll('.entity-link-dialog button')).find(button=>button.textContent==='Open entity details').click());
    assert.deepEqual(opened,['fiction'],'correction can open details using the latest callback');
    await entities([]);assert.match(host('b87').textContent,/Unknown entity/);
    await set(blocks().map(block=>['b86','b87'].includes(block.id)?{...block,type:'numbered'}:block));
    assert.equal(host('b86').parentElement.querySelector('.numbered-marker').textContent,'1.');
    assert.equal(host('b87').parentElement.querySelector('.numbered-marker').textContent,'2.');
    const next=[...blocks()];[next[85],next[86]]=[next[86],next[85]];await set(next);
    assert.equal(host('b87').parentElement.querySelector('.numbered-marker').textContent,'1.');
    assert.equal(host('b86').parentElement.querySelector('.numbered-marker').textContent,'2.');
    await set(structuredClone(blocks()).map(block=>block.id==='b87'?{...block,type:'todo',checked:true,semantic:'definition'}:block));
    assert.equal(host('b87').parentElement.querySelector('input').checked,true);
    assert.equal(host('b87').parentElement.dataset.semanticKind,'definition');
  });
});

test('citation numbering and review decorations update through the memo boundary',async()=>{
  await fixture(async({host,blocks,set,reviews})=>{
    const ref=(id,sourceId)=>({id,sourceId,fileId:sourceId,sourceHash:'fictional',startLine:1,endLine:2,sourceNumber:1});
    await set(blocks().map(block=>block.id==='b87'?{...block,content:[{text:'Cited',sourceReference:ref('c87','source87')}]}:block));
    assert.equal(host('b87').querySelector('[data-citation-number]').dataset.citationNumber,'1');
    await set(blocks().map(block=>block.id==='b86'?{...block,content:[{text:'Prior',sourceReference:ref('c86','source86')}]}:block));
    assert.equal(host('b87').querySelector('[data-citation-number]').dataset.citationNumber,'2');
    await reviews([{id:'review',blockId:'b85',start:0,end:10}]);
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(host('b85').querySelector('[data-entity-review]').dataset.entityReview,'review');
    await reviews([]);assert.equal(host('b85').querySelector('[data-entity-review]'),null);
  });
});

test('keyboard correction in a table preserves lowercase wording and excludes removed text',async()=>{
  await fixture(async({dom,host,blocks,set,entities})=>{
    dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
    dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
    await entities([{id:'fiction',name:'Fictional Idea',mentionCase:'lowercase',type:'concept',subtypes:[],description:''}]);
    await set(blocks().map(block=>block.id==='b87'?{...block,type:'table',content:[],rows:[[[{entityId:'fiction',skipAutoTag:true}]]]}:block));
    const mention=host('b87').querySelector('.mention');
    await act(async()=>mention.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    assert.ok(document.querySelector('.entity-link-dialog'));
    await act(async()=>Array.from(document.querySelectorAll('.entity-link-dialog button')).find(button=>button.textContent==='Remove link').click());
    assert.deepEqual(blocks()[86].rows[0][0],[{text:'fictional idea',skipAutoTag:true}]);
  });
});
