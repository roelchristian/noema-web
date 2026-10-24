import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {BibliographyImport,BibliographyExport} from '../src/client/knowledge/BibliographyImport.tsx';
import {BibliographyEditor} from '../src/client/knowledge/BibliographyEditor.tsx';
import {bibliographyAPI} from '../src/client/knowledge/BibliographyAPI.ts';
import {ApiError} from '../src/client/api.ts';
import {setupDOM} from './helpers/dom.mjs';
const props=element=>element[Object.keys(element).find(key=>key.startsWith('__reactProps'))];
const button=text=>[...document.querySelectorAll('button')].find(item=>item.textContent===text);
const change=(element,value)=>act(async()=>props(element).onChange({target:{value,checked:value}}));
const click=text=>act(async()=>button(text).click());
const entry={citationKey:'sample',entryType:'book',fields:{title:'Synthetic study',author:'Author, Ada',year:'2024'}};
const preview={batchId:'synthetic',entries:[{index:0,entry,matches:[{sourceId:'source-one',title:'Existing synthetic source',reason:'doi',revision:4,conflicts:[{field:'title',current:'Existing synthetic source',incoming:'Synthetic study',currentOrigin:'manual'}]}],conflicts:['title']}],warnings:[]};
async function mount(t,Component,options){const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};env.defer(()=>act(async()=>root.unmount()));await act(async()=>root.render(createElement(Component,options)));return {...env,root};}
test('bibliography import defaults matches to skip, reviews explicit conflict decisions and safely retries',async t=>{
 let attempts=0,refresh=0;const calls=[];
 t.mock.method(bibliographyAPI,'preview',async()=>preview);
 t.mock.method(bibliographyAPI,'import',async(...args)=>{calls.push(args);if(++attempts===1)throw new Error('Synthetic retry');return {created:0,updated:1,skipped:0,sourceIds:['source-one']};});
 await mount(t,BibliographyImport,{vaultId:'synthetic',onClose(){},onUpdated:async()=>{refresh++;}});
 await change(document.querySelector('textarea'),'@book{sample,title={Synthetic study}}');await click('Review import');
 assert.equal(document.querySelector('select').value,'skip');assert.equal(button('Import reviewed entries').disabled,true);assert.match(document.querySelector('table').textContent,/title/);
 await change(document.querySelector('select'),'source-one');assert.equal(button('Import reviewed entries').disabled,true);assert.match(document.querySelector('table').textContent,/Current \(manual\): Existing synthetic source/);await change(document.querySelector('[aria-label="Resolve title for sample"]'),'incoming');await click('Import reviewed entries');assert.match(document.querySelector('[role=alert]').textContent,/Synthetic retry/);
 assert.equal(document.querySelector('select').value,'source-one');await click('Import reviewed entries');
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1][2],[{index:0,action:'merge',sourceId:'source-one',revision:4,fields:{title:'incoming'}}]);assert.equal(refresh,1);assert.match(document.querySelector('[role=status]').textContent,/1 updated/);
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
 t.mock.method(bibliographyAPI,'reconcilePreview',async()=>({conflicts:[]}));
 t.mock.method(bibliographyAPI,'accept',async(_vault,_id,body)=>{accepted.push(body);return {...record,fields:{...record.fields,...body.fields},revision:3};});
 await mount(t,BibliographyEditor,{vaultId:'synthetic',entity:{id:'source-one',name:'Synthetic',attachments:[],relationships:[]},onUpdated:async()=>{}});
 assert.equal(verifies,0);assert.equal(button('Look up DOI').disabled,true);assert.match(document.querySelector('.bibliography-consent').textContent,/DOI to Crossref/);
 await change(document.querySelector('.bibliography-consent input'),true);await click('Look up DOI');assert.equal(verifies,1);assert.equal(accepted.length,0);assert.match(document.querySelector('.bibliography-proposals').textContent,/Current: Authored title/);
 const checks=document.querySelectorAll('.bibliography-proposal input');await change(checks[1],true);await click('Accept selected facts');assert.deepEqual(accepted[0].fields,{publisher:'Synthetic Press'});assert.equal(accepted[0].proposalId,'proposal');
 assert.equal(document.querySelector('.bibliography-fields input').value,'Authored title');assert.match(document.querySelector('.bibliography-raw').textContent,/keep/);
});

test('a late DOI lookup cannot replace the next Source after an identity switch',async t=>{
 let finish;const record=id=>({sourceId:id,citationKey:id,entryType:'book',fields:{title:id,doi:'10.1234/synthetic'},revision:1,provenance:{},rawImports:[]});
 t.mock.method(bibliographyAPI,'record',async(_vault,id)=>record(id));t.mock.method(bibliographyAPI,'verify',()=>new Promise(resolve=>{finish=resolve;}));
 const options={vaultId:'synthetic',entity:{id:'first-source',name:'First',attachments:[],relationships:[]},onUpdated:async()=>{}};const f=await mount(t,BibliographyEditor,options);
 await change(document.querySelector('.bibliography-consent input'),true);await click('Look up DOI');
 await act(async()=>f.root.render(createElement(BibliographyEditor,{...options,entity:{id:'second-source',name:'Second',attachments:[],relationships:[]}})));
 await act(async()=>finish({proposalId:'stale',provider:'Crossref',revision:1,fields:{title:'First source external title'}}));
 assert.equal(document.querySelector('.bibliography-proposals'),null);assert.equal(document.querySelector('.bibliography-fields input').value,'second-source');assert.equal(button('Look up DOI').disabled,true);assert.equal(document.querySelector('.bibliography-consent input').checked,false);
});

