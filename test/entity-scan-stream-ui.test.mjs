import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM} from './helpers/dom.mjs';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {ConnectedEntities} from '../src/client/intelligence/ConnectedEntities.tsx';
import {EntityScanReview} from '../src/client/intelligence/EntityScanReview.tsx';
import {api} from '../src/client/api.ts';

test('batch prompt lets users review first, then continue using the persisted checkpoint and existing rows',async t=>{
  const env=setupDOM(t),{dom}=env;
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
  const page={id:'page',vault_id:'default',revision:1,title:'Batch test',blocks:[],sourceIds:[]};
  let scan={id:'saved',revision:1,batchCount:25,continuation:{token:'checkpoint',cursor:{blockId:'b',start:100,end:105},excluded:[]},suggestions:Array.from({length:25},(_,i)=>({id:`s${i}`,name:`Person ${i}`,type:'person',subtypes:[],evidence:`Person ${i}`,reason:'Named',status:'pending',existingId:null}))};
  let finish,received;
  t.mock.method(api,'scanEntities',async(...args)=>{received=args;return new Promise(resolve=>finish=resolve);});
  const render=()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:[],disabled:false,onFlush:async()=>page,onReview:async(_scanId,ids,decision)=>({...scan,suggestions:scan.suggestions.map(item=>(Array.isArray(ids)?ids:[ids]).includes(item.id)?{...item,status:decision}:item)}),onScan:result=>{scan=result;render();}}));
  const button=text=>[...document.querySelectorAll('button')].find(item=>item.textContent===text);
  const click=async element=>act(async()=>element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
  try {
    await act(async()=>render());await click(document.querySelector('.entity-detect-action'));
    assert.match(document.querySelector('.entity-scan-batch-prompt').textContent,/25 suggestions saved/);
    await click(button('Review these suggestions first'));
    assert.equal(received,undefined,'Review first makes no AI request');
    assert.equal(document.querySelectorAll('.entity-review-table tbody tr').length,25);
    await click(document.querySelector('[aria-label="Reject Person 0"]'));
    assert.equal(scan.suggestions[0].status,'rejected');
    await click(button('Continue scanning'));
    assert.deepEqual(received[5],{scanId:'saved',token:'checkpoint'});
    assert.equal(document.querySelectorAll('.entity-review-table tbody tr').length,25,'Existing results remain visible during continuation');
    await act(async()=>finish({...scan,continuation:undefined,batchCount:1,suggestions:[...scan.suggestions,{...scan.suggestions[1],id:'new',name:'New Person'}]}));
    assert.equal(document.querySelector('.entity-scan-batch-prompt'),null);
    assert.equal(document.querySelectorAll('.entity-review-table tbody tr').length,26);
    assert.equal(scan.suggestions[0].status,'rejected');
  }finally{await env.close();}
});

