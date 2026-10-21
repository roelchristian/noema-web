import {JSDOM} from 'jsdom';
import React, {act,useLayoutEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {useDocumentHistory} from '../../src/client/editor/use-document-history.ts';

export function historyFixture(count = 200) {
  return {id:'page',vault_id:'vault',title:'History fixture',featuredImageId:null,
    blocks:Array.from({length:count},(_,i)=>({id:`b${i}`,type:i%17===16?'table':'paragraph',checked:false,
      content:[{text:`Block ${i}: ${'Representative prose with citations and formatting. '.repeat(8)}`,bold:i%3===0,skipAutoTag:true}],
      ...(i%17===16?{rows:[[[{text:'Cell',italic:true}],[{text:'Other cell'}]]]}:{}),
      ...(i%11===0?{semantic:'evidence'}:{})}))};
}

// Render just the edited surface: timings below concern history serialization,
// not BlockEditor rendering. The hook always receives the complete document.
export async function historyHarness(page, work) {
  const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true,url:'http://localhost'});
  const keys=['window','document','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Range','Event','InputEvent','CustomEvent','requestAnimationFrame','cancelAnimationFrame','IS_REACT_ACT_ENVIRONMENT'];
  const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:['requestAnimationFrame','cancelAnimationFrame'].includes(key)?dom.window[key].bind(dom.window):dom.window[key]});
  dom.window.HTMLElement.prototype.attachEvent=function(){};
  dom.window.HTMLElement.prototype.detachEvent=function(){};
  const root=createRoot(document.querySelector('#mount'));
  let history, disabled=false, outgoing;
  const render=()=>root.render(React.createElement(Editor));
  function Surface({text}) {
    const ref=useRef(null);
    useLayoutEffect(()=>{if(ref.current.textContent!==text)ref.current.textContent=text;},[text]);
    return React.createElement('div',{ref,className:'block-content',contentEditable:true,suppressContentEditableWarning:true});
  }
  function Editor() {
    history=useDocumentHistory(page,patch=>{outgoing=patch;page={...page,...patch};render();},disabled);
    return React.createElement('article',{className:'page'},
      React.createElement('input',{id:'page-title',value:page.title,onChange(){}}),
      React.createElement('div',{id:'blocks'},React.createElement('div',{'data-block-id':'b0',className:'paragraph'},
        React.createElement(Surface,{text:page.blocks[0]?.content[0]?.text??''}))));
  }
  const host=()=>document.querySelector('.block-content');
  function caret(offset) {
    host().focus(); const node=host().firstChild??host();
    document.getSelection().setBaseAndExtent(node,offset,node,offset);
  }
  function event(type,options={}) {return new dom.window.InputEvent(type,{bubbles:true,cancelable:true,...options});}
  try {
    await act(async()=>render());caret(0);
    await work({dom,page:()=>page,history:()=>history,outgoing:()=>outgoing,host,caret,
      change:async patch=>act(async()=>history.change(patch)),
      step:async(callback)=>act(async()=>callback(history)),
      replace:async next=>act(async()=>{page=next;render();}),
      disabled:async value=>act(async()=>{disabled=value;render();}),
      type:async(text,inputType='insertText',isComposing=false)=>act(async()=>{
        host().dispatchEvent(event('beforeinput',{inputType,isComposing}));
        const content=[{...page.blocks[0].content[0],text:page.blocks[0].content[0].text+text}];
        // Native DOM mutation and caret update precede React's input handler.
        host().textContent=content[0].text;caret(content[0].text.length);
        history.change({blocks:page.blocks.map((block,i)=>i?block:{...block,content})});
        host().dispatchEvent(event('input',{inputType,isComposing}));
      }),
    });
  } finally {
    await act(async()=>root.unmount());dom.window.close();
    keys.forEach((key,i)=>{if(previous[i])Object.defineProperty(globalThis,key,previous[i]);else delete globalThis[key];});
  }
}

export function instrumentHistory(count) {
  const originalClone=globalThis.structuredClone, originalStringify=JSON.stringify;
  const totals={clone:{count:0,ms:0},stringify:{count:0,ms:0},shape:{count:0,ms:0}};
  function wrap(original,kind) {return function(value,...args) {
    const category=value?.blocks?.length===count?kind:kind==='stringify'&&Array.isArray(value)&&value.length===count&&Array.isArray(value[0])?'shape':null;
    if(!category)return original(value,...args);
    const start=performance.now();try{return original(value,...args);}finally {totals[category].count++;totals[category].ms+=performance.now()-start;}
  };}
  globalThis.structuredClone=wrap(originalClone,'clone');JSON.stringify=wrap(originalStringify,'stringify');
  return {totals,stop(){globalThis.structuredClone=originalClone;JSON.stringify=originalStringify;}};
}
