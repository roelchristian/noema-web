import {test} from 'node:test';
import assert from 'node:assert/strict';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
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