test('review renders incoming rows during scanning and enables review only after final persistence, then confirms completion outside the heading',async t=>{
  const env=setupDOM(t),{dom}=env;
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  dom.window.HTMLElement.prototype.attachEvent=function(){};
  dom.window.HTMLElement.prototype.detachEvent=function(){};
  const root=createRoot(document.querySelector('#mount'));
  env.defer(()=>act(async()=>root.unmount()));
  let progress,finish,confirmed;
  t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
  const originalScan=api.scanEntities;env.defer(()=>{api.scanEntities=originalScan;});
  api.scanEntities=async(_vault,_id,_revision,onProgress)=>{progress=onProgress;return new Promise(resolve=>finish=resolve);};
  const page={id:'page',vault_id:'default',revision:1,title:'Test',blocks:[],sourceIds:[]};
  const suggestion={id:'city',name:'Charlemagne, Quebec',aliases:['Charlemagne'],type:'place',subtypes:[],evidence:'Charlemagne',reason:'City',status:'pending',existingId:null};
  let scan=null;
  const render=()=>root.render(React.createElement(ConnectedEntities,{page,entities:[],onOpenEntity(){}},React.createElement(EntityScanReview,{page,scan,entities:[],disabled:false,onFlush:async()=>page,onReview:async(_scanId,ids,decision)=>({...scan,suggestions:scan.suggestions.map(item=>(Array.isArray(ids)?ids:[ids]).includes(item.id)?{...item,status:decision}:item)}),onScan:result=>{confirmed=result;scan=result;render();}})));
  const click=async selector=>act(async()=>document.querySelector(selector).dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
  try {
    await act(async()=>render());await click('.entity-detect-action');
    assert.ok(progress);
    assert.match(document.querySelector('.entity-review-empty-state').textContent,/Finding entities in your document/);
    assert.equal(document.querySelector('.entity-scan-candidates,.entity-scan-snapshot,.entity-scan-navigator'),null);
    await act(async()=>progress({id:'preview1',revision:1,suggestions:[suggestion]}));
    assert.equal(document.querySelectorAll('.entity-review-table tbody tr').length,1);
    assert.match(document.querySelector('.entity-scan-live-status').textContent,/1 entities found/);
    assert.match(document.querySelector('.entity-review-table').textContent,/Aliases: Charlemagne/);
    assert.equal(document.querySelector('[aria-label="Create and link: Charlemagne, Quebec"]').disabled,true);
    assert.equal(confirmed,undefined);
    const final={id:'saved',revision:1,suggestions:[suggestion,{...suggestion,id:'region',name:'Quebec',aliases:[],evidence:'Quebec'}]};
    await act(async()=>progress({...final,id:'preview2'}));
    assert.equal(document.querySelectorAll('.entity-review-table tbody tr').length,2);
    await act(async()=>finish(final));
    assert.equal(confirmed.id,'saved');
    assert.equal(document.querySelector('.entity-scan-live-status'),null);
    assert.equal(document.querySelector('[aria-label="Create and link: Charlemagne, Quebec"]').disabled,false);
    await click('[aria-label="Edit Charlemagne, Quebec"]');
    assert.equal(document.querySelector('.entity-review-editor [aria-label="Current aliases"] li span').textContent,'Charlemagne');
    assert.ok(document.querySelector('.entity-review-editor [aria-label="Remove alias Charlemagne"]'));
    assert.equal(document.querySelector('.entity-review-editor input[placeholder="Add an alias…"]').value,'');
    t.mock.timers.enable({apis:['setTimeout']});
    await click('[aria-label="Create and link: Charlemagne, Quebec"]');
    assert.match(document.querySelector('.entity-review-confirmation').textContent,/Charlemagne, Quebec connected/);
    await click('[aria-label="Reject Quebec"]');
    assert.match(document.querySelector('.entity-review-confirmation').textContent,/Review complete/);
    await act(async()=>t.mock.timers.tick(1100));
    assert.ok(document.querySelector('dialog.entity-review-modal'));
    assert.match(document.querySelector('.entity-review-confirmation').textContent,/Review complete/);
    await act(async()=>t.mock.timers.tick(5000));
    assert.ok(document.querySelector('.entity-review-confirmation'));
  }finally{await env.close();}
});

test('context mode keeps occurrence and subtype drafts across views and navigates exact table evidence',async t=>{
 const env=setupDOM(t),{dom}=env;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
 const page={id:'page',vault_id:'default',revision:2,title:'Context test',sourceIds:[],blocks:[{id:'p',type:'paragraph',content:[{text:'Mira met Mira.'}]},{id:'t',type:'table',content:[],rows:[[[{text:'Sora met Sora.'}]]]}]};
 const scan={id:'saved',revision:2,subtypeSuggestions:[{id:'subtype',name:'Researcher',type:'person',status:'pending'}],suggestions:[{id:'first',name:'Mira',type:'person',subtypes:[],existingId:null,evidence:'Mira',evidenceAnchor:{blockId:'p',start:0,end:4},reason:'Named',status:'pending',proposedSubtypeIds:['subtype']},{id:'second',name:'Sora',type:'person',subtypes:[],existingId:null,evidence:'Sora',evidenceAnchor:{blockId:'t',row:0,col:0,start:9,end:13},reason:'Named',status:'pending'}]};
 const click=async element=>act(async()=>element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));
 const button=text=>[...document.querySelectorAll('button')].find(element=>element.textContent===text);
 try {
  await act(async()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:[],disabled:false,onScan(){},onFlush:async()=>page,onReview:async()=>scan})));
  await click(document.querySelector('.entity-detect-action'));await click(button('Contextual review'));
  assert.equal(document.querySelector('.entity-review-editor'),null,'Suggestion editing starts collapsed');
  assert.equal(document.querySelector('.entity-review-footer'),null,'Context review needs no separate close footer');
  assert.equal(document.querySelector('input[aria-label="Select Mira"]'),null);
  await click(document.querySelector('[aria-label="Edit Mira"]'));
  await click(document.querySelector('.entity-review-editor fieldset input'));
  assert.equal(document.querySelector('.entity-review-occurrence-options').open,false);
  await click(document.querySelector('.entity-review-occurrence-options > summary'));
  await click(document.querySelectorAll('.scan-occurrence input')[1]);
  await click(button('Batch review'));await click(button('Contextual review'));
  assert.equal(document.querySelector('.entity-review-editor fieldset input').checked,true);
  assert.equal(document.querySelectorAll('.scan-occurrence input')[1].checked,true);
  await click(document.querySelector('[aria-label="Next entity"]'));
  assert.equal(document.querySelector('.entity-scan-snapshot mark').textContent,'Sora');
  assert.equal(document.querySelector('.scan-evidence'),null,'Context evidence stays in the document pane');
  assert.equal(document.querySelector('.entity-scan-snapshot table td mark').textContent,'Sora');
  const queue=document.querySelector('.entity-scan-queue');
  await act(async()=>queue.querySelector('[aria-current=true]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})));
  assert.equal(document.querySelector('.entity-scan-snapshot mark').textContent,'Mira');
  await click(document.querySelector('[aria-label="Edit Mira"]'));
  assert.equal(document.querySelectorAll('.scan-occurrence input')[1].checked,true);
 }finally{await env.close();}
});

