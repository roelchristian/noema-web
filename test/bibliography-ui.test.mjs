import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {BibliographyImport} from '../src/client/knowledge/BibliographyImport.tsx';
import {BibliographyEditor} from '../src/client/knowledge/BibliographyEditor.tsx';
import {bibliographyAPI} from '../src/client/knowledge/BibliographyAPI.ts';
import {setupDOM} from './helpers/dom.mjs';
const props=element=>element[Object.keys(element).find(key=>key.startsWith('__reactProps'))];
const button=text=>[...document.querySelectorAll('button')].find(item=>item.textContent===text);
const change=(element,value)=>act(async()=>props(element).onChange({target:{value,checked:value}}));
const click=text=>act(async()=>button(text).click());
const entry={citationKey:'sample',entryType:'book',fields:{title:'Synthetic study',author:'Author, Ada',year:'2024'}};
const preview={batchId:'synthetic',entries:[{index:0,entry,matches:[{sourceId:'source-one',title:'Existing synthetic source',reason:'doi',revision:4}],conflicts:['title']}],warnings:[]};
async function mount(t,Component,options){const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};env.defer(()=>act(async()=>root.unmount()));await act(async()=>root.render(createElement(Component,options)));return {...env,root};}
test('bibliography import defaults matches to skip, reviews explicit conflict decisions and safely retries',async t=>{
 let attempts=0,refresh=0;const calls=[];
 t.mock.method(bibliographyAPI,'preview',async()=>preview);
 t.mock.method(bibliographyAPI,'import',async(...args)=>{calls.push(args);if(++attempts===1)throw new Error('Synthetic retry');return {created:0,updated:1,skipped:0,sourceIds:['source-one']};});
 await mount(t,BibliographyImport,{vaultId:'synthetic',onClose(){},onUpdated:async()=>{refresh++;}});
 await change(document.querySelector('textarea'),'@book{sample,title={Synthetic study}}');await click('Review import');
 assert.equal(document.querySelector('select').value,'skip');assert.equal(button('Import reviewed entries').disabled,true);assert.match(document.querySelector('table').textContent,/title/);
 await change(document.querySelector('select'),'source-one');await click('Import reviewed entries');assert.match(document.querySelector('[role=alert]').textContent,/Synthetic retry/);
 assert.equal(document.querySelector('select').value,'source-one');await click('Import reviewed entries');
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1][2],[{index:0,action:'merge',sourceId:'source-one',revision:4}]);assert.equal(refresh,1);assert.match(document.querySelector('[role=status]').textContent,/1 updated/);
});
test('editing a bibliography cancels its pending preview and ignores a late response',async t=>{
 let resolve,signal;
 t.mock.method(bibliographyAPI,'preview',(_vault,_raw,value)=>{signal=value;return new Promise(done=>{resolve=done;});});
 let closed=0;await mount(t,BibliographyImport,{vaultId:'synthetic',onClose(){closed++;},onUpdated:async()=>{}});
 await change(document.querySelector('textarea'),'old');await click('Review import');await change(document.querySelector('textarea'),'new');assert.equal(signal.aborted,true);
 await act(async()=>resolve(preview));assert.equal(document.querySelector('table'),null);assert.equal(document.querySelector('textarea').value,'new');await click('Cancel');assert.equal(closed,1);
});
test('DOI verification requires disclosure and preserves current facts until individually accepted',async t=>{
 const record={sourceId:'source-one',citationKey:'sample',entryType:'book',fields:{title:'Authored title',doi:'10.1234/synthetic',custom:'keep'},revision:2,provenance:{},rawImports:['@book{sample, custom={keep}}']};
 const accepted=[];let verifies=0;
 t.mock.method(bibliographyAPI,'record',async()=>record);t.mock.method(bibliographyAPI,'verify',async()=>{verifies++;return {proposalId:'proposal',provider:'Crossref',revision:2,fields:{title:'External title',publisher:'Synthetic Press'}};});
 t.mock.method(bibliographyAPI,'accept',async(_vault,_id,body)=>{accepted.push(body);return {...record,fields:{...record.fields,...body.fields},revision:3};});
 await mount(t,BibliographyEditor,{vaultId:'synthetic',entity:{id:'source-one',name:'Synthetic',attachments:[]},onUpdated:async()=>{}});
 assert.equal(verifies,0);assert.equal(button('Look up DOI').disabled,true);assert.match(document.querySelector('.bibliography-consent').textContent,/DOI to Crossref/);
 await change(document.querySelector('.bibliography-consent input'),true);await click('Look up DOI');assert.equal(verifies,1);assert.equal(accepted.length,0);assert.match(document.querySelector('.bibliography-proposals').textContent,/Current: Authored title/);
 const checks=document.querySelectorAll('.bibliography-proposal input');await change(checks[1],true);await click('Accept selected facts');assert.deepEqual(accepted[0].fields,{publisher:'Synthetic Press'});assert.equal(accepted[0].proposalId,'proposal');
 assert.equal(document.querySelector('.bibliography-fields input').value,'Authored title');assert.match(document.querySelector('.bibliography-raw').textContent,/keep/);
});

test('a late DOI lookup cannot replace the next Source after an identity switch',async t=>{
 let finish;const record=id=>({sourceId:id,citationKey:id,entryType:'book',fields:{title:id,doi:'10.1234/synthetic'},revision:1,provenance:{},rawImports:[]});
 t.mock.method(bibliographyAPI,'record',async(_vault,id)=>record(id));t.mock.method(bibliographyAPI,'verify',()=>new Promise(resolve=>{finish=resolve;}));
 const options={vaultId:'synthetic',entity:{id:'first-source',name:'First',attachments:[]},onUpdated:async()=>{}};const f=await mount(t,BibliographyEditor,options);
 await change(document.querySelector('.bibliography-consent input'),true);await click('Look up DOI');
 await act(async()=>f.root.render(createElement(BibliographyEditor,{...options,entity:{id:'second-source',name:'Second',attachments:[]}})));
 await act(async()=>finish({proposalId:'stale',provider:'Crossref',revision:1,fields:{title:'First source external title'}}));
 assert.equal(document.querySelector('.bibliography-proposals'),null);assert.equal(document.querySelector('.bibliography-fields input').value,'second-source');assert.equal(button('Look up DOI').disabled,true);assert.equal(document.querySelector('.bibliography-consent input').checked,false);
});
