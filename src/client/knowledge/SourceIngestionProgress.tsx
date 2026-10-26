import {useEffect,useRef,useState} from 'react';
import type {SourceProcessingRunView} from '../../shared/source-ingestion';
import {request} from '../api';
import {t as uiText} from '../i18n';

const stages={preparation:'Preparing PDF',upload:'Uploading PDF',extraction:'Extracting text and structure',validation:'Assembling and validating',repair:'Checking unresolved passages',publication:'Publishing source',indexing:'Building search index'};
export function SourceIngestionProgress({vaultId,fileId,onPresence}:{vaultId:string;fileId:string;onPresence:(present:boolean)=>void}){
 const identity=useRef('');identity.current=vaultId+':'+fileId;
 const [run,setRun]=useState<SourceProcessingRunView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[allowUnknown,setAllowUnknown]=useState(false),[now,setNow]=useState(Date.now());
 useEffect(()=>{let stopped=false;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();setRun(null);setBusy(false);setError('');setAllowUnknown(false);onPresence(false);
  async function poll(){try{const next=await request<SourceProcessingRunView|null>(`source-files/${encodeURIComponent(fileId)}/ingestion`,'GET',undefined,vaultId,controller.signal);if(stopped)return;setRun(next);onPresence(!!next);setError('');if(next&&!['completed','cancelled'].includes(next.state))timer=setTimeout(poll,1500);}catch(cause){if(!stopped){setError(cause instanceof Error?cause.message:String(cause));timer=setTimeout(poll,3000);}}}
  void poll();return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[vaultId,fileId,onPresence]);
 useEffect(()=>{if(!run||!['pending','running'].includes(run.state))return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[run?.state]);
 if(!run)return <p className="section-hint" role={error?'alert':'status'}>{error||uiText('Loading PDF processing monitor…')}</p>;
 async function act(action:'stop'|'resume'|'retry'){if(busy)return;const actionIdentity=identity.current;setBusy(true);setError('');try{const next=await request<SourceProcessingRunView>(`source-files/${encodeURIComponent(fileId)}/ingestion/${action}`,'POST',action==='resume'?{allowUnknown}:{},vaultId);if(identity.current!==actionIdentity)return;setRun(next);setAllowUnknown(false);}catch(cause){if(identity.current===actionIdentity)setError(cause instanceof Error?cause.message:String(cause));}finally{if(identity.current===actionIdentity)setBusy(false);}}
 const elapsed=Math.max(0,Math.floor((now-Date.parse(run.startedAt))/1000));
 return <section className="section-hint" aria-label={uiText('PDF processing progress')} aria-busy={busy}>
  <p role="status"><strong>{uiText(stages[run.stage])}</strong> · {run.provider==='openai'?'OpenAI':run.provider==='gemini'?'Gemini':uiText('Local extraction')}{run.model?` · ${run.model}`:''}</p>
  {!!run.activePages.length&&<p>{uiText('Physical pages:')} {run.activePages.join(', ')}</p>}
  <progress max={Math.max(1,run.pageCount)} value={run.completedPages} aria-label={uiText('Validated physical pages')}/>
  <p>{run.completedPages} {uiText('of')} {run.pageCount} {uiText('physical pages validated')} · {run.completedWindows} {uiText('of')} {run.totalWindows} {uiText('windows complete')}{run.pendingReview>0?` · ${run.pendingReview} ${uiText('proposals need review')}`:''}</p>
  <p>{Math.floor(elapsed/60)}m {elapsed%60}s {uiText('elapsed')} · {uiText('Last update:')} <time dateTime={run.updatedAt}>{new Date(run.updatedAt).toLocaleTimeString()}</time></p>
  {run.error&&<p role="alert">{run.error}</p>}{error&&<p role="alert">{error}</p>}
  {run.unknownOutcome&&<><p role="alert">{uiText('A submitted provider request has an unknown outcome. Resuming may repeat paid work. Completed window results are retained.')}</p><label><input type="checkbox" checked={allowUnknown} onChange={event=>setAllowUnknown(event.target.checked)} disabled={busy}/>{uiText('I understand the possible duplicate cost and want to retry this unknown request.')}</label></>}
  <div className="source-actions">
   {['pending','running'].includes(run.state)&&<button type="button" className="button small" disabled={busy} onClick={()=>void act('stop')}>{uiText('Stop and keep progress')}</button>}
   {run.canResume&&<button type="button" className="button small" disabled={busy||run.unknownOutcome&&!allowUnknown} onClick={()=>void act('resume')}>{uiText('Resume unfinished work')}</button>}
   {run.state==='failed'&&!run.unknownOutcome&&<button type="button" className="button small" disabled={busy} onClick={()=>void act('retry')}>{uiText('Retry failed work')}</button>}
  </div>
  <p>{run.state==='completed'?uiText('Transcription published. Optional indexing and review have separate status.'):uiText('Validated pages are retained. You can leave this panel while processing continues.')}</p>
 </section>;
}