test('compact batch selection follows visible pending rows and submits edited links across views', async t => {
 const env=setupDOM(t),{dom}=env;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
 const page={id:'page',vault_id:'default',revision:1,title:'Selection test',blocks:[{id:'p',type:'paragraph',content:[{text:'Mira met Sora.'}]}],sourceIds:[]};
 const suggestions=['Mira','Sora','Reviewed'].map((name,i)=>({id:name,name,type:'person',subtypes:[],evidence:name,reason:'Named',existingId:null,status:i===2?'accepted':'pending'}));
 let scan={id:'saved',revision:1,suggestions},received;
 const render=()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:[{id:'mira-existing',name:'Mira',type:'person',subtypes:[],aliases:[]}],disabled:false,onFlush:async()=>page,onReview:async(scanId,ids,decision,edits)=>{received={scanId,ids,decision,edits};return {...scan,suggestions:scan.suggestions.map(s=>ids.includes(s.id)?{...s,status:decision}:s)};},onScan:result=>{scan=result;render();}}));
 const click=async element=>act(async()=>element.click());
 const button=text=>[...document.querySelectorAll('button')].find(element=>element.textContent===text);
 const checkbox=name=>document.querySelector(`input[aria-label="${name}"]`);
 try {
  await act(async()=>render());await click(document.querySelector('.entity-detect-action'));
  await click(button('Contextual review'));await click(button('Batch review'));
  await click(checkbox('Select Mira'));
  assert.equal(checkbox('Select all visible pending suggestions').indeterminate,true);
  await click(checkbox('Select all visible pending suggestions'));
  assert.equal(checkbox('Select Sora').checked,true);
  assert.equal(checkbox('Select Reviewed').checked,false);
  await click(checkbox('Select Sora'));
  if (!document.querySelector('.entity-review-editor')) await click(document.querySelector('[aria-label="Edit Mira"]'));
  // Choosing a new identity stores an explicit draft even when names match a saved entity.
  await click(button('Create a new identity'));
  await click(button('Contextual review'));await click(button('Batch review'));
  assert.equal(checkbox('Select Mira').checked,true);
  await click([...document.querySelectorAll('button')].find(element=>element.textContent==='Accept selected (1)'));
  assert.deepEqual(received.ids,['Mira']);
  assert.equal(received.decision,'accepted');
  assert.equal(received.edits[0].existingId,null);
  assert.equal(checkbox('Select Mira').disabled,true);
  assert.equal(checkbox('Select all visible pending suggestions').checked,false);
  assert.match(document.querySelector('.entity-review-confirmation').textContent,/Mira connected/);
 } finally {await env.close();}
});

