import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {BibliographyImport,BibliographyExport} from '../src/client/knowledge/BibliographyImport.tsx';
import {SourceBibliographyImport} from '../src/client/knowledge/SourceBibliographyImport.tsx';
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




test('changing the selected import match clears conflict choices and stale revisions require a fresh preview',async t=>{
 t.mock.method(bibliographyAPI,'preview',async()=>preview);let commits=0;t.mock.method(bibliographyAPI,'import',async()=>{commits++;throw new ApiError(409,'The source changed. Review the import again.');});
 await mount(t,BibliographyImport,{vaultId:'synthetic',onClose(){},onUpdated:async()=>{}});await change(document.querySelector('textarea'),'synthetic');await click('Review import');await change(document.querySelector('select'),'source-one');
 await change(document.querySelector('[aria-label="Resolve title for sample"]'),'current');assert.equal(button('Import reviewed entries').disabled,false);
 await change(document.querySelector('select'),'skip');await change(document.querySelector('select'),'source-one');assert.equal(document.querySelector('[aria-label="Resolve title for sample"]').value,'');assert.equal(button('Import reviewed entries').disabled,true);
 await change(document.querySelector('[aria-label="Resolve title for sample"]'),'incoming');await click('Import reviewed entries');assert.equal(commits,1);assert.equal(document.querySelector('table'),null);assert.match(document.querySelector('[role=alert]').textContent,/source changed/);assert.equal(button('Review import').disabled,false);
});
test('annotated export downloads the annotated BibLaTeX response',async t=>{
 let content;t.mock.method(bibliographyAPI,'export',async()=>({bibtex:'standard',biblatex:'biblatex',annotated:'reviewed annotation',sidecar:'{}'}));t.mock.method(URL,'createObjectURL',blob=>{content=blob;return 'blob:synthetic';});t.mock.method(URL,'revokeObjectURL',()=>{});
 const env=await mount(t,BibliographyExport,{vaultId:'synthetic'});env.dom.window.HTMLAnchorElement.prototype.click=function(){};await change(document.querySelector('select'),'annotated');await click('Export bibliography');assert.equal(await content.text(),'reviewed annotation');
});

test('import reconciliation requires explicit legacy-property approval only for changed incoming values',async t=>{
 const conflict={field:'title',proposedValue:'Synthetic study',property:{id:'legacy-title',name:'title',value:'My authored title',target_id:null},fingerprint:'synthetic-current-snapshot'};const withLegacy={...preview,entries:preview.entries.map(item=>({...item,matches:item.matches.map(match=>({...match,propertyConflicts:[conflict]}))}))};const writes=[];
 t.mock.method(bibliographyAPI,'preview',async()=>withLegacy);t.mock.method(bibliographyAPI,'import',async(...args)=>{writes.push(args);return {sourceIds:['source-one'],created:0,updated:1,skipped:0};});
 await mount(t,BibliographyImport,{vaultId:'synthetic',onClose(){},onUpdated:async()=>{}});await change(document.querySelector('textarea'),'synthetic');await click('Review import');await change(document.querySelector('select'),'source-one');
 const resolve=()=>document.querySelector('[aria-label="Resolve title for sample"]');await change(resolve(),'current');assert.equal(button('Import reviewed entries').disabled,false);assert.equal(document.querySelector('[aria-label="Review preserved title for sample"]'),null);
 await change(resolve(),'incoming');assert.equal(button('Import reviewed entries').disabled,true);const approval=()=>document.querySelector('[aria-label="Review preserved title for sample"]');assert.match(document.querySelector('.bibliography-consent').textContent,/My authored title.*preserved as evidence/);await change(approval(),true);assert.equal(button('Import reviewed entries').disabled,false);
 await change(resolve(),'current');await change(resolve(),'incoming');assert.equal(approval().checked,false);await change(approval(),true);await click('Import reviewed entries');assert.deepEqual(writes[0][2][0].reviewedProperties,[{propertyId:'legacy-title',fingerprint:'synthetic-current-snapshot'}]);
});




test('compact publication presents facts and reference copy without duplicate publication editing or advanced operations',async t=>{
 t.mock.method(bibliographyAPI,'record',async()=>({sourceId:'source-one',citationKey:'sample',entryType:'book',fields:{title:'Canonical title',author:'Author, Ada',year:'2024'},revision:1,provenance:{},rawImports:[]}));
 let edits=0;await mount(t,BibliographyEditor,{vaultId:'synthetic',entity:{id:'source-one',name:'Synthetic',attachments:[],relationships:[]},compact:true,onEditDetails(){edits++;},onUpdated:async()=>{}});
 assert.match(document.querySelector('.bibliography-editor').textContent,/Canonical title/);assert.equal(document.querySelector('.bibliography-fields'),null);assert.equal([...document.querySelectorAll('summary')].some(item=>item.textContent==='BibTeX & advanced'),false);assert.ok(button('Copy reference'));await click('Edit publication details');assert.equal(edits,1);
});

