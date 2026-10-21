import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {BlockEditor} from '../../src/client/editor/BlockEditor.tsx';
import {CitationPresentationContext} from '../../src/client/sources/CitationPresentation.tsx';
import {noteCitations} from '../../src/shared/citations.ts';
import {useDocumentHistory} from '../../src/client/editor/use-document-history.ts';
import {api} from '../../src/client/api.ts';

export async function fixture(work) {
  const dom=new JSDOM('<div class="page"><div id="mount"></div></div>',{url:'http://localhost',pretendToBeVisual:true});
  const keys=['window','document','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Range','DOMParser','InputEvent','Event','CustomEvent','MutationObserver','getSelection','requestAnimationFrame','cancelAnimationFrame','IS_REACT_ACT_ENVIRONMENT'];
  const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
  for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:['getSelection','requestAnimationFrame','cancelAnimationFrame'].includes(key)?dom.window[key].bind(dom.window):dom.window[key]});
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  dom.window.HTMLElement.prototype.attachEvent=()=>{};dom.window.HTMLElement.prototype.detachEvent=()=>{};
  dom.window.Range.prototype.getBoundingClientRect=()=>({left:0,right:100,top:0,bottom:20,width:100,height:20});
  Object.defineProperty(dom.window.HTMLElement.prototype,'isContentEditable',{get(){return this.getAttribute('contenteditable')==='true';}});
  document.queryCommandState=()=>false;
  const originalSchema=api.entitySchema;api.entitySchema=async()=>({properties:[],subtypes:[],subtypeProperties:{}});
  let blocks=Array.from({length:200},(_,index)=>({id:`b${index+1}`,type:'paragraph',checked:false,content:[{text:index===199?'':`Fictitious paragraph ${index+1}`}]}));
  let entities=[],reviewMatches=[],open=()=>{};
  const root=createRoot(document.querySelector('#mount'));
  // Fresh callbacks and citation value match PageEditor; block objects remain shared.
  function App() {
    const history=useDocumentHistory({id:'fixture',vault_id:'fixture',title:'Fictitious fixture',blocks,sourceIds:[],revision:1},patch=>{blocks=patch.blocks??blocks;render();});
    return React.createElement(CitationPresentationContext.Provider,{value:{style:'references',entries:noteCitations(blocks)}},React.createElement(BlockEditor,{vaultId:'fixture',blocks,entities,reviewMatches,onChange:next=>{if(process.env.MEASURE_HISTORY==='1')history.change({blocks:next});else {blocks=next;render();}},onOpenEntity:id=>open(id),onCreateEntity(){},onAddAlias:async()=>{},onSave(){}}));
  }
  const render=()=>root.render(React.createElement(App));
  const host=id=>document.querySelector(`[data-block-id="${id}"] .block-content`);
  const caret=(el,offset)=>{const range=document.createRange();range.setStart(el.firstChild.firstChild??el.firstChild,offset);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);};
  try {
    await act(async()=>render());
    await work({dom,host,caret,blocks:()=>blocks,async set(next){blocks=next;await act(async()=>render());},async entities(next){entities=next;await act(async()=>render());},async reviews(next){reviewMatches=next;await act(async()=>render());},async onOpen(callback){open=callback;await act(async()=>render());},async rerender(){await act(async()=>render());}});
  } finally {
    await act(async()=>root.unmount());api.entitySchema=originalSchema;dom.window.close();
    keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});
  }
}

export async function measure() {
  await fixture(async({dom,host,caret,blocks})=>{
    assert.equal(document.querySelectorAll('[data-block-id]').length,200);
    const original=blocks(),el=host('b87'),text=el.firstChild.firstChild;
    caret(el,text.length);
    // Simulate a native edit before input; measure React echo separately from this write.
    text.appendData('x');caret(el,text.length);
    globalThis.__editorMetrics={rows:[],syncs:[],replacements:[]};
    const mutations=[];const observer=new MutationObserver(records=>mutations.push(...records));observer.observe(document.querySelector('#blocks'),{subtree:true,childList:true,characterData:true,attributes:true});
    await act(async()=>el.dispatchEvent(new dom.window.InputEvent('input',{bubbles:true,inputType:'insertText',data:'x'})));
    observer.disconnect();
    const metrics=globalThis.__editorMetrics;
    assert.equal(host('b87').firstChild.firstChild,text,'native text node survives React echo');
    assert.equal(getSelection().anchorNode,text);assert.equal(getSelection().anchorOffset,text.length);
    if(process.env.MEASURE_HISTORY!=='1')assert.ok(blocks().every((block,index)=>index===86||block===original[index]),'unchanged block objects stay shared');
    const result={renderedRows:metrics.rows.length,uniqueRenderedRows:new Set(metrics.rows).size,syncCalls:metrics.syncs.length,uniqueSyncedBlocks:new Set(metrics.syncs).size,editableReplacements:metrics.replacements.length,observedDOMMutations:mutations.length};
    if(process.env.EXPECT_ISOLATION==='1') {assert.deepEqual(metrics.rows,['b87']);assert.deepEqual(metrics.syncs,['b87']);assert.equal(result.editableReplacements,0);assert.equal(result.observedDOMMutations,0);}
    console.log(JSON.stringify(result));
    delete globalThis.__editorMetrics;
  });
}
if(process.env.MEASURE_EDITOR==='1')await measure();
