import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {bibliographyChanged} from '../src/client/sources/bibliography-events.ts';
import {bibliographyAPI} from '../src/client/knowledge/BibliographyAPI.ts';
import {SourceMetadata} from '../src/client/sources/SourceMetadata.tsx';
import {sourceMetadataAPI} from '../src/client/sources/SourceMetadataAPI.ts';
import {setupDOM} from './helpers/dom.mjs';
const reactProps=element=>element[Object.keys(element).find(key=>key.startsWith('__reactProps'))];
const button=text=>[...document.querySelectorAll('button')].find(item=>item.textContent===text);
const click=text=>act(async()=>button(text).click());
const change=(input,value)=>act(async()=>reactProps(input).onChange({target:{value}}));
const evidence={fileId:'synthetic-file',runId:'synthetic-run',version:'canonical',revision:'revision-one',excerpt:'Published by Synthetic Press',start:0,end:28,evidenceHash:'synthetic-hash',validated:true,validationReason:'Explicit imprint'};
function snapshot(id='source-one'){
 const suggestion={id:'suggestion',fieldKey:'bibliography:publisher',value:'Synthetic Press',targetId:null,status:'pending',fingerprint:'fresh-proposal',stale:false,staleReason:null,compatible:true,evidence:[evidence],details:'Title-page imprint',createdAt:'2026-01-01',updatedAt:'2026-01-01'};
 return {sourceId:id,policy:'review',counts:{confirmed:2,suggested:1,conflicts:0},fields:[{key:'source:display_name',label:'Source display name',owner:'source',value:'My reading copy',editable:true,fingerprint:'name-fingerprint',proposals:[],history:[]},{key:'bibliography:title',label:'Bibliographic title',owner:'bibliography',value:'Published title',editable:true,fingerprint:'title-fingerprint',proposals:[],history:[]},{key:'bibliography:publisher',label:'Publisher',owner:'bibliography',value:null,editable:true,fingerprint:'publisher-fingerprint',proposals:[suggestion],history:[{...suggestion,id:'old',status:'superseded',value:'Earlier Press'}]}]};
}
async function mount(t,options={}){const env=setupDOM(t),root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));const props={vaultId:'synthetic',sourceId:'source-one',onUpdated:async()=>{},...options};await act(async()=>root.render(createElement(SourceMetadata,props)));return {root,props};}
test('metadata shows distinct titles, inline correction, evidence and retained field history',async t=>{
 t.mock.method(sourceMetadataAPI,'snapshot',async()=>{const value=snapshot();value.fields.push({key:'property:author',label:'Author entity',owner:'property',value:null,targetId:'writer',targetName:'Synthetic Writer',editable:false,fingerprint:'ref-fingerprint',proposals:[],history:[]});value.fields[2].preservedValues=[{id:'manual',name:'publisher',value:'Authored Press',target_id:null}];return value;});let submitted;
 t.mock.method(sourceMetadataAPI,'review',async(_vault,_id,body)=>{submitted=body;const next=snapshot();next.fields[2].value=body.value;next.fields[2].proposals=[];return next;});
 await mount(t);assert.match(document.querySelector('dl').textContent,/Source display name.*My reading copy.*Bibliographic title.*Published title/s);
 assert.match(document.querySelector('.source-metadata-evidence').textContent,/synthetic-file.*canonical version revision-one.*synthetic-run.*Title-page|Title-page.*synthetic-file/s);
 assert.match(document.querySelector('dl').textContent,/Author entitySynthetic Writer/);assert.match(document.querySelector('.source-metadata-preserved').textContent,/Authored Press/);assert.equal(button('Accept').disabled,true);
 await click('Edit and accept');await change(document.querySelector('.source-metadata-suggestion input:not([type=checkbox])'),'Corrected Press');assert.equal(button('Save correction and accept').disabled,true);await act(async()=>reactProps(document.querySelector('.source-metadata-consent input')).onChange({target:{checked:true}}));await click('Save correction and accept');
 assert.deepEqual(submitted,{proposalId:'suggestion',fingerprint:'fresh-proposal',action:'accept',preserveAuthoredValues:true,value:'Corrected Press'});assert.match(document.querySelector('dl').textContent,/Corrected Press/);assert.equal(document.querySelector('.source-metadata-suggestion'),null);
 await click('Show history');assert.match(document.querySelector('.source-metadata-history').textContent,/superseded.*Earlier Press/);
});
test('compatible batch submits fingerprints once and preserves its exact outcome report without polling',async t=>{
 let reads=0,writes=0;t.mock.method(sourceMetadataAPI,'snapshot',async()=>{reads++;return snapshot();});
 let finish;t.mock.method(sourceMetadataAPI,'batch',(_vault,_id,body)=>{writes++;assert.deepEqual(body,{proposals:[{proposalId:'suggestion',fingerprint:'fresh-proposal'}]});return new Promise(resolve=>{finish=resolve;});});
 await mount(t);await click('Accept compatible suggestions (1)');assert.equal(button('Accept compatible suggestions (1)').disabled,true);await act(async()=>button('Accept compatible suggestions (1)').click());assert.equal(writes,1);
 await act(async()=>finish({changed:['bibliography:publisher'],satisfied:['bibliography:title'],attention:['bibliography:year'],snapshot:snapshot()}));assert.match(document.querySelector('[role=status]').textContent,/1 changed · 1 already satisfied · 1 need attention/);assert.equal(reads,1);
});
test('uncertain writes require read-before-retry and late responses cannot replace a different Source',async t=>{
 t.mock.method(sourceMetadataAPI,'snapshot',async(_vault,id)=>snapshot(id));let attempts=0;t.mock.method(sourceMetadataAPI,'review',async()=>{attempts++;throw new Error('connection interrupted');});
 const {root,props}=await mount(t,{sourceId:'uncertain-source'});await click('Accept');assert.equal(attempts,1);assert.equal(button('Accept').disabled,true);assert.match(document.querySelector('[role=alert]').textContent,/Reload metadata to check/);
 await click('Reload metadata');assert.equal(button('Accept').disabled,false);
 let finish;t.mock.method(sourceMetadataAPI,'review',()=>new Promise(resolve=>{finish=resolve;}));await click('Accept');await act(async()=>root.render(createElement(SourceMetadata,{...props,sourceId:'second-source'})));await act(async()=>root.render(createElement(SourceMetadata,props)));assert.match(document.querySelector('[role=status]').textContent,/Loading metadata/);await act(async()=>finish({...snapshot(),fields:[]}));assert.match(document.querySelector('dl').textContent,/Published title/);assert.equal(document.querySelector('[role=status]'),null);
});

