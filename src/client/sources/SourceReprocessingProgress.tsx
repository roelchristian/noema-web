import {useEffect,useId,useState,type ReactNode} from 'react';
import type {SourceReprocessingRevision} from '../../shared/source-reprocessing';
import {t as uiText,getLocale} from '../i18n';
import {Modal,ModalHeader} from '../components/Modal';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {InlineNotice,ProgressNotice} from '../notifications';
import {depthLabels,depthPasses} from './SourceReprocessingSetup';
import './source-reprocessing-workspace.css';
const active=(status:string)=>status==='queued'||status==='running';
const partial=(revision:SourceReprocessingRevision)=>!active(revision.status)&&revision.report.chunksCompleted<revision.report.chunksTotal;
const incompleteResponse=(revision:SourceReprocessingRevision)=>/^provider_(?:output_limit|empty_output|incomplete_output)$/.test(revision.report.errorCode??'')||!!revision.report.error?.startsWith('OpenAI returned an incomplete response.');
const configurationFailure=(revision:SourceReprocessingRevision)=>!incompleteResponse(revision)&&/config|unsupported|provider_http_(?:40[0134]|422)/.test(revision.report.errorCode??'');
type Props={revision:SourceReprocessingRevision;busy:boolean;running:boolean;pending:number;onStop:()=>void;onResume:()=>void;onReview:()=>void;onRefine:()=>void;children?:ReactNode};
export function SourceReprocessingProgress({revision,busy,running,pending,onStop,onResume,onReview,onRefine,children}:Props){
 const {report,status}=revision;
 const [now,setNow]=useState(Date.now);
 const [detailsOpen,setDetailsOpen]=useState(false),detailsTitleId=useId();
 useEffect(()=>{if(!active(status))return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[revision.id,status]);
 const preparingEvidence=status==='running'&&report.evidencePreparation?.state==='collecting',failed=partial(revision);
 const stages:NonNullable<typeof report.stage>[]=revision.configuration?.depth==='light'?['reconstructing','auditing']:['reconstructing','understanding','verifying','auditing'];
 const stage=revision.pipelineVersion===2?report.stage:undefined;
 // Each stage has an equal share of workflow progress, rather than treating
 // final excerpt publication as all of the work. These are work units, not ETA.
 const evidence=report.evidencePreparation;
 const workflowProgress=revision.pipelineVersion===2&&(!!stage||!!evidence);
 const stageCount=stages.length+(evidence?1:0);
 const stageFraction=report.stageProgress&&report.stageProgress.total>0?Math.min(1,Math.max(0,report.stageProgress.completed/report.stageProgress.total)):0;
 const completedStages=stage?Math.max(0,stages.indexOf(stage))+(evidence?1:0):0;
 const workCompleted=evidence?.state==='collecting'?evidence.preparedChunks/Math.max(1,evidence.totalChunks):stage?completedStages+stageFraction:evidence?1:0;
 const progressValue=workflowProgress?(status==='completed'&&!failed?100:Math.min(99,Math.max(0,workCompleted/stageCount*100))):report.chunksCompleted;
 const stageLabels={reconstructing:'Reconstructing excerpts',understanding:'Understanding document',verifying:'Verifying excerpts',auditing:'Checking document consistency'};
 const stageTitle=stage?uiText(stageLabels[stage])+' · '+uiText("Stage {value0} of {value1}",{value0:stages.indexOf(stage)+1,value1:stages.length}):uiText("Reprocessing source…");
 const title=status==='queued'?uiText("Queued for reprocessing"):preparingEvidence?uiText("Preparing original-source evidence locally"):status==='running'?stageTitle:status==='failed'?uiText("Processing failed"):status==='interrupted'?uiText("Processing interrupted"):failed?uiText("Partial revision"):uiText("Processing complete");
 const updatedAt=Date.parse(revision.updatedAt),updateSeconds=Number.isFinite(updatedAt)?Math.max(0,Math.floor((now-updatedAt)/1000)):null;
 const elapsed=(seconds:number)=>seconds<60?uiText("{value0} seconds",{value0:seconds}):uiText("{value0} minutes",{value0:Math.floor(seconds/60)});
 const runningExcerpts=status==='running'&&!preparingEvidence?(report.excerpts??[]).filter(excerpt=>excerpt.status==='running'&&(!stage||stage==='reconstructing'&&excerpt.activePass===1||stage==='verifying'&&(excerpt.activePass??0)>1)):[];
 const passLabel=(excerpt:(typeof runningExcerpts)[number])=>!excerpt.activePass?'':excerpt.requiredPassCount?uiText("Pass {value0} of {value1}",{value0:excerpt.activePass,value1:excerpt.requiredPassCount}):uiText("Pass {value0}",{value0:excerpt.activePass});
 const sessionStarted=report.sessionStartedAt?Date.parse(report.sessionStartedAt):NaN;
 // V2 records aggregate excerpt duration, while V1 records attempt history.
 // V2 has no per-excerpt timestamps: use completed work from this revision,
 // whose processing configuration is fixed, including across resumed sessions.
 const recent=revision.pipelineVersion===2?(report.excerpts??[]).filter(excerpt=>excerpt.status==='completed'&&excerpt.durationMs>0):
  (report.excerpts??[]).filter(excerpt=>excerpt.status==='completed').flatMap(excerpt=>excerpt.history??[]).filter(attempt=>!attempt.errorCode&&!attempt.error&&attempt.durationMs>0&&Date.parse(attempt.startedAt)>=sessionStarted).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)).slice(0,5);
 const remaining=Math.max(0,report.chunksTotal-report.chunksCompleted);
 const estimatedSeconds=recent.length?Math.max(1,Math.ceil(recent.reduce((sum,attempt)=>sum+attempt.durationMs,0)/recent.length*Math.ceil(remaining/Math.max(1,report.concurrency??1))/1000)):null;
 const uncertain=revision.pipelineVersion===2&&(report.excerpts?.some(excerpt=>excerpt.outcomeUncertain)||/provider outcome is uncertain/i.test(report.error??''));
 const restartRequired=!!uncertain||revision.stale||/start a new (?:revision|pass|editorial pass)/i.test(report.error??'');
 const canResume=['failed','interrupted'].includes(status)&&!restartRequired;
 const complete=status==='completed'&&!failed;
 const details=<>

   <p className="reprocessing-hint">{uiText(workflowProgress?"Workflow progress includes each processing stage. Each stage has an equal share of the bar; progress reflects completed work, not elapsed time. Excerpt coverage is shown separately.":"Excerpt coverage measures completed text, not the percentage of the whole workflow. Document synthesis and consistency checks can continue after excerpts complete.")}</p>
   {stage&&<div className="reprocessing-document-stage" data-reprocessing-stage={stage}><strong>{stageTitle}</strong>{report.stageProgress&&<span>{report.stageProgress.completed} / {report.stageProgress.total} {uiText(stage==='understanding'?"document summaries processed":"items processed in this stage")}</span>}</div>}
   {revision.pipelineVersion===2&&revision.configuration&&<p className="reprocessing-stage-summary">{uiText(depthLabels[revision.configuration.depth])} · {uiText(revision.configuration.reviewPolicy==='verified'?'Verified changes only':'Review everything')} · {uiText(depthPasses[revision.configuration.depth])}</p>}
   {active(status)&&<p className="reprocessing-hint">{Number.isFinite(sessionStarted)?uiText("Elapsed: {value0}",{value0:elapsed(Math.max(0,Math.floor((now-sessionStarted)/1000)))})+' · ':''}{preparingEvidence?uiText("Local OCR is preparing evidence before AI processing begins. First-time model initialization can take several minutes. Excerpts wait until all source evidence is ready."):status==='queued'?uiText("Waiting to start"):estimatedSeconds!==null&&remaining>0?uiText("Est. excerpt time remaining: ~{value0}. Document-level checks may take longer.",{value0:elapsed(estimatedSeconds)}):remaining===0?uiText("Finishing document-level checks…"):uiText(revision.pipelineVersion===2?"Time estimate available after a completed excerpt in this revision.":"Time estimate available after a successful excerpt in this session.")} {uiText("Progress updates when each model request finishes. A request can take several minutes.")}</p>}
   {active(status)&&runningExcerpts.length>0&&<ul className="reprocessing-active-excerpts" aria-label={uiText("Active excerpts")}>{runningExcerpts.map(excerpt=><li key={excerpt.index}>{uiText("Excerpt {value0}",{value0:excerpt.index+1})}{excerpt.activePass?' · '+passLabel(excerpt):''}</li>)}</ul>}
    {report.coverage&&report.coverage.incompleteChunkIndexes.length>0&&<p className="reprocessing-warning" data-reprocessing-coverage="incomplete">{uiText("Document understanding has incomplete first-pass coverage")}: {report.coverage.firstPassCompleted} / {report.coverage.totalChunks}. {uiText("Unfinished excerpts remain visible for recovery and review.")}</p>}
    {report.evidencePreparation&&<ProgressNotice id={`reprocessing-evidence-${revision.id}`} compact title={uiText(report.evidencePreparation.state==='collecting'?"Preparing original-source evidence locally":"Original-source evidence prepared")+': '} state={report.evidencePreparation.state==='collecting'?'running':'completed'} detail={`${report.evidencePreparation.preparedChunks} / ${report.evidencePreparation.totalChunks}`} value={report.evidencePreparation.preparedChunks} max={Math.max(1,report.evidencePreparation.totalChunks)}/>}
    {report.summaryValidation&&<div className="reprocessing-summary-validation" role="status"><strong>{uiText(report.summaryValidation.state==='reviewing'?'Checking summary quotations':'Summary quotation corrections')}</strong><p>{report.summaryValidation.issues} {uiText('quotation differences')} · {report.summaryValidation.accepted} {uiText('resolved')} · {report.summaryValidation.unresolved} {uiText('excluded from summary context')}</p><p>{uiText('Resolved quotation corrections do not block processing. Unresolved observations are excluded from summary context so verification can continue.')}</p>{report.summaryValidation.contextPreserved&&<p>{uiText('The earlier verification context is preserved. These review explanations are retained without repeating completed work.')}</p>}{report.summaryValidation.diagnostics.length>0&&<details><DisclosureSummary>{uiText('Correction details')}</DisclosureSummary><ul>{report.summaryValidation.diagnostics.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}</div>}


   {children}
 </>;
 const monitor=<section className="reprocessing-monitor" aria-label={uiText("Processing status")}>
  {!complete&&<div className="reprocessing-monitor-main">
   <div className="reprocessing-progress"><p className="reprocessing-monitor-context">{uiText("Revision")} · {new Date(revision.createdAt).toLocaleString(getLocale())}</p>
    <ProgressNotice id={`reprocessing-progress-${revision.id}`} compact title={title} state={failed?'interrupted':status} detail={<>{workflowProgress&&report.stageProgress&&!preparingEvidence&&<>{report.stageProgress.completed} / {report.stageProgress.total} {uiText(stage==='understanding'?"document summaries processed":"items processed in this stage")} · </>}{uiText("{value0} of {value1} excerpts completed",{value0:report.chunksCompleted,value1:report.chunksTotal})}</>} value={progressValue} max={workflowProgress?100:Math.max(1,report.chunksTotal)} progressLabel={uiText(workflowProgress?"Overall revision progress":"Completed excerpt coverage")}/>
    {active(status)&&<p className="reprocessing-monitor-activity">{runningExcerpts.length>0?<>{uiText("Checking excerpt {value0}",{value0:runningExcerpts[0].index+1})}{runningExcerpts[0].activePass?' · '+passLabel(runningExcerpts[0]):''}{runningExcerpts.length>1?' · '+uiText("{value0} active excerpts",{value0:runningExcerpts.length}):''} · </>:null}{updateSeconds!==null?uiText("Last update {value0} ago",{value0:elapsed(updateSeconds)}):uiText("Waiting for an update")}</p>}
   </div>
   <div className="reprocessing-actions">{active(status)?<button type="button" className="button small" disabled={busy} onClick={onStop}>{uiText("Stop and keep progress")}</button>:canResume?<button type="button" className="button primary small" disabled={busy||running} onClick={onResume}>{uiText(incompleteResponse(revision)?"Retry unfinished work":configurationFailure(revision)?"Retry after configuration repair":report.excerpts?.some(excerpt=>excerpt.status==='failed')?"Retry failed and remaining excerpts":"Resume remaining excerpts")}</button>:restartRequired?<button type="button" className="button small" disabled={busy||running} onClick={onRefine}>{uiText("Start a new revision")}</button>:revision.patches.length>0?<button type="button" className="button small" onClick={onReview}>{uiText("Review changes")}</button>:null}</div>
  </div>}
  {complete?<div className="reprocessing-monitor-details">{details}</div>:<details className="reprocessing-monitor-details"><DisclosureSummary>{uiText("Processing details")}</DisclosureSummary>{details}</details>}
    {report.error&&<InlineNotice id={`reprocessing-error-${revision.id}`} tone={failed?'warning':'error'} title={uiText("Processing stopped")} description={(!restartRequired&&report.error.startsWith('OpenAI returned an incomplete response.')?uiText('The AI provider returned an incomplete response. Retry unfinished work with a larger response budget.'):report.error)+' '+(restartRequired?uiText("Completed excerpts and review decisions are retained. Start a new revision explicitly to process the source again; additional AI requests may incur charges."):configurationFailure(revision)?uiText("Check the model, supported reasoning and provider access in Settings → Intelligence before retrying. Completed suggestions remain available for review."):uiText(revision.pipelineVersion===2?"Completed excerpts and review decisions are retained. Retry unfinished work to recover incomplete responses; additional AI requests may incur charges.":"Completed excerpts and review decisions are retained. Resuming processes only unfinished excerpts."))}/>}
    {report.excerpts?.some(excerpt=>excerpt.outcomeUncertain)&&<InlineNotice id={`reprocessing-uncertain-${revision.id}`} tone="warning" variant="compact" title={uiText(revision.pipelineVersion===2?'The provider may have processed an unfinished request. It was not retried automatically. This revision cannot resume an uncertain request. Start a new revision explicitly if you want to process the source again; another charge may apply.':'The provider may have processed an unfinished request. It was not retried automatically. Resuming may send that excerpt again and incur another charge.')}/>}
    {failed&&<p>{uiText("Coverage is incomplete. This reading version contains only accepted changes from completed excerpts.")}</p>}
 </section>;
 return complete?<div className="reprocessing-completed-details">
  <button type="button" className="reprocessing-quiet-action" onClick={()=>setDetailsOpen(true)}>{uiText('Processing details')}</button>
  {detailsOpen&&<Modal titleId={detailsTitleId} onClose={()=>setDetailsOpen(false)} className="reprocessing-details-modal" dismissOnBackdrop><ModalHeader titleId={detailsTitleId}>{uiText('Processing details')}</ModalHeader>{monitor}</Modal>}
 </div>:monitor;
}