test('context decisions advance only after persistence and leave failed suggestions active',async t=>{
 const env=setupDOM(t),{dom}=env;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const scrolled=[],queueScrolled=[];
 dom.window.HTMLElement.prototype.scrollIntoView=function(options){
  if(this.matches('.entity-scan-candidate'))queueScrolled.push({name:this.getAttribute('aria-label'),options});
  else scrolled.push(this.textContent);
 };
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
 const page={id:'p',vault_id:'default',revision:1,title:'Review',sourceIds:[],blocks:[{id:'b',type:'paragraph',content:[{text:'Mira met Sora.'}]}]};
 let scan={id:'scan',revision:1,suggestions:[{id:'m',name:'Mira',evidence:'Mira',evidenceAnchor:{blockId:'b',start:0,end:4}},{id:'s',name:'Sora',evidence:'Sora',evidenceAnchor:{blockId:'b',start:9,end:13}}].map(s=>({...s,type:'person',subtypes:[],existingId:null,status:'pending',reason:'Named'}))};
 let finish,fail=false;
 const render=()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:[],disabled:false,onFlush:async()=>page,onScan:result=>{scan=result;render();},onReview:async(_id,ids,decision)=>{if(fail)throw new Error('Save failed');return new Promise(resolve=>finish=()=>resolve({...scan,suggestions:scan.suggestions.map(s=>ids.includes(s.id)?{...s,status:decision}:s)}));}}));
 const click=async selector=>act(async()=>document.querySelector(selector).click());
 try{
  await act(async()=>render());await click('.entity-detect-action');
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Contextual review').click());
  assert.equal(scrolled.at(-1),'Mira');
  assert.deepEqual(queueScrolled.at(-1),{name:'Mira · pending',options:{block:'nearest',inline:'nearest'}});
  await click('.scan-row-accept');
  assert.equal(document.querySelector('[aria-current=true]').textContent.includes('Mira'),true);
  await act(async()=>finish());
  assert.equal(document.querySelector('[aria-current=true]').textContent.includes('Sora'),true);
  assert.equal(scrolled.at(-1),'Sora');
  assert.equal(queueScrolled.at(-1).name,'Sora · pending');
  await click('[aria-label="Previous entity"]');
  assert.equal(queueScrolled.at(-1).name,'Mira · accepted');
  await click('[aria-label="Next entity"]');
  assert.equal(queueScrolled.at(-1).name,'Sora · pending');
  fail=true;await click('.scan-row-reject');
  assert.match(document.querySelector('[role=alert]').textContent,/Save failed/);
  assert.equal(document.querySelector('[aria-current=true]').textContent.includes('Sora'),true);
  assert.equal(scan.suggestions[1].status,'pending');
 }finally{await env.close();}
});

test('decision pane shows matching identities and acceptance outcome without repeating evidence or expanding editing',async t=>{
 const env=setupDOM(t),{dom}=env;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const page={id:'p',vault_id:'default',revision:1,title:'Review',sourceIds:[],blocks:[{id:'b',type:'paragraph',content:[{text:'The death penalty is debated.'}]}]};
 const scan={id:'scan',revision:1,suggestions:[{id:'s',name:'death penalty',aliases:['capital punishment'],evidence:'death penalty',evidenceAnchor:{blockId:'b',start:4,end:17},type:'concept',subtypes:[],existingId:null,status:'pending',reason:'Named'}]};
 const entity={id:'capital',name:'Capital punishment',aliases:['death penalty'],type:'concept',subtypes:[],domainIds:[]};
 const click=async element=>act(async()=>element.click());
 try{
  await act(async()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:[entity],disabled:false,onFlush:async()=>page,onScan(){},onReview:async()=>scan})));
  await click(document.querySelector('.entity-detect-action'));
  await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Contextual review'));
  const pane=document.querySelector('.entity-review-table-wrap');
  assert.equal(pane.querySelector('.scan-evidence'),null);
  assert.equal(pane.querySelector('.entity-review-editor'),null);
  assert.match(pane.querySelector('.entity-decision-outcome').textContent,/Accepting creates death penalty/);
  assert.ok(pane.querySelector('[role=option]').textContent.includes('Capital punishment'));
  assert.equal(pane.textContent.includes('Aliases:'),false);
  await click(pane.querySelector('[role=option]'));
  assert.match(pane.querySelector('.entity-decision-outcome').textContent,/Accepting links to Capital punishment/);
  await click(pane.querySelector('.entity-decision-create'));
  assert.match(pane.querySelector('.entity-decision-outcome').textContent,/Accepting creates death penalty/);
  await click(pane.querySelector('.scan-row-edit'));
  assert.equal(pane.querySelector('.entity-review-alias-options').open,false);
  assert.equal(pane.querySelector('.entity-review-occurrence-options').open,false);
 }finally{await env.close();}
});