test('changing the selected import match clears conflict choices and stale revisions require a fresh preview',async t=>{
 t.mock.method(bibliographyAPI,'preview',async()=>preview);let commits=0;t.mock.method(bibliographyAPI,'import',async()=>{commits++;throw new ApiError(409,'The source changed. Review the import again.');});
 await mount(t,BibliographyImport,{vaultId:'synthetic',onClose(){},onUpdated:async()=>{}});await change(document.querySelector('textarea'),'synthetic');await click('Review import');await change(document.querySelector('select'),'source-one');
 await change(document.querySelector('[aria-label="Resolve title for sample"]'),'current');assert.equal(button('Import reviewed entries').disabled,false);
 await change(document.querySelector('select'),'skip');await change(document.querySelector('select'),'source-one');assert.equal(document.querySelector('[aria-label="Resolve title for sample"]').value,'');assert.equal(button('Import reviewed entries').disabled,true);
 await change(document.querySelector('[aria-label="Resolve title for sample"]'),'incoming');await click('Import reviewed entries');assert.equal(commits,1);assert.equal(document.querySelector('table'),null);assert.match(document.querySelector('[role=alert]').textContent,/source changed/);assert.equal(button('Review import').disabled,false);
});

test('import reconciliation requires explicit legacy-property approval only for changed incoming values',async t=>{
 const conflict={field:'title',proposedValue:'Synthetic study',property:{id:'legacy-title',name:'title',value:'My authored title',target_id:null},fingerprint:'synthetic-current-snapshot'};const withLegacy={...preview,entries:preview.entries.map(item=>({...item,matches:item.matches.map(match=>({...match,propertyConflicts:[conflict]}))}))};const writes=[];
 t.mock.method(bibliographyAPI,'preview',async()=>withLegacy);t.mock.method(bibliographyAPI,'import',async(...args)=>{writes.push(args);return {sourceIds:['source-one'],created:0,updated:1,skipped:0};});
 await mount(t,BibliographyImport,{vaultId:'synthetic',onClose(){},onUpdated:async()=>{}});await change(document.querySelector('textarea'),'synthetic');await click('Review import');await change(document.querySelector('select'),'source-one');
 const resolve=()=>document.querySelector('[aria-label="Resolve title for sample"]');await change(resolve(),'current');assert.equal(button('Import reviewed entries').disabled,false);assert.equal(document.querySelector('[aria-label="Review preserved title for sample"]'),null);
 await change(resolve(),'incoming');assert.equal(button('Import reviewed entries').disabled,true);const approval=()=>document.querySelector('[aria-label="Review preserved title for sample"]');assert.match(document.querySelector('.bibliography-consent').textContent,/My authored title.*preserved as evidence/);await change(approval(),true);assert.equal(button('Import reviewed entries').disabled,false);
 await change(resolve(),'current');await change(resolve(),'incoming');assert.equal(approval().checked,false);await change(approval(),true);await click('Import reviewed entries');assert.deepEqual(writes[0][2][0].reviewedProperties,[{propertyId:'legacy-title',fingerprint:'synthetic-current-snapshot'}]);
});
test('canonical editor requires fingerprinted authored-property reconciliation and clears approval on draft changes',async t=>{
 const record={sourceId:'source-one',citationKey:'sample',entryType:'article',fields:{title:'Synthetic',doi:'10.1234/old'},revision:1,provenance:{},rawImports:[]};
 const conflict={field:'doi',proposedValue:'10.1234/new',property:{id:'authored-doi',name:'DOI',value:'10.1234/old',target_id:null},fingerprint:'exact-snapshot'};let reviews=0;const saves=[];
 t.mock.method(bibliographyAPI,'record',async()=>record);t.mock.method(bibliographyAPI,'reconcilePreview',async(_vault,_id,body)=>{reviews++;assert.equal(body.fields.doi,'10.1234/new');return {conflicts:[conflict]};});
 t.mock.method(bibliographyAPI,'save',async(_vault,_id,body)=>{saves.push(body);return {...record,...body,revision:2};});
 await mount(t,BibliographyEditor,{vaultId:'synthetic',entity:{id:'source-one',name:'Synthetic',attachments:[],relationships:[]},onUpdated:async()=>{}});
 const doi=()=>[...document.querySelectorAll('.bibliography-fields label')].find(label=>label.textContent==='doi').querySelector('input');
 await change(doi(),'10.1234/new');await click('Save bibliographic facts');assert.equal(saves.length,0);assert.equal(reviews,1);assert.match(document.querySelector('[aria-label="Authored property reconciliation"]').textContent,/Original authored properties remain unchanged/);assert.equal(button('Save reviewed facts').disabled,true);
 await change(document.querySelector('[aria-label="Authored property reconciliation"] input'),true);await change(doi(),'10.1234/old');assert.equal(document.querySelector('[aria-label="Authored property reconciliation"]'),null);
 await change(doi(),'10.1234/new');await click('Save bibliographic facts');assert.equal(button('Save reviewed facts').disabled,true);await change(document.querySelector('[aria-label="Authored property reconciliation"] input'),true);await click('Save reviewed facts');assert.equal(saves.length,1);assert.deepEqual(saves[0].reviewedProperties,[{propertyId:'authored-doi',fingerprint:'exact-snapshot'}]);
});