async function publicationControls(){const details=[...document.querySelectorAll('details')].find(item=>item.querySelector('summary')?.textContent==='DOI verification & publication controls');await act(async()=>reactProps(details).onToggle({currentTarget:{open:true}}));}
const check=(input,checked)=>act(async()=>reactProps(input).onChange({target:{checked}}));
test('canonical Metadata owns consented DOI proposals beside fields and preserves reconciliation',async t=>{
 const record={sourceId:'source-one',citationKey:'stable',entryType:'book',fields:{title:'Published title',doi:'10.1234/synthetic',date:'2024-05-01'},revision:2,provenance:{},rawImports:['original']};
 t.mock.method(sourceMetadataAPI,'snapshot',async()=>{const value=snapshot();value.fields.push({key:'bibliography:date',label:'Publication date',owner:'bibliography',value:'2024',editable:true,fingerprint:'date-fingerprint',proposals:[],history:[]});return value;});
 t.mock.method(bibliographyAPI,'record',async()=>record);let verifies=0,accepted;
 t.mock.method(bibliographyAPI,'verify',async()=>{verifies++;return {proposalId:'doi-proposal',provider:'Crossref',revision:2,fields:{title:'External title',year:'2025'}};});
 const conflict={field:'title',proposedValue:'External title',property:{id:'legacy',name:'title',value:'Authored title',target_id:null},fingerprint:'review-fingerprint'};
 t.mock.method(bibliographyAPI,'reconcilePreview',async(_vault,_id,body)=>{assert.equal(body.fields.date,'2025');assert.equal(body.fields.year,undefined);return {conflicts:[conflict]};});
 t.mock.method(bibliographyAPI,'accept',async(_vault,_id,body)=>{accepted=body;return {...record,revision:3};});
 await mount(t);assert.equal(verifies,0);assert.equal(button('Look up DOI'),undefined);await publicationControls();assert.equal(button('Look up DOI').disabled,true);await check(document.querySelector('.bibliography-consent input'),true);await click('Look up DOI');
 assert.equal(verifies,1);assert.match(document.querySelector('dl').textContent,/DOI proposal · Crossref.*Current: Published title.*Proposed: External title/s);assert.match(document.querySelector('dl').textContent,/Publication date.*Proposed: 2025/s);
 await check(document.querySelector('[aria-label="Accept DOI title"]'),true);await check(document.querySelector('[aria-label="Accept DOI year"]'),true);await click('Accept selected facts');assert.equal(accepted,undefined);assert.equal(button('Accept selected facts').disabled,true);await check(document.querySelector('[aria-label="Authored property reconciliation"] input'),true);await click('Accept selected facts');
 assert.deepEqual(accepted.fields,{title:'External title',year:'2025'});assert.deepEqual(accepted.reviewedProperties,[{propertyId:'legacy',fingerprint:'review-fingerprint'}]);assert.equal(document.querySelector('[aria-label="Accept DOI title"]'),null);
});
test('DOI lookup is isolated across Source switches and metadata writes wait while lookup is active',async t=>{
 t.mock.method(sourceMetadataAPI,'snapshot',async(_vault,id)=>{const value=snapshot(id);value.fields[2].proposals[0].compatible=false;return value;});let metadataWrites=0;t.mock.method(sourceMetadataAPI,'review',async()=>{metadataWrites++;throw Error('DOI lookup must block metadata writes');});t.mock.method(bibliographyAPI,'record',async(_vault,id)=>({sourceId:id,citationKey:id,entryType:'book',fields:{doi:'10.1234/synthetic'},revision:1,provenance:{},rawImports:[]}));let finish;
 t.mock.method(bibliographyAPI,'verify',()=>new Promise(resolve=>{finish=resolve;}));const {root,props}=await mount(t);await publicationControls();await check(document.querySelector('.bibliography-consent input'),true);await click('Look up DOI');assert.equal(button('Accept').disabled,true);assert.equal(button('Accept non-conflicting suggestions (1)').disabled,true);await act(async()=>reactProps(button('Accept non-conflicting suggestions (1)')).onClick());assert.equal(metadataWrites,0);
 await act(async()=>root.render(createElement(SourceMetadata,{...props,sourceId:'second-source'})));await act(async()=>finish({proposalId:'stale',provider:'Crossref',revision:1,fields:{title:'First external title'}}));assert.equal(document.querySelector('.bibliography-proposal'),null);assert.equal(button('Look up DOI'),undefined);await publicationControls();assert.equal(document.querySelector('.bibliography-consent input').checked,false);
});