test('document excerpts retain every current mention and alias and expand skipped sections without changing views',async t=>{
 const env=setupDOM(t),{dom}=env;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const paragraph=(id,text)=>({id,type:'paragraph',content:[{text}]});
 const page={id:'p',vault_id:'default',revision:1,title:'Excerpts',sourceIds:[],blocks:[paragraph('first','Mira visited. Mira returned.'),...Array.from({length:9},(_,i)=>paragraph(`gap-${i}`,`Surrounding passage ${i}.`)),{id:'table',type:'table',content:[],rows:[[[{text:'Dr. Mira'}],[{text:'An observation'}]]]}]};
 const scan={id:'scan',revision:1,suggestions:[{id:'s',name:'Mira',aliases:['Dr. Mira'],evidence:'Mira',evidenceAnchor:{blockId:'first',start:0,end:4},type:'person',subtypes:[],existingId:null,status:'pending',reason:'Named'}]};
 const click=async selector=>act(async()=>document.querySelector(selector).click());
 try{
  await act(async()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:[],disabled:false,onFlush:async()=>page,onScan(){},onReview:async()=>scan})));
  await click('.entity-detect-action');
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Contextual review').click());
  const snapshot=document.querySelector('.entity-scan-snapshot');
  assert.deepEqual([...snapshot.querySelectorAll('mark')].map(m=>m.textContent),['Mira','Mira','Dr. Mira']);
  await click('[aria-label="Matching excerpts"]');
  assert.equal(snapshot.querySelector('[aria-label="Matching excerpts"]').getAttribute('aria-pressed'),'true');
  assert.deepEqual([...snapshot.querySelectorAll('mark')].map(m=>m.textContent),['Mira','Mira','Dr. Mira']);
  assert.equal(snapshot.querySelector('.entity-scan-document-content').textContent.includes('Surrounding passage 4.'),false);
  assert.ok(snapshot.querySelector('.entity-scan-document-content').textContent.includes('Surrounding passage 0.'));
  assert.equal(snapshot.querySelector('.entity-scan-document-content').textContent.includes('Surrounding passage 1.'),false);
  assert.ok(snapshot.querySelector('.entity-scan-document-content').textContent.includes('Surrounding passage 8.'));
  assert.ok(snapshot.querySelector('.entity-scan-skipped'));
  await click('.entity-scan-skipped');
  assert.equal(snapshot.querySelector('[aria-label="Matching excerpts"]').getAttribute('aria-pressed'),'true');
  assert.ok(snapshot.querySelector('.entity-scan-document-content').textContent.includes('Surrounding passage 4.'));
  await click('[aria-label="Full document"]');
  assert.equal(snapshot.querySelector('[aria-label="Full document"]').getAttribute('aria-pressed'),'true');
 }finally{await env.close();}
});

