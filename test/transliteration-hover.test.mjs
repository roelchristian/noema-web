import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM} from './helpers/dom.mjs';
import {attachTransliterationHover} from '../src/client/editor/transliteration-hover.ts';

test('word hover pairs both scripts across formatting, skips citations and leaves editable DOM intact',async t=>{
  const env=setupDOM(t,{html:`<div class="block"><div class="block-content" contenteditable="true"><strong>Жи</strong><em>знь</em> <span data-source-reference="r">[1]</span> прекрасна <code>код</code></div><aside class="block-transliteration"><div><strong>Žiznʹ</strong> prekrasna <code>код</code></div></aside></div>`});
  const highlights=new Map();
  window.CSS={highlights};
  window.Highlight=class {constructor(...ranges){this.ranges=ranges;}};
  let pending;
  window.requestAnimationFrame=callback=>{pending=callback;return 1;};
  window.cancelAnimationFrame=()=>{pending=undefined;};
  env.dom.window.Range.prototype.getClientRects=()=>[{left:0,right:100,top:0,bottom:20}];
  const block=document.querySelector('.block'),source=document.querySelector('.block-content'),aside=document.querySelector('aside');
  const original=source.innerHTML;
  const detach=attachTransliterationHover(aside);
  env.defer(detach);
  function hover(target,node,offset=1,options={}){
    document.caretRangeFromPoint=()=>{const range=document.createRange();range.setStart(node,offset);range.collapse(true);return range;};
    const event=new window.MouseEvent('pointermove',{bubbles:true,clientX:10,clientY:10,...options});
    Object.defineProperty(event,'pointerType',{value:options.pointerType??'mouse'});
    target.dispatchEvent(event);
    const paint=pending;pending=undefined;paint?.();
  }
  hover(source.querySelector('em'),source.querySelector('em').firstChild);
  assert.deepEqual(highlights.get('transliteration-word').ranges.map(range=>range.toString()),['Жизнь','Žiznʹ']);
  const latinText=aside.querySelector('div').childNodes[1];
  hover(aside.querySelector('div'),latinText,3);
  assert.deepEqual(highlights.get('transliteration-word').ranges.map(range=>range.toString()),['prekrasna','прекрасна']);
  assert.equal(source.innerHTML,original);
  hover(source.querySelector('code'),source.querySelector('code').firstChild);
  assert.equal(highlights.size,0);
  hover(source.querySelector('strong'),source.querySelector('strong').firstChild);
  block.dispatchEvent(new window.Event('pointerleave'));
  assert.equal(highlights.size,0);
  hover(source.querySelector('strong'),source.querySelector('strong').firstChild,1,{pointerType:'touch'});
  assert.equal(highlights.size,0);
  hover(source.querySelector('strong'),source.querySelector('strong').firstChild);
  document.dispatchEvent(new window.Event('selectionchange'));
  assert.equal(highlights.size,0);
  hover(source.querySelector('strong'),source.querySelector('strong').firstChild);
  detach();
  assert.equal(highlights.size,0);
});

test('hover does not guess mismatched word pairs and safely skips unavailable highlight APIs',t=>{
  const env=setupDOM(t,{html:'<div class="block"><div class="block-content">два слова</div><aside class="block-transliteration">one</aside></div>'});
  const aside=document.querySelector('aside');
  assert.doesNotThrow(()=>attachTransliterationHover(aside)());
  const highlights=new Map();
  window.CSS={highlights};window.Highlight=class {};
  window.requestAnimationFrame=callback=>{callback();return 1;};
  window.cancelAnimationFrame=()=>{};
  const detach=attachTransliterationHover(aside);env.defer(detach);
  document.caretRangeFromPoint=()=>{const range=document.createRange();range.setStart(aside.firstChild,1);return range;};
  aside.dispatchEvent(new window.MouseEvent('pointermove',{bubbles:true,clientX:10,clientY:10}));
  assert.equal(highlights.size,0);
});