test('entry type is revision guarded and uncertain writes require a publication reload',async t=>{
 const record={sourceId:'publication-write',citationKey:'stable-key',entryType:'book',fields:{title:'Published title',custom:'retain'},revision:7,provenance:{},rawImports:['original']};
 t.mock.method(sourceMetadataAPI,'snapshot',async()=>snapshot('publication-write'));t.mock.method(bibliographyAPI,'record',async()=>record);let finish,submitted;
 t.mock.method(bibliographyAPI,'save',(_vault,_id,body)=>{submitted=body;return new Promise((_resolve,reject)=>{finish=reject;});});
 const {root,props}=await mount(t,{sourceId:'publication-write'});await publicationControls();assert.equal(document.querySelector('.bibliography-field input').readOnly,true);await change(document.querySelector('[aria-label="Publication entry type"]'),'article');await click('Save entry type');assert.equal(button('Cancel request'),undefined);assert.equal(button('Accept').disabled,true);assert.deepEqual(submitted,{revision:7,citationKey:'stable-key',entryType:'article',fields:record.fields});
 await act(async()=>finish(new Error('lost response')));assert.match(document.querySelector('[role=alert]').textContent,/Could not confirm/);assert.equal(button('Accept').disabled,true);
 await act(async()=>root.render(createElement(SourceMetadata,{...props,sourceId:'other-source'})));await act(async()=>root.render(createElement(SourceMetadata,props)));assert.equal(button('Accept').disabled,true);await publicationControls();assert.equal(button('Accept').disabled,false);
});

