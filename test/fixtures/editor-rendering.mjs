import assert from 'node:assert/strict';
import {setupDOM} from '../helpers/dom.mjs';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {BlockEditor} from '../../src/client/editor/BlockEditor.tsx';
import {CitationPresentationContext} from '../../src/client/sources/CitationPresentation.tsx';
import {noteCitations} from '../../src/shared/citations.ts';
import {useDocumentHistory} from '../../src/client/editor/use-document-history.ts';
import {immutableBlocks} from '../../src/shared/immutable-blocks.ts';
import {api} from '../../src/client/api.ts';

// Counts include the final empty typing row.
export async function fixture(work,{blockCount=6}={}) {
  const env=setupDOM(undefined,{html:'<div class="page"><div id="mount"></div></div>'}),{dom}=env;
  const originalSchema=api.entitySchema;api.entitySchema=async()=>({properties:[],subtypes:[],subtypeProperties:{}});
  let blocks=immutableBlocks(Array.from({length:blockCount},(_,index)=>({id:`b${index+1}`,type:'paragraph',checked:false,content:[{text:index===blockCount-1?'':`Fictitious paragraph ${index+1}`}]})));
  let entities=[],reviewMatches=[],open=()=>{},language;
  env.defer(()=>{api.entitySchema=originalSchema;});
  const root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  // Fresh callbacks and citation value match PageEditor; block objects remain shared.
  function App() {
    const history=useDocumentHistory({id:'fixture',vault_id:'fixture',title:'Fictitious fixture',blocks,sourceIds:[],revision:1},patch=>{blocks=patch.blocks??blocks;render();});
    return React.createElement(CitationPresentationContext.Provider,{value:{style:'references',entries:noteCitations(blocks)}},React.createElement(BlockEditor,{vaultId:'fixture',language,blocks,entities,reviewMatches,onChange:next=>{if(process.env.MEASURE_HISTORY==='1')history.change({blocks:next});else {blocks=next;render();}},onOpenEntity:id=>open(id),onCreateEntity(){},onAddAlias:async()=>{},onSave(){}}));
  }
  const render=()=>root.render(React.createElement(App));
  const host=id=>document.querySelector(`[data-block-id="${id}"] .block-content`);
  const caret=(el,offset)=>{const range=document.createRange();range.setStart(el.firstChild.firstChild??el.firstChild,offset);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);};
  try {
    await act(async()=>render());
    await work({dom,host,caret,blocks:()=>blocks,async set(next){blocks=next;await act(async()=>render());},async entities(next){entities=next;await act(async()=>render());},async reviews(next){reviewMatches=next;await act(async()=>render());},async onOpen(callback){open=callback;await act(async()=>render());},async language(next){language=next;await act(async()=>render());},async rerender(){await act(async()=>render());}});
  } finally {
    await env.close();
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
  },{blockCount:200});
}
if(process.env.MEASURE_EDITOR==='1')await measure();
