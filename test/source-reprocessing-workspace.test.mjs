import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {setupDOM} from './helpers/dom.mjs';
const css=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export default {};',shortCircuit:true}:next(url,context);}});
const {SourceReprocessingSetup}=await import('../src/client/sources/SourceReprocessingSetup.tsx');
const {SourceReprocessingProgress}=await import('../src/client/sources/SourceReprocessingProgress.tsx');
css.deregister();
async function mount(t,component,props){
 const env=setupDOM(t,{html:'<section class="source-reprocessing"><div class="reprocessing-bar"><button id="fallback" class="reprocessing-loading-button">Processing status</button></div><button id="trigger">Refine text</button><div id="mount"></div></section>'});
 // jsdom does not implement the browser's dialog top layer or focus traversal.
 env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;this.querySelector('button')?.focus();};
 env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 document.querySelector('#trigger').focus();const root=createRoot(document.querySelector('#mount'));
 env.defer(()=>act(async()=>root.unmount()));
 const render=async next=>act(async()=>root.render(React.createElement(component,next)));
 await render(props);return {...env,root,render,click:async element=>act(async()=>element.click())};
}
function setupProps(overrides={}){return {fileId:'f',configuration:{model:'gpt-5-mini',reasoningEffort:'low'},configurationError:'',depth:'balanced',onDepth(){},substantialMath:false,onSubstantialMath(){},reviewPolicy:'verified',onReviewPolicy(){},instructions:'',onInstructions(){},evidenceCapabilities:{originalPages:true,ocr:true,externalImages:true,reason:''},evidenceError:'',evidenceOptions:{originalPages:false,ocr:false,allowExternalTransmission:false},onEvidenceOptions(){},busy:false,running:false,onStart(){},onClose(){},...overrides};}
function revision(){return JSON.parse(readFileSync(new URL('./fixtures/dante-editorial-revision.json',import.meta.url),'utf8'));}
function progressProps(r,overrides={}){return {revision:r,busy:false,running:r.status==='running',pending:2,onStop(){},onResume(){},onReview(){},onRefine(){},...overrides};}
test('setup is a labelled modal with advanced evidence and conspicuous per-run consent',async t=>{
 let options;let props=setupProps({onEvidenceOptions:value=>{options=value;}});
 const env=await mount(t,SourceReprocessingSetup,props),dialog=document.querySelector('dialog');
 assert.equal(dialog.open,true);assert.equal(document.activeElement.getAttribute('aria-label'),'Processing depth');assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent,'Refine text');
 const advanced=document.querySelector('.reprocessing-advanced');assert.equal(advanced.open,false);
 assert.equal(document.querySelector('.reprocessing-transmission-consent'),null);
 await env.click(document.querySelector('[aria-label="Compare original-page images with the model"]'));
 assert.deepEqual(options,{originalPages:true,ocr:false,allowExternalTransmission:false});
 props={...props,evidenceOptions:options};await env.render(props);
 assert.ok(document.querySelector('.reprocessing-transmission-consent'));assert.equal(advanced.contains(document.querySelector('.reprocessing-transmission-consent')),false);
 assert.equal(document.querySelector('button[type="submit"]').disabled,true);
 await env.click(document.querySelector('[aria-label="Allow selected source evidence to be sent to the AI provider"]'));await env.render({...props,evidenceOptions:options});
 assert.equal(document.querySelector('button[type="submit"]').disabled,false);
 await env.click(document.querySelector('[aria-label="Use local OCR evidence"]'));
 assert.equal(options.allowExternalTransmission,false,'Changing selected evidence revokes earlier consent');
 await act(async()=>env.root.unmount());assert.equal(document.activeElement.id,'trigger');
});
test('setup Escape and controls respect an in-flight start',async t=>{
 let closes=0;const props=setupProps({busy:true,onClose:()=>closes++}),env=await mount(t,SourceReprocessingSetup,props);
 await act(async()=>document.querySelector('dialog').dispatchEvent(new env.dom.window.Event('cancel',{cancelable:true})));
 assert.equal(closes,0);assert.equal(document.querySelector('select').disabled,true);
 await env.render({...props,busy:false});await act(async()=>document.querySelector('dialog').dispatchEvent(new env.dom.window.Event('cancel',{cancelable:true})));
 assert.equal(closes,1);
});
test('monitor shows workflow progress separately from completed coverage and current activity',async t=>{
 const r=revision();r.pipelineVersion=2;r.status='running';r.updatedAt=new Date(Date.now()-45000).toISOString();r.report.stage='verifying';r.report.stageProgress={completed:3,total:5};r.report.chunksCompleted=2;r.report.chunksTotal=5;r.report.excerpts=[{index:3,status:'running',activePass:2,requiredPassCount:2,attempts:1,durationMs:0}];
 await mount(t,SourceReprocessingProgress,progressProps(r));
 const progress=document.querySelector('[aria-label="Overall revision progress"]');assert.equal(progress.value,65);assert.equal(progress.max,100);
 assert.match(document.querySelector('.reprocessing-monitor-main').textContent,/Verifying excerpts · Stage 3 of 4.*2 of 5 excerpts completed.*Checking excerpt 4 · Pass 2 of 2 · Last update 45 seconds ago/s);
 assert.equal(document.querySelector('.reprocessing-monitor-details').open,false);
 assert.match(document.querySelector('[data-reprocessing-stage="verifying"]').textContent,/3 \/ 5 items processed in this stage/);
});
test('uncertain v2 outcome offers explicit new revision while retained recoverable work resumes only on action',async t=>{
 const r=revision();r.pipelineVersion=2;r.status='interrupted';r.report.chunksCompleted=1;r.report.chunksTotal=2;r.report.excerpts=[{index:1,status:'interrupted',outcomeUncertain:true,attempts:1,durationMs:0}];
 let resumed=0,refined=0;const props=progressProps(r,{onResume:()=>resumed++,onRefine:()=>refined++}),env=await mount(t,SourceReprocessingProgress,props);
 const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
 assert.equal(button('Resume remaining excerpts'),undefined);assert.equal(resumed,0);
 assert.match(document.querySelector('[id^="reprocessing-uncertain-"]').textContent,/not retried automatically.*another charge may apply/s);
 await env.click(button('Start a new revision'));assert.equal(refined,1);
 r.report.excerpts[0].outcomeUncertain=false;await env.render({...props,revision:{...r}});assert.equal(resumed,0);
 await env.click(button('Resume remaining excerpts'));assert.equal(resumed,1);
});

