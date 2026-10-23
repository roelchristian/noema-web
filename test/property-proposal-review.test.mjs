import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {PropertyProposalReview} from '../src/client/knowledge/PropertyProposalReview.tsx';
import {api} from '../src/client/api.ts';
async function fixture(work){
 const dom=new JSDOM('<div id="mount"></div>',{url:'http://localhost'}),keys=['window','document','Node','Element','HTMLElement','HTMLSelectElement','Event','MutationObserver','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 const originalList=api.propertyProposals,originalReview=api.reviewPropertyProposal;const proposal={id:'proposal-'+Math.random(),entity_id:'e',vault_id:'v',kind:'property',property_name:'website',value:'https://proposed.example',target_id:null,origin:'ai',status:'pending',fingerprint:'fresh',conflicts:[],currentName:'Current',stale:false,staleReason:null,source_file_id:null,source_hash:null,details:'Extraction receipt'};
 api.propertyProposals=async()=>[proposal];let writes=0;api.reviewPropertyProposal=async()=>{writes++;return {...proposal,status:'accepted'};};
 const root=createRoot(document.querySelector('#mount'));let refresh=async()=>{};const render=(extra={})=>act(async()=>root.render(React.createElement(PropertyProposalReview,{...extra,vaultId:'v',entityId:'e',entities:[],onUpdated:()=>refresh()})));
 const click=async text=>{const button=[...document.querySelectorAll('button')].find(value=>value.textContent===text);assert.ok(button,text);await act(async()=>button.click());};
 try{await render();await work({proposal,click,render,setRefresh:value=>refresh=value,writes:()=>writes});}finally{await act(async()=>root.unmount());api.propertyProposals=originalList;api.reviewPropertyProposal=originalReview;dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});}
}
test('saved review followed by failed refresh never repeats the mutation',()=>fixture(async({click,setRefresh,writes})=>{setRefresh(async()=>{throw Error('offline');});await click('Accept value');assert.equal(writes(),1);assert.match(document.querySelector('[role=alert]').textContent,/Review saved/);await click('Retry refresh');assert.equal(writes(),1);assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent==='Accept value'),false);}));
test('uncertain write requires read-only reconciliation before any second mutation',()=>fixture(async({proposal,click})=>{let writes=0,reads=0;api.reviewPropertyProposal=async()=>{writes++;throw Error('lost response');};await click('Accept value');assert.equal(writes,1);assert.equal([...document.querySelectorAll('button')].find(button=>button.textContent==='Accept value').disabled,true);api.propertyProposals=async(_vault,_entity,status)=>{reads++;assert.equal(status,'all');return [{...proposal,status:'accepted'}];};await click('Check review status');assert.equal(writes,1);assert.equal(reads,1);assert.match(document.querySelector('.property-proposal').textContent,/accepted/);}));
test('stale evidence prevents acceptance while retaining explicit rejection',()=>fixture(async({proposal,render,click,writes})=>{proposal.stale=true;proposal.staleReason='Source changed';await render();assert.equal([...document.querySelectorAll('button')].find(button=>button.textContent==='Accept value').disabled,true);await click('Reject suggestion');assert.equal(writes(),1);}));


test('Inbox destination requests and focuses the exact saved proposal independently of list bounds',()=>fixture(async({proposal,render})=>{
 const reads=[];api.propertyProposals=async(vault,entity,status,signal,proposalId)=>{reads.push({vault,entity,status,signal,proposalId});return [proposal];};
 await render({proposalId:proposal.id});assert.equal(reads.at(-1).proposalId,proposal.id);assert.equal(reads.at(-1).status,'all');assert.equal(reads.at(-1).signal.aborted,false);assert.equal(document.activeElement,document.querySelector('.property-proposal'));assert.match(document.querySelector('.property-proposal-review').textContent,/Selected proposal from Inbox/);
}));