test('scoped bibliography changes refresh Metadata for the matching Source only',async t=>{
 let reads=0;t.mock.method(sourceMetadataAPI,'snapshot',async()=>{const value=snapshot();value.fields[1].value=++reads>1?'Imported title':'Published title';return value;});await mount(t);await act(async()=>bibliographyChanged('other-vault','source-one'));await act(async()=>bibliographyChanged('synthetic','other-source'));assert.equal(reads,1);await act(async()=>bibliographyChanged('synthetic','source-one'));assert.equal(reads,2);assert.match(document.querySelector('dl').textContent,/Imported title/);
});

test('DOI controls remain available after acceptance waits for a delayed workspace refresh',async t=>{
 let revision=1,finishRefresh;const record=()=>({sourceId:'delayed-source',citationKey:'stable',entryType:'book',fields:{title:'Published title',doi:'10.1234/synthetic'},revision,provenance:{},rawImports:[]});
 t.mock.method(sourceMetadataAPI,'snapshot',async()=>{const value=snapshot('delayed-source');value.fields[1].fingerprint=String(revision);return value;});t.mock.method(bibliographyAPI,'record',async()=>record());
 t.mock.method(bibliographyAPI,'verify',async()=>({proposalId:'proposal',provider:'Crossref',revision,fields:{title:'Updated title'}}));t.mock.method(bibliographyAPI,'reconcilePreview',async()=>({conflicts:[]}));t.mock.method(bibliographyAPI,'accept',async()=>{revision++;return record();});
 await mount(t,{sourceId:'delayed-source',onUpdated:()=>new Promise(resolve=>{finishRefresh=resolve;})});await publicationControls();await check(document.querySelector('.bibliography-consent input'),true);await click('Look up DOI');await check(document.querySelector('[aria-label="Accept DOI title"]'),true);await click('Accept selected facts');
 assert.ok(document.querySelector('[aria-label="Publication entry type"]'),'saved publication remains visible during workspace refresh');assert.equal(button('Cancel request'),undefined);await act(async()=>finishRefresh());assert.ok(button('Look up DOI'));assert.equal(button('Look up DOI').disabled,false);assert.doesNotMatch(document.querySelector('details').textContent,/Add publication facts below/);
});

test('one explicit bulk review accepts evidence-backed empty fields with fresh fingerprints and leaves conflicts alone',async t=>{
 let state=snapshot('quick-review-source'),reads=0;state.fields[2].proposals[0].compatible=false;state.fields[2].proposals[0].evidence=[{...evidence,validated:false}];
 const date={...state.fields[2].proposals[0],id:'decision-date',fieldKey:'bibliography:date',value:'2026-10-23',fingerprint:'date-before',evidence:[{...evidence,excerpt:'Done on 23 October 2026',validated:false}]};
 state.fields.push({key:'bibliography:date',label:'Document date',owner:'bibliography',value:null,editable:true,fingerprint:'date-field',proposals:[date],history:[]});
 state.fields[1].proposals=[{...date,id:'conflicting-title',fieldKey:'bibliography:title',value:'AI proposed title',fingerprint:'conflict'}];
 const calls=[];let finishFirst;
 t.mock.method(sourceMetadataAPI,'snapshot',async()=>{reads++;return structuredClone(state);});
 t.mock.method(sourceMetadataAPI,'review',async(_vault,_id,body)=>{calls.push(body);if(calls.length===1)await new Promise(resolve=>{finishFirst=resolve;});const field=state.fields.find(field=>field.proposals.some(item=>item.id===body.proposalId));field.value=field.proposals[0].value;field.proposals=[];state.fields.find(field=>field.key==='bibliography:date').proposals.forEach(item=>item.fingerprint='date-after-publisher');return structuredClone(state);});
 await mount(t,{sourceId:'quick-review-source'});assert.match(document.querySelector('[aria-label="Suggestions to accept together"]').textContent,/Publisher: Synthetic Press.*Document date: 2026-10-23/);assert.equal(calls.length,0);await click('Accept non-conflicting suggestions (2)');assert.equal(button('Accept non-conflicting suggestions (2)').disabled,true);
 await act(async()=>button('Accept non-conflicting suggestions (2)').click());assert.equal(calls.length,1);
 await act(async()=>finishFirst());assert.deepEqual(calls,[{proposalId:'suggestion',fingerprint:'fresh-proposal',action:'accept'},{proposalId:'decision-date',fingerprint:'date-after-publisher',action:'accept'}]);
 assert.match(document.querySelector('[role=status]').textContent,/2 suggestions accepted/);assert.match(document.body.textContent,/AI proposed title/);assert.equal(state.fields[1].value,'Published title');assert.equal(reads,1);
});