test('excerpt context uses rendered lines within one long block and recomputes on resize',async t=>{
 const env=setupDOM(t),{dom}=env;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
 let columns=80;
 t.mock.method(dom.window.Range.prototype,'getBoundingClientRect',function(){return {top:Math.floor(this.startOffset/columns)*20,height:20};});
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const text='A'.repeat(400)+' Mira '+'B'.repeat(600)+' Dr. Mira '+'C'.repeat(400);
 const page={id:'p',vault_id:'default',revision:1,title:'Long paragraph',sourceIds:[],blocks:[{id:'b',type:'paragraph',content:[{text}]}]};
 const scan={id:'scan',revision:1,suggestions:[{id:'s',name:'Mira',aliases:['Dr. Mira'],evidence:'Mira',evidenceAnchor:{blockId:'b',start:401,end:405},type:'person',subtypes:[],existingId:null,status:'pending',reason:'Named'}]};
 const click=async selector=>act(async()=>document.querySelector(selector).click());
 try{
  await act(async()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:[],disabled:false,onFlush:async()=>page,onScan(){},onReview:async()=>scan})));
  await click('.entity-detect-action');
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Contextual review').click());
  await click('[aria-label="Matching excerpts"]');
  const content=document.querySelector('.entity-scan-document-content');
  const wide=[...content.querySelectorAll('article > p')].map(p=>p.textContent).join('');
  assert.deepEqual([...content.querySelectorAll('mark')].map(m=>m.textContent),['Mira','Dr. Mira']);
  assert.ok(wide.length<text.length,'A single source block is trimmed to its rendered context lines');
  columns=40;
  await act(async()=>window.dispatchEvent(new dom.window.Event('resize')));
  const narrow=[...content.querySelectorAll('article > p')].map(p=>p.textContent).join('');
  assert.ok(narrow.length<wide.length,'One rendered context line uses less text in a narrower pane');
  assert.deepEqual([...content.querySelectorAll('mark')].map(m=>m.textContent),['Mira','Dr. Mira']);
  assert.ok(content.querySelector('.entity-scan-skipped'));
  const skippedCount=content.querySelectorAll('.entity-scan-skipped').length;
  assert.ok(skippedCount>1,'There are separate leading, middle and trailing gaps');
  await click('.entity-scan-document-content .entity-scan-skipped');
  assert.equal(document.querySelector('[aria-label="Matching excerpts"]').getAttribute('aria-pressed'),'true');
  assert.equal(content.querySelectorAll('.entity-scan-skipped').length,skippedCount-1,'Only the clicked gap expands');
  const expanded=[...content.querySelectorAll('article > p')].map(p=>p.textContent).join('');
  assert.ok(expanded.length>narrow.length&&expanded.length<text.length);
  assert.ok(expanded.startsWith('A'.repeat(400)),'The leading skipped section is now visible');
  assert.equal(expanded.includes('B'.repeat(600)),false,'The middle skipped section remains collapsed');
  columns=80;
  await act(async()=>window.dispatchEvent(new dom.window.Event('resize')));
  assert.ok(content.querySelector('article > p').textContent.startsWith('A'.repeat(400)),'Expansion persists through line reflow');
  await click('.entity-scan-document-content .entity-scan-skipped');
  assert.equal(content.querySelectorAll('.entity-scan-expanded-context').length,2);
  await click('.entity-scan-expanded-context .entity-scan-collapse-context');
  assert.equal(document.querySelector('[aria-label="Matching excerpts"]').getAttribute('aria-pressed'),'true');
  assert.equal(content.querySelectorAll('.entity-scan-expanded-context').length,1,'Collapsing one section leaves the other expanded');
  const afterCollapse=[...content.querySelectorAll('article > p')].map(p=>p.textContent).join('');
  assert.equal(afterCollapse.startsWith('A'.repeat(400)),false,'The leading section is collapsed again');
  assert.ok(afterCollapse.includes('B'.repeat(600)),'The middle section remains expanded');
  assert.deepEqual([...content.querySelectorAll('mark')].map(m=>m.textContent),['Mira','Dr. Mira']);
  await click('.entity-scan-expanded-context .entity-scan-collapse-context');
  assert.equal(content.querySelectorAll('.entity-scan-expanded-context').length,0);
  assert.equal([...content.querySelectorAll('article > p')].map(p=>p.textContent).join(''),wide,'Collapsing all sections restores the original excerpts');
 }finally{await env.close();}
});

