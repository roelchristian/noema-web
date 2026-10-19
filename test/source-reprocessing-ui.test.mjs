import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
const css=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);}});
const {SourceReprocessing}=await import('../src/client/sources/SourceReprocessing.tsx');
css.deregister();
const fixture=()=>{
 const r=JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8'));
 r.acceptanceMode='review_all';r.patches=r.patches.slice(0,2).map((p,i)=>({...p,id:'patch-'+i,decision:'pending',riskReasons:['Quotation wording requires comparison with the PDF.']}));
 r.reprocessed=structuredClone(r.original);r.reprocessed.document.semantic.children=[];r.reprocessed.text='Sample reading text';return r;
};
async function mount(t,{initial=null,post}={}){
 const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
 // React loaded before DOM availability uses its legacy input-event fallback in JSDOM.
 dom.window.HTMLElement.prototype.attachEvent=function(){};dom.window.HTMLElement.prototype.detachEvent=function(){};
 const keys=['window','document','Node','Element','HTMLElement','Event','IS_REACT_ACT_ENVIRONMENT'],previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]});
 let revision=initial;const requests=[];
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  const entry={url:String(url),method:options.method??'GET',body:options.body?JSON.parse(options.body):undefined};requests.push(entry);
  let result;
  if(entry.method==='POST'){result=await post(entry,revision);if(result)revision=result;}
  else if(entry.url.endsWith('/reprocessing'))result=revision?[{...revision,patchCount:revision.patches.length,pendingCount:revision.patches.length}]:[];
  else if(entry.url.endsWith('/status'))result={id:revision.id,status:revision.status,updatedAt:revision.updatedAt,...revision.report};
  else result=revision;
  return {ok:true,json:async()=>structuredClone(result)};
 });
 const root=createRoot(document.querySelector('#mount'));
 await act(async()=>root.render(React.createElement(SourceReprocessing,{vaultId:'v',fileId:'f',visible:true,onShow(){},onOriginal(){}})));
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});});
 const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
 const click=async el=>{assert.ok(el,'Expected control exists');await act(async()=>el.click());};
 return {button,click,requests,dom};
}
test('review policy defaults to review_all and starting disables repeated submissions',async t=>{
 let finish;const env=await mount(t,{post:()=>new Promise(resolve=>{finish=resolve;})});
 await env.click(env.button('Reprocess with AI'));assert.equal(document.querySelector('[aria-label="Review policy"]').value,'review_all');
 await env.click(env.button('Start reprocessing'));assert.equal(env.requests.filter(r=>r.method==='POST').length,1);
 assert.equal(env.requests.find(r=>r.method==='POST').body.acceptanceMode,'review_all');
 const starting=env.button('Starting…');assert.equal(starting.disabled,true);await env.click(starting);assert.equal(env.requests.filter(r=>r.method==='POST').length,1);
 const r=fixture();r.status='queued';await act(async()=>finish(r));assert.ok(document.querySelector('[aria-label="Reprocessing progress"]'));
});
test('risky changes show evidence warnings and batch review submits only selected patches',async t=>{
 let finish;const r=fixture(),env=await mount(t,{initial:r,post:entry=>new Promise(resolve=>{finish=()=>resolve({...r,updatedAt:'2026-10-20T00:00:00Z',patches:r.patches.map(p=>entry.body.decisions.some(d=>d.patchId===p.id)?{...p,decision:'accepted'}:p)});})});
 await env.click(env.button('Review changes (2)'));assert.match(document.body.textContent,/Quotation wording requires comparison/);
 await env.click(document.querySelector('.reprocessing-select input'));
 await env.click(env.button('Accept selected (1)'));
 const request=env.requests.find(item=>item.method==='POST');assert.ok(request.url.endsWith('/review'));assert.deepEqual(request.body.decisions,[{patchId:'patch-0',decision:'accepted'}]);assert.equal(request.body.updatedAt,r.updatedAt);
 assert.equal(env.button('Accept selected (1)').disabled,true);assert.ok([...document.querySelectorAll('.reprocessing-patch button')].filter(b=>b.textContent==='Accept').every(b=>b.disabled));
 await act(async()=>finish());assert.ok(env.button('Accept selected (0)'));assert.equal(document.querySelectorAll('.reprocessing-patch').length,1);
});
test('interrupted revisions resume retained progress and running revisions can stop',async t=>{
 const r=fixture();r.status='interrupted';r.report.chunksCompleted=3;r.report.chunksTotal=5;
 const env=await mount(t,{initial:r,post:async(entry,current)=>({...current,status:entry.url.endsWith('/resume')?'running':'interrupted'})});
 assert.equal(document.querySelector('[aria-label="Reprocessing progress"]'),null);
 await env.click(env.button('Resume remaining excerpts'));assert.equal(env.requests.filter(r=>r.method==='POST').length,1);
 assert.equal(document.querySelector('[aria-label="Reprocessing progress"]').value,3);
 await env.click(env.button('Review changes (2)'));assert.ok([...document.querySelectorAll('.reprocessing-select input')].every(el=>el.disabled));
 await env.click(env.button('Stop and keep progress'));assert.ok(env.requests.find(r=>r.url.endsWith('/cancel')));assert.ok(env.button('Resume remaining excerpts'));assert.equal(document.querySelector('[aria-label="Reprocessing progress"]'),null);
});
test('individual decisions remove hidden patches from batch selection',async t=>{
 const r=fixture(),env=await mount(t,{initial:r,post:async(entry,current)=>({...current,updatedAt:'2026-10-20T00:00:00Z',patches:current.patches.map(p=>{const decision=entry.body.decisions.find(d=>d.patchId===p.id);return decision?{...p,decision:decision.decision}:p;})})});
 await env.click(env.button('Review changes (2)'));await env.click(document.querySelector('.reprocessing-select input'));
 await env.click(env.button('Keep original'));assert.equal(document.querySelectorAll('.reprocessing-patch').length,1);
 assert.ok(env.button('Accept selected (0)'),'Hidden reviewed patch must not remain batch selected');
});
test('same-tick form submissions cannot enqueue duplicate processing requests',async t=>{
 const completions=[],env=await mount(t,{post:()=>new Promise(resolve=>completions.push(resolve))});
 await env.click(env.button('Reprocess with AI'));
 await act(async()=>{const form=document.querySelector('.reprocessing-prompt');form.dispatchEvent(new env.dom.window.Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new env.dom.window.Event('submit',{bubbles:true,cancelable:true}));});
 const count=env.requests.filter(r=>r.method==='POST').length;
 await act(async()=>{for(const finish of completions)finish(fixture());});
 assert.equal(count,1,'Only one mutation may be in flight per review panel');
});
test('unchanged running progress polls lightweight status without downloading another document',async t=>{
 const scheduled=[],realTimeout=globalThis.setTimeout;
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{if(delay===2500){scheduled.push(callback);return 987654;}return realTimeout(callback,delay,...args);});
 const r=fixture();r.status='running';r.report.chunksCompleted=2;
 const env=await mount(t,{initial:r});
 const details=()=>env.requests.filter(item=>item.method==='GET'&&item.url.endsWith('/'+r.id)).length;
 assert.equal(details(),1);
 await act(async()=>{for(const callback of [...scheduled])await callback();});
 assert.ok(env.requests.some(item=>item.url.endsWith('/status')));assert.equal(details(),1);
});