test('quick metadata review excludes stale, competing and preserved authored values',async t=>{
 t.mock.method(sourceMetadataAPI,'snapshot',async()=>{const value=snapshot('protected-review-source');value.fields[2].proposals[0].compatible=false;value.fields[2].preservedValues=[{id:'authored',name:'publisher',value:'Authored Press',target_id:null}];const candidate={...value.fields[2].proposals[0],id:'stale',stale:true,fieldKey:'bibliography:date'};value.fields.push({key:'bibliography:date',label:'Date',value:null,editable:true,fingerprint:'date-field',proposals:[candidate],history:[]},{key:'bibliography:edition',label:'Edition',value:null,editable:true,fingerprint:'edition-field',proposals:[{...candidate,id:'edition-a',stale:false,value:'First edition'},{...candidate,id:'edition-b',stale:false,value:'Second edition'}],history:[]});return value;});
 let writes=0;t.mock.method(sourceMetadataAPI,'review',async()=>{writes++;throw Error('No review expected');});await mount(t,{sourceId:'protected-review-source'});assert.equal([...document.querySelectorAll('button')].some(item=>item.textContent.startsWith('Accept non-conflicting suggestions')),false);assert.equal(writes,0);
});

test('publication abstracts retain line breaks through canonical edits and corrected suggestions',async t=>{
 const original='First paragraph.\nSecond paragraph.',edited=original+'\nThird paragraph.',suggested='Suggested paragraph.\nAnother paragraph.',corrected='Corrected paragraph.\nSecond corrected paragraph.';
 const value=snapshot('multiline-abstract-source');value.fields[2].proposals=[];
 const proposal={...snapshot().fields[2].proposals[0],id:'abstract-suggestion',fieldKey:'bibliography:abstract',value:suggested,fingerprint:'abstract-proposal-fingerprint',compatible:false};
 value.fields.push({key:'bibliography:abstract',label:'Author abstract',owner:'bibliography',value:original,editable:true,fingerprint:'abstract-field-fingerprint',proposals:[proposal],history:[]});
 t.mock.method(sourceMetadataAPI,'snapshot',async()=>structuredClone(value));let saved,reviewed;
 t.mock.method(sourceMetadataAPI,'save',async(_vault,_id,body)=>{saved=body;value.fields.at(-1).value=body.value;return structuredClone(value);});
 t.mock.method(sourceMetadataAPI,'review',async(_vault,_id,body)=>{reviewed=body;value.fields.at(-1).value=body.value;value.fields.at(-1).proposals=[];return structuredClone(value);});
 await mount(t,{sourceId:'multiline-abstract-source'});await click('Edit Author abstract');
 const manual=document.querySelector('form.source-metadata-edit textarea');assert.equal(manual.rows,4);assert.equal(manual.value,original);manual.value=edited;await act(async()=>reactProps(manual).onChange({target:manual}));
 await act(async()=>reactProps(manual.closest('form')).onSubmit({preventDefault(){}}));assert.deepEqual(saved,{fieldKey:'bibliography:abstract',value:edited,fingerprint:'abstract-field-fingerprint'});assert.equal(document.querySelector('form.source-metadata-edit'),null);
 await click('Edit and accept');const correction=document.querySelector('.source-metadata-suggestion textarea');assert.equal(correction.rows,4);assert.equal(correction.value,suggested);correction.value=corrected;await act(async()=>reactProps(correction).onChange({target:correction}));await click('Save correction and accept');
 assert.deepEqual(reviewed,{proposalId:'abstract-suggestion',fingerprint:'abstract-proposal-fingerprint',action:'accept',value:corrected,replace:true});assert.match(document.querySelector('dl').textContent,/Corrected paragraph.\nSecond corrected paragraph./);
});
