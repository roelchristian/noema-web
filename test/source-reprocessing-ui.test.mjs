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
  else if(entry.url.endsWith('/intelligence'))result={model:'gpt-5-mini',reasoningEffort:'low'};
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
 assert.equal(document.querySelector('[aria-label="Reprocessing progress"]').value,3);
 await env.click(env.button('Resume remaining excerpts'));assert.equal(env.requests.filter(r=>r.method==='POST').length,1);
 assert.equal(document.querySelector('[aria-label="Reprocessing progress"]').value,3);
 assert.match(document.querySelector('.reprocessing-progress small').textContent,/after a successful excerpt in this session/);
 await env.click(env.button('Review changes (2)'));assert.ok([...document.querySelectorAll('.reprocessing-select input')].every(el=>el.disabled));
 await env.click(env.button('Stop and keep progress'));assert.ok(env.requests.find(r=>r.url.endsWith('/cancel')));assert.ok(env.button('Resume remaining excerpts'));assert.equal(document.querySelector('[aria-label="Reprocessing progress"]').value,3);
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
 r.updatedAt='2026-10-24T12:00:00Z';r.report.excerpts=[{index:0,status:'running',attempts:2,startPage:1,endPage:1,durationMs:400}];
 await act(async()=>{for(const callback of [...scheduled])await callback();});
 assert.ok(details()>1,'Changed attempt checkpoint refreshes detail even when completion count is unchanged');assert.match(document.querySelector('.reprocessing-ledger').textContent,/Processing.*Attempts: 2/s);
});

test('partial failures show actionable processing cause and excerpt ledger separately from editorial review',async t=>{
 const r=fixture();r.status='failed';r.report.chunksCompleted=1;r.report.chunksTotal=3;r.report.error='Provider rejected the request configuration.';r.report.errorCode='provider_http_422';
 r.report.excerpts=[{index:0,status:'completed',attempts:1,startPage:1,endPage:2,durationMs:1200},{index:1,status:'failed',attempts:1,startPage:3,endPage:3,durationMs:400,error:'Unsupported reasoning',errorCode:'provider_http_400'},{index:2,status:'pending',attempts:0,startPage:4,endPage:4,durationMs:0}];
 r.report.diagnostics=['Excerpt 1: preserve this quotation.','Excerpt 1, suggestion 1: excluded from review — ambiguous canonical text.'];
 const env=await mount(t,{initial:r,post:async(_,current)=>({...current,status:'queued'})});
 assert.match(document.querySelector('.reprocessing-progress').textContent,/Partial revision.*1 \/ 3 excerpts completed/s);
 assert.match(document.querySelector('.reprocessing-failure').textContent,/Settings → Intelligence/);
 assert.match(document.querySelector('.reprocessing-ledger').textContent,/Pages 1–2.*Completed.*Attempts: 1.*Page 3.*Failed.*Unsupported reasoning.*Page 4.*Not started/s);
 assert.equal(env.button('Review changes (2)').getAttribute('aria-pressed'),'true');
 assert.ok(env.button('Read partial revision'));assert.ok(env.button('Retry after configuration repair'));
 const summaries=[...document.querySelectorAll('.reprocessing-report summary')].map(node=>node.textContent);
 assert.ok(summaries.includes('Processing errors'));assert.ok(summaries.includes('Excluded suggestions (1)'));assert.ok(summaries.includes('Editorial observations'));
 await env.click(env.button('Retry after configuration repair'));assert.ok(env.requests.some(entry=>entry.url.endsWith('/resume')));
});
test('start preview uses supported selected reasoning and never claims forced none',async t=>{
 const env=await mount(t,{post:async()=>fixture()});await env.click(env.button('Reprocess with AI'));
 const preview=document.querySelector('.reprocessing-configuration');assert.match(preview.textContent,/GPT-5 Mini.*low reasoning/s);assert.match(preview.textContent,/Supported reasoning: minimal, low, medium, high/);assert.doesNotMatch(document.querySelector('.reprocessing-prompt').textContent,/Reasoning: none/);
 assert.equal(env.button('Start reprocessing').disabled,false);
});
test('resumed session estimates exclude previous successes and expose only current successful durations',async t=>{
 const r=fixture();r.status='running';r.report.chunksTotal=5;r.report.chunksCompleted=3;r.report.concurrency=2;r.report.sessionStartedAt='2026-10-24T10:00:00Z';
 r.report.excerpts=[{index:0,status:'completed',attempts:1,durationMs:900000,lastAttemptAt:'2026-10-20T00:00:00Z'},{index:1,status:'completed',attempts:1,durationMs:900000,lastAttemptAt:'2026-10-20T00:01:00Z'},{index:2,status:'completed',attempts:1,durationMs:602000,lastAttemptAt:'2026-10-24T10:00:01Z',history:[{startedAt:'2026-10-23T10:00:01Z',durationMs:600000,errorCode:'provider_unavailable'},{startedAt:'2026-10-24T10:00:01Z',durationMs:2000}]}];
 await mount(t,{initial:r});assert.match(document.querySelector('.reprocessing-progress small').textContent,/~2s$/);
});

test('uncertain provider outcomes explain manual resume duplication risk beside progress',async t=>{
 const r=fixture();r.status='failed';r.report.chunksTotal=2;r.report.chunksCompleted=1;r.report.error='The transport timed out.';r.report.errorCode='transport_timeout';r.report.excerpts=[{index:1,status:'failed',attempts:1,durationMs:180000,error:'Transport timeout',errorCode:'transport_timeout',outcomeUncertain:true}];
 const env=await mount(t,{initial:r});assert.match(document.querySelector('.reprocessing-progress').textContent,/not retried automatically.*incur another charge/s);assert.ok(env.button('Retry failed and remaining excerpts'));assert.equal(env.requests.filter(entry=>entry.method==='POST').length,0);
});

test('resumed ledger preserves each last attempt configuration and marks incomplete token totals',async t=>{
 const r=fixture();r.status='failed';r.report.model='gpt-5-mini';r.report.reasoningEffort='low';r.report.chunksCompleted=1;r.report.chunksTotal=2;r.report.error='Provider model unavailable';r.report.errorCode='provider_http_404';r.report.usageIncomplete=true;
 r.report.excerpts=[{index:0,status:'completed',attempts:1,durationMs:2000,history:[{model:'gpt-5-mini',reasoningEffort:'medium',startedAt:'2026-10-23T10:00:00Z',durationMs:2000}]},{index:1,status:'failed',attempts:2,durationMs:500,history:[{model:'gpt-5-mini',reasoningEffort:'medium',startedAt:'2026-10-23T10:00:00Z',durationMs:200,errorCode:'provider_http_400'},{model:'gpt-5-mini',reasoningEffort:'low',startedAt:'2026-10-24T10:00:00Z',durationMs:300,errorCode:'provider_http_404'}]}];
 const env=await mount(t,{initial:r});const rows=[...document.querySelectorAll('.reprocessing-ledger li')];assert.match(rows[0].textContent,/Last attempt: GPT-5 Mini.*medium reasoning/);assert.match(rows[1].textContent,/Last attempt: GPT-5 Mini.*low reasoning/);
 assert.match(document.querySelector('.reprocessing-report').textContent,/Current session model \/ reasoninggpt-5-mini \/ low/);assert.match(document.querySelector('.reprocessing-report').textContent,/Token totals are incomplete.*only reported usage/);assert.ok(env.button('Retry after configuration repair'));
});
