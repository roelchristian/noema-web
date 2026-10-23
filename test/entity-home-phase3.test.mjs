import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {setupEntityDOM} from './helpers/entity-dom.mjs';
import {EntityHome} from '../src/client/knowledge/EntityHome.tsx';
import {SourceViewer} from '../src/client/sources/SourceViewer.tsx';
import {entityTypes} from '../src/shared/domain.ts';
import {api} from '../src/client/api.ts';

async function fixture(t,work){
 const env=await setupEntityDOM(t),{dom,root,click}=env;
 const entity={id:'e',vault_id:'v',name:'Ada',type:'person',description:'A mathematician.',subtypes:[],domainIds:[],aliases:['A.'],mentionCase:'canonical',properties:[{id:'prop',entity_id:'e',name:'Place',target_id:'other',value:''}],propertyNames:['Born'],relationships:[{id:'out',source_id:'e',target_id:'other',label:'visited'},{id:'in',source_id:'other',target_id:'e',label:'commemorates'}],incomingProperties:[{id:'incoming',entity_id:'other',name:'Honours',target_id:'e'}],pageMentions:[{id:'page',title:'History',icon:'',mentionCount:2,excerpt:'Ada studied mathematics.'}],attachments:[],updated_at:'2026-10-19'};
 const other={...entity,id:'other',name:'London',type:'place'};
 t.mock.method(api,'entity',async()=>entity);
 t.mock.method(api,'entityEvidence',async()=>({groups:[],hasMore:false,truncated:false}));
 t.mock.method(api,'entityOverviewEvidence',async()=>({groups:[],hasMore:false,truncated:false}));
 t.mock.method(api,'entitySchema',async()=>({properties:Object.fromEntries(entityTypes.map(type=>[type,[]])),subtypes:[],subtypeProperties:{}}));
 const props={vaultId:'v',id:'e',entities:[entity,other],refreshKey:'',onOpen(){},onClose(){},onUpdated:async()=>{},onError(error){throw error;},onOpenPage(){},onCreatePageFromSource(){}};
 try{await act(async()=>root.render(React.createElement(EntityHome,props)));await work({entity,click,dom,props,root});}
 finally{await env.close();}
}

test('entity mentions group context once and preserve distinct exact occurrence targets', async t => {
 await fixture(t, async ({entity,props,root,click}) => {
  const first={pageId:'page',entityId:'e',blockId:'block',blockIds:['block'],segmentIndex:1,startOffset:7,endOffset:10,revision:1,projectionHash:'hash'};
  const second={...first,segmentIndex:3,startOffset:18,endOffset:21};
  entity.pageMentions[0].contexts=[{blockId:'block',heading:['History','Early work'],excerpt:'Ada worked with Ada.',occurrences:[{id:'first',label:'Ada',reference:first},{id:'second',label:'Ada',reference:second}]}];
  let openedPage,openedMention;
  await act(async()=>root.render(React.createElement(EntityHome,{...props,onOpenPage:id=>openedPage=id,onOpenMention:reference=>openedMention=reference})));
  await click('#entity-home-tab-mentions');
  assert.equal(document.querySelectorAll('.eh-context-excerpt').length,1);
  assert.match(document.querySelector('.eh-context-heading').textContent,/History › Early work/);
  assert.equal(document.querySelectorAll('.eh-occurrences button').length,2);
  await click('.eh-occurrences button:last-child');
  assert.deepEqual(openedMention,second);
  await click('.eh-mention-page');
  assert.equal(openedPage,'page');
 });
});