test('V2 estimates use recorded excerpt durations and activity does not invent pass totals',async t=>{
 const r=revision();r.pipelineVersion=2;r.status='running';r.report.stage='verifying';r.report.chunksCompleted=1;r.report.chunksTotal=3;r.report.concurrency=1;r.report.excerpts=[{index:0,status:'completed',durationMs:2000,attempts:2},{index:1,status:'running',activePass:2,durationMs:0,attempts:2}];
 const env=await mount(t,SourceReprocessingProgress,progressProps(r));
 assert.match(document.querySelector('.reprocessing-monitor-details').textContent,/Est. excerpt time remaining: ~4 seconds/);
 const activity=()=>document.querySelector('.reprocessing-monitor-activity').textContent;
 assert.match(activity(),/Checking excerpt 2 · Pass 2 · Last update/);assert.doesNotMatch(activity(),/Pass 2 of/);
 await env.render(progressProps({...r,status:'queued'}));assert.doesNotMatch(activity(),/Checking excerpt|Pass 2/);
 await env.render(progressProps({...r,report:{...r.report,evidencePreparation:{state:'collecting',preparedChunks:0,totalChunks:3}}}));assert.doesNotMatch(activity(),/Checking excerpt|Pass 2/);
});
test('setup Escape key stays inside the sheet while native cancellation closes it',async t=>{
 let closes=0,bubbled=0;const env=await mount(t,SourceReprocessingSetup,setupProps({onClose:()=>closes++}));
 document.addEventListener('keydown',()=>bubbled++);
 await act(async()=>document.querySelector('select').dispatchEvent(new env.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.equal(bubbled,0);assert.equal(closes,0);
 await act(async()=>document.querySelector('dialog').dispatchEvent(new env.dom.window.Event('cancel',{cancelable:true})));assert.equal(closes,1);
});

test('setup returns to processing status when its recovery opener disappears after starting',async t=>{
 const env=await mount(t,SourceReprocessingSetup,setupProps());document.querySelector('#trigger').remove();await act(async()=>env.root.unmount());assert.equal(document.activeElement.id,'fallback');
});

test('workflow bar advances through all four stages and hides after completion',async t=>{
 const r=revision();r.pipelineVersion=2;r.status='running';r.report.chunksCompleted=0;r.report.chunksTotal=4;
 const env=await mount(t,SourceReprocessingProgress,progressProps(r));
 const progress=()=>document.querySelector('[aria-label="Overall revision progress"]');
 for(const [stage,start,middle,end] of [['reconstructing',0,12.5,25],['understanding',25,37.5,50],['verifying',50,62.5,75],['auditing',75,87.5,99]]){
  for(const [completed,expected] of [[0,start],[1,middle],[2,end]]){
   r.report.stage=stage;r.report.stageProgress={completed,total:2};
   await env.render(progressProps({...r}));assert.equal(progress().value,expected,`${stage}: ${completed}/2`);
  }
 }
 r.report.chunksCompleted=4;await env.render(progressProps({...r,status:'completed'}));assert.equal(progress(),null);assert.ok(document.querySelector('[aria-label="Processing details"]'));
 await env.render(progressProps({...r,status:'interrupted'}));assert.equal(progress().value,99);
});
test('light revisions share progress across only their two applicable stages',async t=>{
 const r=revision();r.pipelineVersion=2;r.configuration={depth:'light'};r.status='running';r.report.stage='reconstructing';r.report.stageProgress={completed:1,total:2};
 const env=await mount(t,SourceReprocessingProgress,progressProps(r));
 assert.equal(document.querySelector('progress').value,25);assert.match(document.querySelector('.reprocessing-monitor-main').textContent,/Stage 1 of 2/);
 r.report.stage='auditing';r.report.stageProgress={completed:0,total:1};await env.render(progressProps({...r}));
 assert.equal(document.querySelector('progress').value,50);assert.match(document.querySelector('.reprocessing-monitor-main').textContent,/Stage 2 of 2/);
});
test('evidence preparation contributes progress even before the first AI stage and retains it when stopped',async t=>{
 const r=revision();r.pipelineVersion=2;r.status='running';delete r.report.stage;r.report.evidencePreparation={state:'collecting',preparedChunks:1,totalChunks:2};
 const env=await mount(t,SourceReprocessingProgress,progressProps(r));
 const progress=()=>document.querySelector('[aria-label="Overall revision progress"]');assert.equal(progress().value,10);
 await env.render(progressProps({...r,status:'interrupted'}));assert.equal(progress().value,10);
 r.report.evidencePreparation={state:'completed',preparedChunks:2,totalChunks:2};r.report.stage='reconstructing';r.report.stageProgress={completed:0,total:2};
 await env.render(progressProps({...r}));assert.equal(progress().value,20);
});
test('legacy excerpt coverage remains available without stage information',async t=>{
 const r=revision();r.pipelineVersion=1;r.status='running';r.report.chunksCompleted=1;r.report.chunksTotal=3;
 await mount(t,SourceReprocessingProgress,progressProps(r));const progress=document.querySelector('[aria-label="Completed excerpt coverage"]');assert.equal(progress.value,1);assert.equal(progress.max,3);
});