test('review defaults to excerpts, retains recent choices and resets after a day or a new scan',async t=>{
 const env=setupDOM(t),{dom}=env;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
 let now=100_000_000;t.mock.method(Date,'now',()=>now);
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const page={id:'p',vault_id:'default',revision:1,title:'Review',sourceIds:[],blocks:[{id:'b',type:'heading2',content:[{text:'Mira and ',href:'https://example.com'},{entityId:'other',mentionText:'Sora'}]}]};
 let scan={id:'scan',revision:1,suggestions:[{id:'s',name:'Mira',evidence:'Mira',evidenceAnchor:{blockId:'b',start:0,end:4},type:'person',subtypes:[],existingId:null,status:'pending',reason:'Named'},{id:'other-suggestion',name:'Sora',evidence:'Sora',evidenceAnchor:{blockId:'b',start:9,end:13},type:'person',subtypes:[],existingId:'other',status:'accepted',reason:'Named'}]};
 const render=()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:[],disabled:false,onFlush:async()=>page,onScan(){},onReview:async()=>scan}));
 const click=async selector=>act(async()=>document.querySelector(selector).click());
 const excerpts=()=>document.querySelector('[aria-label="Matching excerpts"]').getAttribute('aria-pressed');
 try{
  await act(async()=>render());await click('.entity-detect-action');
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Contextual review').click());
  assert.equal(excerpts(),'true');
  const content=document.querySelector('.entity-scan-document-content');
  assert.equal(content.querySelector('a,.snapshot-linked,.snapshot-pending,.entity-scan-block-number'),null,'Preview leaves other text and entities unannotated');
  assert.deepEqual([...content.querySelectorAll('mark')].map(m=>m.textContent),['Mira']);
  assert.ok(content.textContent.includes('Sora'),'Other entity wording is retained as plain text');
  assert.equal(document.querySelector('.entity-scan-document-heading h3').textContent,'Document Preview');
  await click('[aria-label="Full document"]');await click('[aria-label="Close dialog"]');
  now+=60*60*1000;await click('.entity-detect-action');
  assert.equal(excerpts(),'false','Recent review restores full view');
  await click('[aria-label="Close dialog"]');now+=25*60*60*1000;await click('.entity-detect-action');
  assert.equal(excerpts(),'true','A day without opening review resets the view');
  await click('[aria-label="Full document"]');
  scan={...scan,id:'new-scan'};await act(async()=>render());
  assert.equal(excerpts(),'true','A new scan resets the view');
 }finally{await env.close();}
});

test('search and filter empty states replace the panes and clearing restores review',async t=>{
 const env=setupDOM(t),{dom}=env;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 t.mock.method(api,'entitySchema',async()=>({properties:{},subtypes:[],subtypeProperties:{}}));
 const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 const page={id:'p',vault_id:'default',revision:1,title:'Review',sourceIds:[],blocks:[{id:'b',type:'paragraph',content:[{text:'Mira visited.'}]}]};
 let scan={id:'scan',revision:1,suggestions:[{id:'s',name:'Mira',evidence:'Mira',evidenceAnchor:{blockId:'b',start:0,end:4},type:'person',subtypes:[],existingId:null,status:'pending',reason:'Named'}]};
 const render=()=>root.render(React.createElement(EntityScanReview,{page,scan,entities:[],disabled:false,onFlush:async()=>page,onScan(){},onReview:async()=>scan}));
 const click=async element=>act(async()=>element.click());
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 try{
  await act(async()=>render());await click(document.querySelector('.entity-detect-action'));await click(button('Contextual review'));
  const dialog=document.querySelector('dialog');
  assert.ok(dialog.querySelector('.entity-scan-snapshot'));
  const input=dialog.querySelector('[aria-label="Search suggestions"]');
  await act(async()=>{
   input.focus();Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'no such person');
   input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
   input.dispatchEvent(new dom.window.KeyboardEvent('keyup',{key:'n',bubbles:true}));
  });
  assert.match(dialog.querySelector('.entity-review-empty-state').textContent,/No matching suggestions/);
  assert.equal(dialog.querySelector('.entity-scan-candidates,.entity-scan-snapshot,.entity-scan-navigator'),null);
  assert.ok(dialog.querySelector('.entity-review-workspace.is-empty'));
  await click(button('Clear search and filters'));
  assert.equal(input.value,'');
  assert.ok(dialog.querySelector('.entity-scan-snapshot'));
  assert.equal(dialog.querySelector('.entity-review-empty-state'),null);
  await click([...dialog.querySelectorAll('.entity-review-filters button')].find(b=>b.textContent.startsWith('Reviewed')));
  assert.ok(dialog.querySelector('.entity-review-empty-state'));
  await click(button('Clear search and filters'));
  await click(button('Batch review'));
  scan={...scan,suggestions:[],subtypeSuggestions:[{id:'sub',name:'Researcher',type:'person',status:'pending'}]};await act(async()=>render());
  assert.ok(dialog.querySelector('.entity-review-subtype-proposals'));
  assert.equal(dialog.querySelector('.entity-review-empty-state'),null,'Subtype-only batches remain reviewable');
  scan={...scan,subtypeSuggestions:[]};await act(async()=>render());
  assert.match(dialog.querySelector('.entity-review-empty-state').textContent,/No entities found/);
  assert.equal(dialog.querySelector('.entity-review-footer'),null);
  assert.equal(document.querySelector('dialog'),dialog,'The modal is preserved through all result states');
 }finally{await env.close();}
});
