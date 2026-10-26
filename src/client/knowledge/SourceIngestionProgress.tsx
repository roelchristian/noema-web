import {useEffect,useRef,useState} from 'react';
import type {SourceProcessingRunView} from '../../shared/source-ingestion';
import {request} from '../api';
import {t as uiText} from '../i18n';
import {ProgressNotice} from '../notifications';
import {DisclosureSummary} from '../components/DisclosureSummary';

const checkpointStages=['preparation','extraction','validation','publication'] as const;
const checkpointLabels={preparation:'Prepare PDF',extraction:'Transcribe pages',validation:'Validate document',publication:'Publish source'};
const windowStates:Record<string,string>={pending:'Waiting',running:'In progress',candidate:'Response received · awaiting validation',completed:'Completed',failed:'Failed',unknown:'Outcome unknown',invalid:'Invalid response',skipped:'Not needed'};
const stages={preparation:'Preparing PDF',upload:'Uploading PDF',extraction:'Extracting text and structure',validation:'Assembling and validating',repair:'Checking unresolved passages',publication:'Publishing source',indexing:'Building search index'};
export function SourceIngestionProgress({vaultId,fileId,onPresence}:{vaultId:string;fileId:string;onPresence:(present:boolean)=>void}){
 const identity=useRef(''),lastSource=useRef('');identity.current=vaultId+':'+fileId;
 const [pollVersion,setPollVersion]=useState(0);
 const previousState=useRef<string|null>(null);
 useEffect(()=>{const refresh=(event:Event)=>{const detail=(event as CustomEvent<{vaultId:string;fileId:string}>).detail;if(detail?.vaultId===vaultId&&detail.fileId===fileId)setPollVersion(version=>version+1);};window.addEventListener('noema:source-ingestion-updated',refresh);return()=>window.removeEventListener('noema:source-ingestion-updated',refresh);},[vaultId,fileId]);
 const [run,setRun]=useState<SourceProcessingRunView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[allowUnknown,setAllowUnknown]=useState(false),[now,setNow]=useState(Date.now());
 useEffect(()=>{let stopped=false;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();if(lastSource.current!==identity.current){lastSource.current=identity.current;previousState.current=null;setRun(null);setBusy(false);setError('');setAllowUnknown(false);onPresence(false);}
  async function poll(){try{const next=await request<SourceProcessingRunView|null>(`source-files/${encodeURIComponent(fileId)}/ingestion`,'GET',undefined,vaultId,controller.signal);if(stopped)return;setRun(next);onPresence(!!next);setError('');if(next&&['pending','running'].includes(next.state))timer=setTimeout(poll,1500);}catch(cause){if(!stopped){setError(cause instanceof Error?cause.message:String(cause));timer=setTimeout(poll,3000);}}}
  void poll();return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[vaultId,fileId,onPresence,pollVersion]);
 useEffect(()=>{if(!run||run.fileId!==fileId)return;if(run.state==='completed'&&previousState.current&&previousState.current!=='completed')window.dispatchEvent(new CustomEvent('noema:source-ingestion-completed',{detail:{vaultId,fileId}}));previousState.current=run.state;},[run?.state,vaultId,fileId]);
 useEffect(()=>{if(!run||!['pending','running'].includes(run.state))return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[run?.state]);
 if(!run)return <p className="section-hint" role={error?'alert':'status'}>{error||uiText('Loading PDF processing monitor…')}</p>;
 async function act(action:'stop'|'resume'|'retry'){if(busy)return;const actionIdentity=identity.current;setBusy(true);setError('');try{const next=await request<SourceProcessingRunView>(`source-files/${encodeURIComponent(fileId)}/ingestion/${action}`,'POST',action==='resume'?{allowUnknown}:{},vaultId);if(identity.current!==actionIdentity)return;setRun(next);setAllowUnknown(false);setPollVersion(version=>version+1);}catch(cause){if(identity.current===actionIdentity)setError(cause instanceof Error?cause.message:String(cause));}finally{if(identity.current===actionIdentity)setBusy(false);}}
 const active=['pending','running'].includes(run.state);
 const end=active?now:Date.parse(run.updatedAt);
 const elapsed=Math.max(0,Math.floor((end-Date.parse(run.startedAt))/1000))||0;
 const provider=run.provider==='openai'?'OpenAI':run.provider==='gemini'?'Gemini':uiText('Local extraction');
 const coverage=<p>{run.completedPages} {uiText('of')} {run.pageCount} {uiText('physical pages validated')} · {run.completedWindows} {uiText('of')} {run.totalWindows} {uiText('windows complete')} · {run.pendingReview} {uiText('proposals need review')}</p>;
 const timing=<p>{Math.floor(elapsed/60)}m {elapsed%60}s {uiText(active?'elapsed wall time':'recorded wall time')} · {uiText('Includes queueing, pauses and retries.')}</p>;
 const benchmarkNote=<p>{uiText('Compare token usage, estimated cost and request duration in Settings → AI activity log, or Export CSV. Validation and review counts are not accuracy scores.')}</p>;
 const stageIndex=run.stage==='preparation'||run.stage==='upload'?0:run.stage==='extraction'||run.stage==='repair'?1:run.stage==='validation'?2:3;
 // Completed physical pages measure durable coverage, not response streaming or ETA.
 // Leave room for document validation and publication even when every page is read.
 const progress=run.state==='completed'?100:stageIndex===0?0:stageIndex===1?10+70*Math.min(1,run.completedPages/Math.max(1,run.pageCount)):stageIndex===2?80:90;
 const stateLabel=uiText(run.state==='failed'?'PDF processing failed':run.state==='paused'?'PDF processing paused':run.state==='unknown'?'PDF processing needs attention':run.state==='cancelled'?'PDF processing cancelled':run.state==='completed'?'PDF transcription published':run.state==='pending'?'PDF processing queued':stages[run.stage]);
 return <section className="source-ingestion-monitor" aria-label={uiText('PDF processing progress')} aria-busy={busy}>
  <div className="source-ingestion-heading"><div><p className="source-ingestion-eyebrow">{uiText('PDF processing')} · {provider}</p><ProgressNotice id={`ingestion-progress-${run.id}`} compact title={stateLabel} state={run.state==='completed'?'completed':run.state==='failed'?'failed':run.state==='pending'?'queued':active?'running':'interrupted'} stage={active&&run.state==='pending'?uiText(stages[run.stage]):undefined} detail={provider+(run.model?` · ${run.model}`:'')} value={progress} max={100} progressLabel={uiText('Overall PDF processing progress')}/></div><span className="source-ingestion-percent">{Math.floor(progress)}%</span></div>
  <ol className="source-ingestion-checkpoints" aria-label={uiText('PDF processing checkpoints')}>
   {checkpointStages.map((stage,index)=>{const done=run.state==='completed'||index<stageIndex;const current=run.state!=='completed'&&index===stageIndex;const status=done?'Completed':current?run.state==='failed'?'Failed':run.state==='paused'?'Paused':run.state==='unknown'?'Needs attention':run.state==='cancelled'?'Cancelled':run.state==='pending'?'Queued':'In progress':'Waiting';return <li key={stage} data-status={done?'completed':current?run.state:'waiting'} aria-current={current?'step':undefined}><span className="source-ingestion-step" aria-hidden="true">{done?'✓':index+1}</span><span><strong>{uiText(checkpointLabels[stage])}</strong><small>{uiText(status)}</small></span></li>;})}
  </ol>
  {coverage}
  {!!run.activePages.length&&<p>{uiText('Physical pages:')} {run.activePages.join(', ')}</p>}
  {active&&<p className="source-ingestion-help">{uiText('Progress updates when each provider response is validated. A request can take several minutes.')}</p>}
  <details className="source-ingestion-details"><DisclosureSummary>{uiText('Processing details')}</DisclosureSummary>
   {timing}<p>{uiText('Last update:')} <time dateTime={run.updatedAt}>{new Date(run.updatedAt).toLocaleString()}</time></p>
   <p>{uiText('The bar tracks preparation, validated page coverage, document validation and publication. It is not an estimate of time remaining.')}</p>
   {run.depth&&<p>{uiText('Processing depth')}: {uiText(run.depth==='light'?'Light':run.depth==='deep'?'Deep':'Balanced')} · {uiText(run.reviewPolicy==='review-all'?'Review everything':'Verified changes only')}</p>}
   {!!run.windows?.length&&<ol className="source-ingestion-windows" aria-label={uiText('PDF processing window checkpoints')}>{run.windows.map(window=><li key={window.id} data-status={window.state}><div><strong>{uiText(window.kind==='relations'?'Document relations':window.kind==='page-recovery'?'Page recovery':'Window {value0}',{value0:window.number})}</strong><span>{uiText('Physical pages:')} {window.pages.join(', ')}</span><span>{uiText(windowStates[window.state]??'Waiting')}</span><span>{uiText('Attempts: {value0}',{value0:window.attempts})}</span>{window.kind==='extraction'&&<span>{uiText('Passage checks')}: {uiText(windowStates[window.repairState]??'Waiting')}</span>}</div>{window.error&&<p className="dialog-error">{window.error}</p>}</li>)}</ol>}
   {benchmarkNote}
  </details>
  {!!run.warnings?.filter(warning=>warning!==run.error).length&&<ul>{run.warnings.filter(warning=>warning!==run.error).map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
  {run.error&&<p role="alert">{run.error}</p>}{error&&<p role="alert">{error}</p>}
  {run.unknownOutcome&&<><p role="alert">{uiText('A submitted provider request has an unknown outcome. Resuming may repeat paid work. Completed window results are retained.')}</p><label><input type="checkbox" checked={allowUnknown} onChange={event=>setAllowUnknown(event.target.checked)} disabled={busy}/>{uiText('I understand the possible duplicate cost and want to retry this unknown request.')}</label></>}
  <div className="source-actions">
   {['pending','running'].includes(run.state)&&<button type="button" className="button small" disabled={busy} onClick={()=>void act('stop')}>{uiText('Stop and keep progress')}</button>}
   {run.canResume&&<button type="button" className="button small" disabled={busy||run.unknownOutcome&&!allowUnknown} onClick={()=>void act('resume')}>{uiText('Resume unfinished work')}</button>}
   {run.canRetryOptional&&!run.unknownOutcome&&<button type="button" className="button small" disabled={busy} onClick={()=>void act('retry')}>{uiText('Retry failed optional work')}</button>}
   {run.state==='failed'&&!run.canResume&&!run.unknownOutcome&&<button type="button" className="button small" disabled={busy} onClick={()=>void act('retry')}>{uiText('Retry failed work')}</button>}
  </div>
  <p className="source-ingestion-help">{run.state==='completed'?uiText('Transcription published. Optional indexing and review have separate status.'):active?uiText('Validated pages are retained. You can leave this panel while processing continues.'):uiText('Processing is stopped. Completed checkpoints are retained; no further requests run unless you resume.')}</p>
 </section>;
}
