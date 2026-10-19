import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {deleteEditorReference} from '../src/client/editor/reference-deletion.ts';

function fixture(html) {
  const dom=new JSDOM(`<div id="blocks"><div class="block-content" contenteditable="true">${html}</div></div>`);
  const keys=['window','document','Node','Element','HTMLElement','Range'];
  const prior=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  keys.forEach(key=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:dom.window[key]}));
  const root=document.querySelector('#blocks'),host=root.firstElementChild;
  const select=(node,start,end=start)=>{
    const range=document.createRange();range.setStart(node,start);range.setEnd(node,end);
    document.getSelection().removeAllRanges();document.getSelection().addRange(range);
  };
  return {root,host,select,close(){dom.window.close();keys.forEach((key,i)=>{if(prior[i])Object.defineProperty(globalThis,key,prior[i]);else delete globalThis[key];});}};
}
const mention='<span data-entity="atonement" contenteditable="false"><i></i>definite atonement</span>';
test('backspace and forward delete remove adjacent entity mentions, preserving surrounding prose and caret',()=>{
  for(const direction of ['backward','forward']) {
    const f=fixture(`Before ${mention} after`);
    try {
      const text=direction==='backward'?f.host.lastChild:f.host.firstChild;
      f.select(text,direction==='backward'?0:text.length);
      assert.equal(deleteEditorReference(f.root,f.host,direction),true);
      assert.equal(f.host.textContent,'Before  after');
      assert.equal(f.host.querySelector('[data-entity]'),null);
      const caret=document.getSelection().getRangeAt(0),prefix=caret.cloneRange();
      prefix.selectNodeContents(f.host);prefix.setEnd(caret.startContainer,caret.startOffset);
      assert.equal(prefix.toString(),'Before ');assert.ok(caret.collapsed);
    } finally {f.close();}
  }
});
test('deletion handles WebKit caret positions inside noneditable mentions and after invisible spacers',()=>{
  for(const position of ['inside','spacer','focused']) {
    const f=fixture(`Before ${mention}\u200b`);
    try {
      const atom=f.host.querySelector('[data-entity]');
      f.select(position==='inside'?atom.lastChild:f.host.lastChild,position==='inside'?5:1);
      assert.equal(deleteEditorReference(f.root,position==='focused'?atom.firstChild:f.host,'backward'),true);
      assert.equal(f.host.textContent.replace(/\u200b/g,''),'Before ');
    } finally {f.close();}
  }
});
test('normal spaces, prose and other atoms keep native deletion',()=>{
  for(const gap of [' ',' text','<br>','<span contenteditable="false" data-math="x">x</span>']) {
    const f=fixture(`${mention}${gap}<b>end</b>`);
    try {
      f.select(f.host.lastChild.firstChild,0);
      const original=f.host.innerHTML;
      assert.equal(deleteEditorReference(f.root,f.host,'backward'),false);
      assert.equal(f.host.innerHTML,original);
    } finally {f.close();}
  }
});
test('partial selections inside mentions delete the whole reference and selected prose',()=>{
  const f=fixture(`Before ${mention} after`);
  try {
    const range=document.createRange();range.setStart(f.host.querySelector('[data-entity]').lastChild,5);range.setEnd(f.host.lastChild,3);
    document.getSelection().addRange(range);
    assert.equal(deleteEditorReference(f.root,f.host,'forward'),true);
    assert.equal(f.host.textContent,'Before ter');
  } finally {f.close();}
});
test('citations still delete as one unit; locked and cross-host selections are untouched',()=>{
  const f=fixture('Before <span data-source-reference="{}" contenteditable="false">[1]</span> after');
  try {
    f.select(f.host.lastChild,0);
    f.host.setAttribute('inert','');
    assert.equal(deleteEditorReference(f.root,f.host,'backward'),false);
    f.host.removeAttribute('inert');
    const other=f.host.cloneNode(true);f.root.append(other);
    const range=document.createRange();range.setStart(f.host.firstChild,2);range.setEnd(other.lastChild,2);
    document.getSelection().removeAllRanges();document.getSelection().addRange(range);
    assert.equal(deleteEditorReference(f.root,f.host,'backward'),false);
    f.select(f.host.lastChild,0);
    assert.equal(deleteEditorReference(f.root,f.host,'backward'),true);
    assert.equal(f.host.textContent,'Before  after');
  } finally {f.close();}
});