test('source evidence loads lazily, retries failures, and appends passages without duplicating sources', async t => {
 await fixture(t, async ({props,root,click}) => {
  let calls=0,opened,openedPage;
  const reference={id:'citation',sourceId:'source',fileId:'file',startLine:2,endLine:4,sourceHash:'hash',excerpt:'Ada describes the method.',userLocator:'Chapter 2, p. 7'};
  const passage={id:'a',reference,reason:'citation',reasons:['citation','source-mention'],pageIds:['page'],stale:true};
  const requests=[];
  t.mock.method(api,'entityEvidence',async(vault,id,signal,offset)=>{
   calls++;requests.push({vault,id,signal,offset});
   if(calls===1)throw new Error('Temporary evidence failure');
   return {groups:[{sourceId:'source',sourceName:'Collected papers',passages:[offset ? {...passage,id:'b',stale:false,reference:{...reference,excerpt:'A second passage.'}} : passage]}],hasMore:!offset,nextOffset:offset?undefined:1,truncated:false};
  });
  await act(async()=>root.render(React.createElement(EntityHome,{...props,pages:[{id:'page',title:'History'}],onOpenPage:id=>openedPage=id,onOpenSourcePassage:(reference,trigger)=>opened={reference,trigger}})));
  assert.equal(calls,0);
  await click('#entity-home-tab-sources');
  assert.match(document.querySelector('#entity-home-panel-sources [role="alert"]').textContent,/Temporary evidence failure/);
  await click('#entity-home-panel-sources [role="alert"] button');
  assert.equal(calls,2);
  assert.match(document.querySelector('.eh-evidence-reason').textContent,/Cited alongside entity · Name appears in source/);
  assert.match(document.querySelector('.eh-evidence-stale').textContent,/source location could not be verified/);
  assert.equal(document.querySelector('.eh-source-actions button').textContent,'Chapter 2, p. 7 ↗');
  await click('.eh-source-actions button');
  assert.deepEqual(opened.reference,reference);
  assert.ok(opened.trigger instanceof HTMLElement);
  await click('.eh-evidence-pages button');assert.equal(openedPage,'page');
  await click('.eh-source-evidence > .eh-text-action');
  assert.equal(requests[2].offset,1);
  assert.equal(document.querySelectorAll('.eh-source-group').length,1);
  assert.equal(document.querySelectorAll('.eh-source-group li').length,2);
  assert.match(document.querySelector('.eh-source-evidence h2').textContent,/2 passages/);
  await click('#entity-home-tab-overview');
  assert.equal(requests[2].signal.aborted,true);
 });
});

test('switching away aborts source discovery and ignores late evidence', async t => {
 await fixture(t, async ({click}) => {
  let resolve,signal;
  t.mock.method(api,'entityEvidence',async(_vault,_id,value)=>{signal=value;return new Promise(done=>resolve=done);});
  await click('#entity-home-tab-sources');
  assert.match(document.querySelector('#entity-home-panel-sources').textContent,/Finding source passages/);
  await click('#entity-home-tab-mentions');
  assert.equal(signal.aborted,true);
  await act(async()=>resolve({groups:[],hasMore:false,truncated:false}));
  assert.equal(document.querySelectorAll('.eh-source-evidence').length,0);
 });
});


test('source viewer preserves stale evidence without trusting a matching file hash',async t=>{
 await fixture(t,async({props,root})=>{
  const reference={id:'historical',sourceId:'source',fileId:'file',startLine:1,endLine:1,sourceHash:'hash',excerpt:'Saved historical passage.',stale:true,startOffset:0,endOffset:25};
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({id:'file',entity_id:'source',name:'Research',status:'ready',admitted:1,textHash:'hash'})}));
  let mode='standard',exits=0;
  const renderViewer=()=>root.render(React.createElement(SourceViewer,{vaultId:'v',reference,entities:props.entities,onClose(){},onOpenEntity(){},presentation:{value:mode,onChange(next){mode=next;renderViewer();},onExitFocus(){exits++;mode='subtle';renderViewer();}}}));
  await act(async()=>renderViewer());
  assert.match(document.querySelector('.source-viewer-status').textContent,/could not be verified/);
  assert.equal(document.querySelector('.source-viewer-passage mark').textContent,'Saved historical passage.');
  assert.equal(document.querySelector('[data-cited-node]'),null);
  const savedPassage=document.querySelector('.source-viewer-passage');
  await act(async()=>document.querySelector('#source-viewer [aria-label="Subtle references"]').click());assert.equal(mode,'subtle');
  await act(async()=>document.querySelector('#source-viewer [aria-label="Focus mode"]').click());assert.equal(mode,'focus');
  await act(async()=>document.querySelector('#source-viewer [aria-label="Focus mode"]').click());assert.equal(mode,'subtle');assert.equal(exits,1);
  assert.equal(document.querySelector('.source-viewer-passage'),savedPassage);
 });
});
