import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {SourceLoadingProgress} from '../src/client/knowledge/SourceLoadingProgress.tsx';
import {SourceInspectorStatus} from '../src/client/knowledge/SourceInspectorStatus.tsx';
const css=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);}});
const {SourceReprocessing}=await import('../src/client/sources/SourceReprocessing.tsx');
css.deregister();
const fixture=()=>{
 const r=JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8'));
 r.acceptanceMode='review_all';r.patches=r.patches.slice(0,2).map((p,i)=>({...p,id:'patch-'+i,decision:'pending',riskReasons:['Quotation wording requires comparison with the PDF.']}));
 r.reprocessed=structuredClone(r.original);r.reprocessed.document.semantic.children=[];r.reprocessed.text='Sample reading text';return r;
};
async function mount(t,{initial=null,post,onReadingRevision,get,onShow=()=>{},onOriginal=()=>{}}={}){
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
  else result=get?await get(entry,revision):revision;
  return {ok:true,json:async()=>structuredClone(result)};
 });
 const root=createRoot(document.querySelector('#mount'));
 const props={vaultId:'v',fileId:'f',visible:true,onReadingRevision,onShow,onOriginal};
 await act(async()=>root.render(React.createElement(SourceReprocessing,{...props,key:'f'})));
 const switchFile=async fileId=>act(async()=>root.render(React.createElement(SourceReprocessing,{...props,fileId,key:fileId})));
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else delete globalThis[key];});});
 const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
 const click=async el=>{assert.ok(el,'Expected control exists');await act(async()=>el.click());};
 return {button,click,requests,dom,switchFile};
}
test('review policy defaults to balanced and starting disables repeated submissions',async t=>{
 let finish;const env=await mount(t,{post:()=>new Promise(resolve=>{finish=resolve;})});
 await env.click(env.button('Reprocess with AI'));assert.equal(document.querySelector('[aria-label="Review policy"]').value,'balanced');
 await env.click(env.button('Start reprocessing'));assert.equal(env.requests.filter(r=>r.method==='POST').length,1);
 assert.equal(env.requests.find(r=>r.method==='POST').body.acceptanceMode,'balanced');
 const starting=env.button('Starting…');assert.equal(starting.disabled,true);await env.click(starting);assert.equal(env.requests.filter(r=>r.method==='POST').length,1);
 const r=fixture();r.status='queued';await act(async()=>finish(r));assert.ok(document.querySelector('[aria-label="Reprocessing progress"]'));
});
test('risky changes show evidence warnings and batch review submits only selected patches',async t=>{
 let finish;const r=fixture(),env=await mount(t,{initial:r,post:entry=>new Promise(resolve=>{finish=()=>resolve({...r,updatedAt:'2026-10-20T00:00:00Z',patches:r.patches.map(p=>entry.body.decisions.some(d=>d.patchId===p.id)?{...p,decision:'accepted'}:p)});})});
 await env.click(env.button('Review changes (2)'));assert.match(document.body.textContent,/Quotation wording requires comparison/);
 await env.click(env.button('Bulk review'));await env.click(document.querySelector('.reprocessing-select input'));
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
 await env.click(env.button('Review changes (2)'));await env.click(env.button('Bulk review'));await env.click(document.querySelector('.reprocessing-select input'));
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
 assert.match(document.querySelector('[id^="reprocessing-error-"]').textContent,/Settings → Intelligence/);
 assert.match(document.querySelector('.reprocessing-ledger').textContent,/Pages 1–2.*Completed.*Attempts: 1.*Page 3.*Failed.*Unsupported reasoning.*Page 4.*Not started/s);
 assert.equal(document.querySelector('.reprocessing-reviews'),null);
 assert.equal(document.querySelector('[aria-label="Reading version"] option[value="'+r.id+'"]'),null);assert.ok(env.button('Retry after configuration repair'));
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

 test('pending count excludes applied and rejected changes and never opens review automatically',async t=>{
 const r=fixture();r.patches[1].decision='accepted';const env=await mount(t,{initial:r});
 assert.ok(env.button('Review changes (1)'));assert.equal(document.querySelector('.reprocessing-reviews'),null);
 assert.equal(document.querySelector('.reprocessing-processing-details').open,false);
 await env.click(env.button('Review changes (1)'));assert.equal(document.querySelectorAll('.reprocessing-patch').length,1);
 assert.equal(document.querySelector('.reprocessing-patch-explanation').open,false);
 assert.equal(document.querySelector('[aria-label="Comparison layout"]').value,'unified');
 });

test('only explicit completed revision selection changes the reading version',async t=>{
 const r=fixture();r.fileId='f';r.status='completed';r.report.chunksCompleted=r.report.chunksTotal;const readings=[];
 const env=await mount(t,{initial:r,onReadingRevision:value=>readings.push(value)});
 assert.deepEqual(readings,[null]);assert.equal(document.querySelector('.reprocessing-document'),null);
 const picker=document.querySelector('[aria-label="Reading version"]');assert.ok([...picker.options].some(option=>option.value===r.id));
 await act(async()=>{picker.value=r.id;picker.dispatchEvent(new env.dom.window.Event('change',{bubbles:true}));});
 assert.equal(readings.at(-1).id,r.id);assert.equal(document.querySelector('.reprocessing-reviews'),null);
 await act(async()=>{picker.value='original';picker.dispatchEvent(new env.dom.window.Event('change',{bubbles:true}));});assert.equal(readings.at(-1),null);
});

test('master-detail review pages history, supports keyboard navigation and opens bulk mode explicitly',async t=>{
 const r=fixture();r.patches=Array.from({length:45},(_,index)=>({...r.patches[0],id:'p'+index,original:'Passage '+index}));const env=await mount(t,{initial:r});
 await env.click(env.button('Review changes (45)'));assert.equal(document.querySelectorAll('.reprocessing-patch').length,1);assert.equal(document.querySelectorAll('.reprocessing-patch-list li').length,20);assert.equal(document.querySelector('.reprocessing-select'),null);
 const first=document.querySelector('.reprocessing-patch-list li>button');await act(async()=>first.dispatchEvent(new env.dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
 assert.equal(document.querySelector('.reprocessing-patch-list li>button[aria-pressed=true]').textContent.includes('Passage 1'),true);
 await env.click(env.button('Load more changes'));assert.equal(document.querySelectorAll('.reprocessing-patch-list li').length,40);
 await env.click(env.button('Bulk review'));assert.equal(document.querySelectorAll('.reprocessing-select input').length,40);
 await act(async()=>document.querySelector('.reprocessing-reviews').dispatchEvent(new env.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(document.querySelector('.reprocessing-reviews'),null);assert.equal(document.activeElement,env.button('Review changes (45)'));
});
test('automatic history is separate from pending queue and offers audit and reversal',async t=>{
 const r=fixture();r.patches[1].decision='accepted';r.patches[1].autoAcceptance={policy:'balanced',validator:'deterministic-test',checks:['canonical text preserved'],appliedAt:r.createdAt};
 const env=await mount(t,{initial:r,post:async(entry,current)=>({...current,patches:current.patches.map(p=>p.id===entry.body.decisions[0].patchId?{...p,decision:entry.body.decisions[0].decision}:p)})});
 await env.click(env.button('Review changes (1)'));const history=[...document.querySelectorAll('.reprocessing-review-filters button')].find(button=>button.textContent.startsWith('Automatically applied'));await env.click(history);
 assert.match(document.querySelector('.reprocessing-patch').textContent,/deterministic-test.*canonical text preserved/s);await env.click(env.button('Reverse applied change'));
 assert.equal(env.requests.find(request=>request.method==='POST').body.decisions[0].decision,'rejected');assert.equal(document.querySelectorAll('.reprocessing-patch').length,0);
});
test('a delayed reading version response cannot replace original after switching back',async t=>{
 const r=fixture();r.fileId='f';r.status='completed';r.report.chunksCompleted=r.report.chunksTotal;let finish,details=0;const readings=[];
 const env=await mount(t,{initial:r,onReadingRevision:value=>readings.push(value),get:async()=>{details++;return details>1?new Promise(resolve=>{finish=resolve;}):r;}});
 const picker=document.querySelector('[aria-label="Reading version"]');await act(async()=>{picker.value=r.id;picker.dispatchEvent(new env.dom.window.Event('change',{bubbles:true}));});
 assert.equal(typeof finish,'function');await act(async()=>{picker.value='original';picker.dispatchEvent(new env.dom.window.Event('change',{bubbles:true}));});await act(async()=>finish(r));assert.equal(readings.at(-1),null);assert.equal(readings.some(value=>value!==null),false);
});

test('switching source while a start request is pending ignores the old completion',async t=>{
 let finish,shows=0;const env=await mount(t,{post:()=>new Promise(resolve=>{finish=resolve;}),onShow:()=>shows++});
 await env.click(env.button('Reprocess with AI'));await env.click(env.button('Start reprocessing'));assert.equal(shows,1);await env.switchFile('another-source');
 await act(async()=>finish(fixture()));assert.equal(shows,1);assert.equal(document.querySelector('.reprocessing-prompt'),null);assert.equal(document.querySelector('.reprocessing-progress'),null);
});

test('reaccepted edited automatic suggestions are attributed to the latest manual decision',async t=>{
 const r=fixture();r.patches=[{...r.patches[0],decision:'accepted',userReplacement:'Manually corrected text',autoAcceptance:{policy:'balanced',validator:'deterministic-test',checks:['original validation'],appliedAt:r.createdAt},decisionHistory:[{at:r.createdAt,actor:'automatic',from:'pending',to:'accepted'},{at:r.updatedAt,actor:'user',from:'accepted',to:'rejected'},{at:r.updatedAt,actor:'user',from:'rejected',to:'accepted',replacement:'Manually corrected text'}]}];
 const env=await mount(t,{initial:r});await env.click(env.button('Review changes (0)'));
 const filters=[...document.querySelectorAll('.reprocessing-review-filters button')];assert.match(filters.find(button=>button.textContent.startsWith('Automatically applied')).textContent,/0$/);
 const manual=filters.find(button=>button.textContent.startsWith('Applied manually'));assert.match(manual.textContent,/1$/);await env.click(manual);assert.match(document.querySelector('.reprocessing-patch').textContent,/Manually corrected text/);assert.match(document.querySelector('.reprocessing-patch').textContent,/deterministic-test/);
});


test('review location selects the specific passage instead of its containing chapter',async t=>{
 const r=fixture(),patch=r.patches[0],locations=[];
 r.original.document.semantic.children=[{id:'container',kind:'chapter',title:'Parent',range:{...patch.range,startOffset:0,endOffset:r.original.text.length},children:[{id:'leaf',kind:'paragraph',range:{...patch.range},text:patch.original}]}];
 patch.nodeIds=['container','leaf'];
 const env=await mount(t,{initial:r,onOriginal:(nodeId,focus)=>locations.push({nodeId,focus})});
 await env.click(env.button('Review changes (2)'));await env.click(document.querySelector('.reprocessing-patch-list li>button'));
 assert.deepEqual(locations,[{nodeId:'leaf',focus:false}]);
});

test('shared source progress preserves partial coverage and separates stage announcements from numeric updates',async t=>{
 const r=fixture();r.status='interrupted';r.report.chunksCompleted=1;r.report.chunksTotal=3;
 r.report.error='Synthetic interrupted extraction';
 await mount(t,{initial:r});
 const progress=document.querySelector('.reprocessing-progress .progress-notice');
 assert.equal(progress.dataset.state,'interrupted');
 assert.equal(progress.querySelector('.notice-icon').dataset.tone,'warning');
 assert.equal(progress.querySelector('progress').value,1);
 assert.equal(progress.querySelector('progress').max,3);
 assert.match(progress.querySelector('[aria-live="polite"]').textContent,/Partial revision/);
 assert.doesNotMatch(progress.querySelector('[aria-live="polite"]').textContent,/1 \/ 3/);
 assert.match(document.querySelector('.reprocessing-progress').textContent,/Synthetic interrupted extraction.*Completed excerpts and review decisions are retained/s);
 assert.ok(document.querySelector('.reprocessing-progress .inline-notice[data-tone="warning"]'));
});


test('source loading uses only supported determinate progress and retains storage diagnostics',()=>{
 const file={id:'source',name:'Article.pdf',generated_name:null,status:'queued',enrichment_status:'pending',progress:0,pages:0,error:null,enrichment_error:null};
 const markup=value=>new JSDOM(renderToStaticMarkup(React.createElement(SourceLoadingProgress,{file:{...file,...value}}))).window.document;
 const queued=markup({});
 assert.equal(queued.querySelector('.progress-notice').dataset.state,'queued');
 assert.equal(queued.querySelector('progress').hasAttribute('value'),false);
 const extracting=markup({status:'processing',progress:35});
 assert.equal(extracting.querySelector('progress').value,35);
 assert.equal(extracting.querySelector('progress').max,100);
 assert.doesNotMatch(extracting.querySelector('[aria-live="polite"]').textContent,/35/);
 const math=markup({status:'processing',processing_detail:{completed:2,total:7,startedAt:Date.now(),updatedAt:Date.now()}});
 assert.equal(math.querySelector('[aria-label="Math preparation batches completed"]').value,2);
 assert.equal(math.querySelector('progress').max,7);
 const failed=new JSDOM(renderToStaticMarkup(React.createElement(SourceInspectorStatus,{files:[{...file,status:'failed',error:'Detailed extraction error'}],vaultId:'v',onChange:()=>{},onError:()=>{}}))).window.document;
 assert.equal(failed.querySelector('.inline-notice[data-tone="error"]').textContent,'Article.pdfProcessing failedRetry processing');
 assert.match(failed.body.textContent,/Detailed extraction error/);
 assert.equal(failed.querySelector('.inline-notice[data-tone="error"] button').textContent,'Retry processing');
 for(const document of [queued,extracting,math,failed])document.defaultView.close();
});
