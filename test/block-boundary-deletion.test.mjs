import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installBlockSelection,setEditorCaret} from '../src/client/editor/block-selection.ts';
import {segmentHTML} from '../src/client/editor/segments.tsx';

const paragraph=(id,content)=>({id,type:'paragraph',checked:false,content:typeof content==='string'?[{text:content}]:content});
function fixture(blocks) {
  const dom=new JSDOM('<div id="blocks"></div>');
  const keys=['window','document','Node','Element','HTMLElement','Range'],prior=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  keys.forEach(key=>Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:dom.window[key]}));
  const root=document.querySelector('#blocks'),state={blocks,focus:null};
  root.innerHTML=blocks.map(block=>`<div data-block-id="${block.id}"><div class="block-content" contenteditable="true">${segmentHTML(block.content,[])}</div></div>`).join('');
  const cleanup=installBlockSelection(root,{blocks:()=>state.blocks,entities:()=>[],commit:(blocks,focus)=>{state.blocks=blocks;state.focus=focus;}});
  const host=id=>root.querySelector(`[data-block-id="${id}"] .block-content`);
  function fire(id,direction,input=false) {
    const event=input?new dom.window.InputEvent('beforeinput',{inputType:direction==='backward'?'deleteContentBackward':'deleteContentForward',bubbles:true,cancelable:true}):new dom.window.KeyboardEvent('keydown',{key:direction==='backward'?'Backspace':'Delete',bubbles:true,cancelable:true});
    host(id).dispatchEvent(event);return event;
  }
  return {state,root,host,fire,close(){cleanup();dom.window.close();keys.forEach((key,i)=>{if(prior[i])Object.defineProperty(globalThis,key,prior[i]);else delete globalThis[key];});}};
}
test('Backspace at paragraph start and Delete at paragraph end join the two editing hosts',()=>{
  for(const direction of ['backward','forward']) for(const input of [false,true]) {
    const f=fixture([paragraph('a','This phrase can mislead.'),paragraph('b','The more precise formulation.')]);
    try {
      const id=direction==='backward'?'b':'a';setEditorCaret(f.host(id),direction==='backward'?0:24);
      assert.ok(f.fire(id,direction,input).defaultPrevented);
      assert.equal(f.state.blocks.length,1);
      assert.equal(f.state.blocks[0].id,'a');
      assert.equal(f.state.blocks[0].content.map(s=>s.text).join(''),'This phrase can mislead. The more precise formulation.');
      assert.deepEqual(f.state.focus,{id:'a',offset:25});
    } finally {f.close();}
  }
});
test('joining preserves inline entities, formatting and live unsaved DOM text',()=>{
  const first=[{text:'mislead.',bold:true},{entityId:'e',mentionText:'ENTITY'}],second=[{text:'The more',italic:true}];
  const f=fixture([paragraph('a',first),paragraph('b',second)]);
  try {
    f.host('a').firstChild.firstChild.firstChild.textContent='can mislead.';
    setEditorCaret(f.host('b'),0);f.fire('b','backward');
    assert.deepEqual(f.state.blocks[0].content,[{text:'can mislead.',bold:true},first[1],{text:' '},second[0]]);
    assert.deepEqual(f.state.focus,{id:'a',offset:19});
    // The same restore used by BlockEditor leaves typing precisely at the join.
    f.host('a').innerHTML=segmentHTML(f.state.blocks[0].content,[]);
    setEditorCaret(f.host('a'),f.state.focus.offset);
    const caret=document.getSelection().getRangeAt(0),prefix=caret.cloneRange();prefix.selectNodeContents(f.host('a'));prefix.setEnd(caret.startContainer,caret.startOffset);
    assert.equal(prefix.toString(),'can mislead.ENTITY ');
  } finally {f.close();}
});
test('middle-of-paragraph deletion and document edges retain native behavior',()=>{
  for(const [id,offset,direction] of [['a',0,'backward'],['b',4,'forward'],['b',2,'backward'],['a',2,'forward']]) {
    const blocks=[paragraph('a','Left'),paragraph('b','More')],f=fixture(blocks);
    try {setEditorCaret(f.host(id),offset);assert.equal(f.fire(id,direction).defaultPrevented,false);assert.equal(f.state.blocks,blocks);} finally {f.close();}
  }
});
test('joins do not cross structural, semantic, column or generated-content boundaries',()=>{
  for(const patch of [{type:'table'},{type:'math'},{semantic:'definition'},{semantic:'ai-explanation'},{semanticGroup:{id:'group',kind:'definition'}},{column:{id:'columns',index:1}}]) {
    const blocks=[{...paragraph('a','mislead.'),...patch},paragraph('b','The more')],f=fixture(blocks);
    try {setEditorCaret(f.host('b'),0);assert.equal(f.fire('b','backward').defaultPrevented,false);assert.equal(f.state.blocks,blocks);} finally {f.close();}
  }
});
test('an empty paragraph can be joined without losing its neighbour',()=>{
  const f=fixture([paragraph('a','mislead.'),paragraph('b',[])]);
  try {setEditorCaret(f.host('b'),0);assert.ok(f.fire('b','backward').defaultPrevented);assert.equal(f.state.blocks.length,1);assert.equal(f.state.blocks[0].content[0].text,'mislead.');} finally {f.close();}
});
test('paragraph joins add only needed spaces and place the caret after the separator',()=>{
  const cases=[
    ['mislead.','The more','mislead. The more',1],
    ['First','second','First second',1],
    ['First ','second','First second',0],
    ['First',' second','First second',0],
    ['First\u00a0','second','First\u00a0second',0],
    ['First',', then','First, then',0],
    ['First','.','First.',0],
    ['(First',')','(First)',0],
    ['(','First','(First',0],
    ['“','First','“First',0],
    ['First','”','First”',0],
    ['well-','known','well-known',0],
    ['First',"'s meaning","First's meaning",0],
    ['第一','第二','第一第二',0],
    ['First','', 'First',0],
    ['','Second','Second',0],
  ];
  for(const direction of ['backward','forward'])for(const [left,right,expected,extra] of cases) {
    const f=fixture([paragraph('a',left),paragraph('b',right)]);
    try {
      const id=direction==='backward'?'b':'a';setEditorCaret(f.host(id),direction==='backward'?0:left.length);
      assert.ok(f.fire(id,direction).defaultPrevented,`${direction}: ${left} | ${right}`);
      assert.equal(f.state.blocks[0].content.map(segment=>segment.text??'').join(''),expected);
      assert.deepEqual(f.state.focus,{id:'a',offset:left.length+extra});
    }finally{f.close();}
  }
});