test('source scoped import requires every conflict decision, preserves authored evidence and rejects stale preview',async t=>{
 const scoped={sourceId:'source-one',batchId:'batch',revision:4,entry,conflicts:[{field:'title',current:'Authored title',incoming:'Synthetic study',currentOrigin:'manual'}],propertyConflicts:[{field:'title',proposedValue:'Synthetic study',property:{id:'old',name:'title',value:'Original title',target_id:null},fingerprint:'review-original'}],warnings:[]};
 t.mock.method(bibliographyAPI,'sourcePreview',async()=>scoped);const calls=[];t.mock.method(bibliographyAPI,'sourceImport',async(...args)=>{calls.push(args);throw new ApiError(409,'Source changed. Review again.');});
 await mount(t,SourceBibliographyImport,{vaultId:'synthetic',sourceId:'source-one',title:'Chosen source',onClose(){},onUpdated:async()=>{}});
 await change(document.querySelector('textarea'),'@book{sample,title={Synthetic study}}');await click('Review source import');assert.match(document.querySelector('dialog').textContent,/Target Source: Chosen source/);assert.equal(button('Apply reviewed import').disabled,true);
 await change(document.querySelector('[aria-label="Resolve source title"]'),'incoming');assert.equal(button('Apply reviewed import').disabled,true);await change(document.querySelector('.bibliography-consent input'),true);assert.equal(button('Apply reviewed import').disabled,false);
 await change(document.querySelector('[aria-label="Resolve source title"]'),'current');await change(document.querySelector('[aria-label="Resolve source title"]'),'incoming');assert.equal(document.querySelector('.bibliography-consent input').checked,false);await change(document.querySelector('.bibliography-consent input'),true);await click('Apply reviewed import');assert.equal(calls[0][1],'source-one');assert.equal(calls[0][2].revision,4);assert.deepEqual(calls[0][2].reviewedProperties,[{propertyId:'old',fingerprint:'review-original'}]);assert.equal(button('Apply reviewed import'),undefined);assert.ok(button('Review source import'));assert.match(document.querySelector('[role=alert]').textContent,/Source changed/);
});

test('source export requests only the selected source and metadata-only sources can import their first record',async t=>{
 const calls=[];t.mock.method(bibliographyAPI,'record',async()=>null);t.mock.method(bibliographyAPI,'export',()=>{throw new Error('Must not export collection');});
 const f=await mount(t,BibliographyEditor,{vaultId:'synthetic',entity:{id:'source-one',name:'Metadata source',attachments:[],relationships:[]},onUpdated:async()=>{}});
 const advanced=[...document.querySelectorAll('details')].find(item=>item.querySelector('summary')?.textContent==='BibTeX & advanced');await act(async()=>{advanced.open=true;props(advanced).onToggle({currentTarget:advanced});});assert.match(document.querySelector('.bibliography-editor').textContent,/Metadata only/);await click('Import BibTeX into this source…');assert.match(document.querySelector('dialog').textContent,/Target Source: Metadata source/);
 await act(async()=>f.root.render(createElement(BibliographyEditor,{vaultId:'synthetic',entity:{id:'source-two',name:'Second',attachments:[],relationships:[]},onUpdated:async()=>{}})));assert.equal(document.querySelector('dialog'),null);assert.deepEqual(calls,[]);
});

test('new source single-entry import rejects a multi-entry bibliography',async t=>{
 t.mock.method(bibliographyAPI,'preview',async()=>({...preview,entries:[...preview.entries,{...preview.entries[0],index:1}]}));await mount(t,BibliographyImport,{vaultId:'synthetic',single:true,onClose(){},onUpdated:async()=>{}});await change(document.querySelector('textarea'),'two entries');await click('Review import');assert.match(document.querySelector('[role=alert]').textContent,/exactly one BibTeX entry/);assert.equal(document.querySelector('table'),null);
});

test('advanced export fetches only the chosen Source and downloads its selected format',async t=>{
 const calls=[];let content;t.mock.method(bibliographyAPI,'record',async()=>({sourceId:'chosen-source',citationKey:'chosen',entryType:'book',fields:{title:'Chosen title'},revision:1,provenance:{},rawImports:[]}));t.mock.method(bibliographyAPI,'export',()=>{throw new Error('Must never fetch whole vault');});t.mock.method(bibliographyAPI,'sourceExport',async(...args)=>{calls.push(args);return {bibtex:'chosen bibtex',biblatex:'chosen biblatex',annotated:'chosen annotation',sidecar:{}};});t.mock.method(URL,'createObjectURL',blob=>{content=blob;return 'blob:synthetic';});t.mock.method(URL,'revokeObjectURL',()=>{});
 const env=await mount(t,BibliographyEditor,{vaultId:'synthetic',entity:{id:'chosen-source',name:'Chosen',attachments:[],relationships:[]},onUpdated:async()=>{}});env.dom.window.HTMLAnchorElement.prototype.click=function(){};
 const advanced=[...document.querySelectorAll('details')].find(item=>item.querySelector('summary')?.textContent==='BibTeX & advanced');await act(async()=>{advanced.open=true;props(advanced).onToggle({currentTarget:advanced});});await change(document.querySelector('[aria-label="Source export format"]'),'annotated');await click('Export this source');assert.equal(calls.length,1);assert.equal(calls[0][0],'synthetic');assert.equal(calls[0][1],'chosen-source');assert.equal(await content.text(),'chosen annotation');
});
