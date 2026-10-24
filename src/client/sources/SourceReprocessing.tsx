import {editorialDraft,saveEditorialDraft,clearEditorialDraft} from '../review/editorial-drafts';
import {useContext} from 'react';
import {ReviewDestination} from '../review/review-destination';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {useEffect,useRef,useState} from 'react';
import type {SourceEditorialPatch,SourceEditorialAttempt,SourceReprocessingRevision,SourceReprocessingSummary,SourceProcessingDepth,SourceReviewPolicy,SourceReprocessingConfiguration} from '../../shared/source-reprocessing';
import {request} from '../api';
import {sourceDocumentEntries} from '../../shared/source-document';
import {intelligenceModels,supportedIntelligencePreferences,type IntelligencePreferences} from '../../shared/intelligence';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {SourcePatchComparison,type ComparisonLayout} from './SourcePatchComparison';
import {InlineNotice,ProgressNotice} from '../notifications';
import './source-reprocessing.css';

type Props={sourceId?:string;canonicalVersion?:string;vaultId:string;fileId:string;visible:boolean;onShow:()=>void;onOriginal:(nodeId?:string,focus?:boolean)=>void;onCompare?:(page:number)=>void;onReadingRevision?:(revision:SourceReprocessingRevision|null)=>void;onReviewOpenChange?:(open:boolean)=>void};
const active=(status:string)=>status==='queued'||status==='running';
const label=(value:string)=>value.replaceAll('_',' ');
const depthLabels={light:'Light Cleanup',balanced:'Balanced Reconstruction',deep:'Deep Restoration'};
const depthPasses={light:'1 model request per excerpt',balanced:'Exactly 2 model requests per excerpt, plus document synthesis',deep:'2–3 model requests per excerpt, plus document synthesis; a third requires a recorded difficulty'};
const excerptLabel=(status:string)=>({pending:'Not started',running:'Processing',completed:'Completed',failed:'Failed',interrupted:'Interrupted'}[status]??label(status));
type EvidenceCapabilities={originalPages:boolean;ocr:boolean;externalImages:boolean;reason:string};
function validEvidenceCapabilities(value:unknown):value is EvidenceCapabilities {
 if(!value||typeof value!=='object')return false;
 const result=value as Record<string,unknown>;return ['originalPages','ocr','externalImages'].every(key=>typeof result[key]==='boolean')&&typeof result.reason==='string';
}
function EvidenceOptions({capabilities,error,options,onChange,disabled}:{capabilities:EvidenceCapabilities|null;error:string;options:SourceReprocessingConfiguration['evidence'];onChange:(options:SourceReprocessingConfiguration['evidence'])=>void;disabled:boolean}){
 const imagesAvailable=!!capabilities?.originalPages&&!!capabilities.externalImages;
 const choose=(key:'ocr'|'originalPages',checked:boolean)=>onChange({...options,[key]:checked,allowExternalTransmission:false});
 return <fieldset className="reprocessing-evidence-options" disabled={disabled}><legend>{uiText("Original-source evidence")}</legend>
  {!capabilities&&!error&&<p role="status">{uiText("Checking evidence capabilities…")}</p>}
  {error&&<p role="status">{error}</p>}
  <label><input type="checkbox" aria-label={uiText("Use local OCR evidence")} checked={options.ocr} disabled={!capabilities?.ocr} onChange={event=>choose('ocr',event.target.checked)}/>{uiText("Use local OCR evidence")}</label>
  <p>{uiText("Reprocessing uses the existing extracted text. Optional local OCR reads the page images again to cross-check extraction errors and can add several minutes before AI processing. Without transmission consent, its text stays local.")}</p>
  <label><input type="checkbox" aria-label={uiText("Compare original-page images with the model")} checked={options.originalPages} disabled={!imagesAvailable} onChange={event=>choose('originalPages',event.target.checked)}/>{uiText("Compare original-page images with the model")}</label>
  {capabilities&&!imagesAvailable&&<p>{uiText(capabilities.originalPages?'The selected model does not support original-page images.':'Original-page images are unavailable for this source on this device.')}</p>}
  {capabilities&&!capabilities.ocr&&<p>{uiText("Local OCR is unavailable for this source on this device.")}</p>}
  {!!capabilities?.reason&&<p>{capabilities.reason}</p>}
  {(options.ocr||options.originalPages)&&<><label><input type="checkbox" aria-label={uiText("Allow selected source evidence to be sent to the AI provider")} checked={options.allowExternalTransmission} onChange={event=>onChange({...options,allowExternalTransmission:event.target.checked})}/>{uiText("Allow selected source evidence to be sent to the AI provider")}</label><p>{uiText("This sends selected original-page images and/or OCR text to your configured AI provider and may increase provider charges. Consent applies to this run.")}</p></>}
  {options.originalPages&&!options.allowExternalTransmission&&<InlineNotice tone="warning" variant="compact" title={uiText("Original-page model comparison requires transmission consent before starting.")}/>}
 </fieldset>;
}
function exportJSON(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function PatchReview({draftKey,patch,disabled,layout,onCompare,onDecision}:{draftKey:string;patch:SourceEditorialPatch;layout:ComparisonLayout;disabled:boolean;onCompare?:(page:number)=>void;onDecision:(patch:SourceEditorialPatch,decision:'accepted'|'rejected'|'pending',replacement?:string)=>Promise<void>}){
  const baseline=JSON.stringify([patch.original,patch.userReplacement??patch.replacement,patch.decision]);
  const restored=editorialDraft(draftKey,baseline);
  const [editing,setEditing]=useState(restored!==undefined),[replacement,setReplacement]=useState(restored??patch.userReplacement??patch.replacement);
  useEffect(()=>{if(editing)saveEditorialDraft(draftKey,baseline,replacement);},[draftKey,baseline,editing,replacement]);
  const changeTypes={ocr:'OCR correction',line_breaks:'Line breaks',footnote:'Footnote',apparatus:'Page apparatus',metadata:'Metadata',citation:'Citation',math:'Math',formatting:'Formatting'};
  const hasRisks=!!patch.riskReasons?.length;
  useEffect(()=>{if(!editing)setReplacement(patch.userReplacement??patch.replacement);},[patch.userReplacement,patch.replacement,editing]);
  return <article className="reprocessing-patch">
    <h3 className="reprocessing-patch-heading"><span className="reprocessing-change-type">{changeTypes[patch.category]}</span><span className="reprocessing-decision">{patch.decision==='pending'?uiText("Pending review"):patch.decision==='accepted'?uiText("Accepted"):uiText("Rejected · original kept")}</span>{patch.patchGroupId&&<span className="reprocessing-risk-badge">{uiText("Linked scholarly changes")}</span>}{hasRisks&&<span className="reprocessing-risk-badge">{uiText("Review carefully")}</span>}</h3>
    <div className="reprocessing-patch-location"><span>{uiText("Original") + " "}{patch.range.startPage?uiText("page {value0}{value1} · ",{value0: patch.range.startPage,value1: patch.range.endPage&&patch.range.endPage!==patch.range.startPage?`–${patch.range.endPage}`:''}):''}{uiText("lines") + " "}{patch.range.startLine}–{patch.range.endLine}</span>
    </div>
    <SourcePatchComparison original={patch.original} replacement={editing?replacement:patch.userReplacement??patch.replacement} layout={layout}/>
    {editing&&<label className="reprocessing-edit">{uiText("Edit suggested replacement")}<textarea aria-label={uiText("Edit suggested replacement")} disabled={disabled} value={replacement} onChange={e=>setReplacement(e.target.value)}/></label>}
    <details className="reprocessing-patch-explanation"><DisclosureSummary>{uiText("Details")}</DisclosureSummary>
      {hasRisks&&<div className="reprocessing-patch-risks"><strong>{uiText("Review carefully")}</strong><ul>{patch.riskReasons!.map(reason=><li key={reason}>{reason}</li>)}</ul></div>}
      {onCompare&&patch.range.startPage&&<button type="button" className="reprocessing-quiet-action" onClick={()=>onCompare(patch.range.startPage!)}>{uiText("Compare PDF page") + " "}{patch.range.startPage}</button>}
      <p>{patch.reason}</p>
      {patch.autoAcceptance&&<><strong>{uiText("Acceptance evidence")}</strong><p>{patch.autoAcceptance.validator} · {patch.autoAcceptance.policy} · {new Date(patch.autoAcceptance.appliedAt).toLocaleString(getLocale())}</p><ul>{patch.autoAcceptance.checks.map(check=><li key={check}>{check}</li>)}</ul></>}
      {!!patch.decisionHistory?.length&&<details><DisclosureSummary>{uiText("Decision history")}</DisclosureSummary><ol>{patch.decisionHistory.map((entry,index)=><li key={index}>{new Date(entry.at).toLocaleString(getLocale())} · {entry.actor} · {entry.from} → {entry.to}{entry.previousReplacement!==undefined&&<pre>{entry.previousReplacement}</pre>}</li>)}</ol></details>}
      <small className="reprocessing-confidence">{uiText("AI confidence:") + " "}{Math.round(patch.confidence*100)}%</small>
    </details>
    <div className="reprocessing-patch-footer">
      <div className="reprocessing-actions"><button type="button" className="button primary small" disabled={disabled} onClick={()=>void onDecision(patch,'accepted',editing?replacement:undefined)}>{editing?uiText("Accept edited change"):uiText("Accept change")}</button><button type="button" className="button small" disabled={disabled} onClick={()=>void onDecision(patch,'rejected')}>{uiText(patch.decision==='accepted'?"Reverse applied change":"Keep original")}</button><button type="button" className="reprocessing-quiet-action" disabled={disabled} onClick={()=>{if(editing)clearEditorialDraft(draftKey);setEditing(value=>!value);}}>{editing?uiText("Cancel edit"):uiText("Edit")}</button>{patch.decision!=='pending'&&<button type="button" className="reprocessing-quiet-action" disabled={disabled} onClick={()=>void onDecision(patch,'pending')}>{uiText("Return to review")}</button>}</div>
    </div>
  </article>;
}
function exportVariant(revision:SourceReprocessingRevision,variant:'original'|'reprocessed'){
  exportJSON({schemaVersion:1,revisionId:revision.id,fileId:revision.fileId,baseHash:revision.baseHash,variant,canonical:variant==='original',createdAt:revision.createdAt,updatedAt:revision.updatedAt,provenance:{original:`source-original-${revision.id}.json`,reprocessed:`source-reprocessed-${revision.id}.json`,fullRevision:`source-revision-${revision.id}.json`,nodeLinks:revision.nodeLinks??[],patches:revision.patches},...revision[variant]},`source-${variant}-${revision.id}.json`);
}
const partial=(revision:Pick<SourceReprocessingRevision,'status'|'report'>)=>!active(revision.status)&&revision.report.chunksCompleted<revision.report.chunksTotal;
const configurationFailure=(revision:SourceReprocessingRevision)=>/config|unsupported|provider_http_(?:40[0134]|422)/.test(revision.report.errorCode??'');
function ReprocessingProgress({revision}:{revision:SourceReprocessingRevision}){
  const {report,status}=revision;
  const preparingEvidence=status==='running'&&report.evidencePreparation?.state==='collecting';
  const sessionStarted=report.sessionStartedAt?Date.parse(report.sessionStartedAt):NaN;
  const recent=(report.excerpts??[]).filter(excerpt=>excerpt.status==='completed').flatMap(excerpt=>excerpt.history??[]).filter(attempt=>!attempt.errorCode&&attempt.durationMs>0&&Date.parse(attempt.startedAt)>=sessionStarted).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)).slice(0,5);
  const remaining=report.chunksTotal-report.chunksCompleted;
  const seconds=recent.length?Math.max(1,Math.ceil(recent.reduce((sum,attempt)=>sum+attempt.durationMs,0)/recent.length*Math.ceil(remaining/Math.max(1,report.concurrency??1))/1000)):null;
  const duration=seconds===null?'':seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;
  const estimate=status==='queued'?uiText("Waiting to start"):remaining<=0?uiText("Finishing up…"):seconds===null?uiText("Time estimate available after a successful excerpt in this session."):uiText("Est. time remaining: ~{value0}",{value0:duration});
  const failed=partial(revision);
  const stageLabels={reconstructing:'Reconstructing',understanding:'Understanding document',verifying:'Verifying',auditing:'Checking document consistency'};
  const stage=revision.pipelineVersion===2?report.stage:undefined;
  // Progress remains feature-owned: this adapter changes presentation only.
  return <div className="reprocessing-progress">
    <ProgressNotice id={`reprocessing-progress-${revision.id}`} title={status==='queued'?uiText("Queued for reprocessing"):preparingEvidence?uiText("Preparing original-source evidence locally"):status==='running'?uiText("Reprocessing source…"):failed?uiText("Partial revision"):status==='failed'?uiText("Processing failed"):status==='interrupted'?uiText("Processing interrupted"):uiText("Processing complete")}
      state={failed?'interrupted':status} detail={`${report.chunksCompleted} / ${report.chunksTotal} ${uiText("excerpts completed")}`}
      value={report.chunksCompleted} max={Math.max(1,report.chunksTotal)} progressLabel={uiText("Reprocessing progress")}/>
    {revision.pipelineVersion===2&&revision.configuration&&<p className="reprocessing-stage-summary">{uiText(depthLabels[revision.configuration.depth])} · {uiText(revision.configuration.reviewPolicy==='verified'?'Verified changes only':'Review everything')} · {uiText(depthPasses[revision.configuration.depth])}</p>}
    {stage&&<div className="reprocessing-document-stage" data-reprocessing-stage={stage} role="status"><strong>{uiText(stageLabels[stage])}</strong>{report.stageProgress&&<span>{report.stageProgress.completed} / {report.stageProgress.total}</span>}</div>}
    {report.coverage&&report.coverage.incompleteChunkIndexes.length>0&&<p className="reprocessing-warning" data-reprocessing-coverage="incomplete">{uiText("Document understanding has incomplete first-pass coverage")}: {report.coverage.firstPassCompleted} / {report.coverage.totalChunks}. {uiText("Unfinished excerpts remain visible for recovery and review.")}</p>}
    {report.evidencePreparation&&<ProgressNotice id={`reprocessing-evidence-${revision.id}`} compact title={uiText(report.evidencePreparation.state==='collecting'?"Preparing original-source evidence locally":"Original-source evidence prepared")+': '} state={report.evidencePreparation.state==='collecting'?'running':'completed'} detail={`${report.evidencePreparation.preparedChunks} / ${report.evidencePreparation.totalChunks}`} value={report.evidencePreparation.preparedChunks} max={Math.max(1,report.evidencePreparation.totalChunks)}/>}
    {report.summaryValidation&&<div className="reprocessing-summary-validation" role="status"><strong>{uiText(report.summaryValidation.state==='reviewing'?'Reviewing summary quotation mismatches with AI':'Summary quotation review')}</strong><p>{report.summaryValidation.issues} {uiText('flagged')} · {report.summaryValidation.accepted} {uiText('corrected and source-validated')} · {report.summaryValidation.unresolved} {uiText('unresolved')}</p><p>{uiText('Summary corrections provide context only. Source edits still require their own validation and review.')}</p>{report.summaryValidation.contextPreserved&&<p>{uiText('The earlier verification context is preserved. These review explanations are retained without repeating completed work.')}</p>}{report.summaryValidation.diagnostics.length>0&&<details><DisclosureSummary>{uiText('Summary review explanations')}</DisclosureSummary><ul>{report.summaryValidation.diagnostics.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}</div>}
    {active(status)&&<small>{preparingEvidence?uiText("Local OCR is preparing evidence before AI processing begins. First-time model initialization can take several minutes. Excerpts wait until all source evidence is ready."):estimate}</small>}
    {report.error&&<InlineNotice id={`reprocessing-error-${revision.id}`} tone={failed?'warning':'error'} title={uiText("Processing stopped")} description={report.error+' '+(configurationFailure(revision)?uiText("Check the model, supported reasoning and provider access in Settings → Intelligence before retrying. Completed suggestions remain available for review."):uiText("Completed excerpts and review decisions are retained. Resuming processes only unfinished excerpts."))}/>}
    {report.excerpts?.some(excerpt=>excerpt.outcomeUncertain)&&<InlineNotice id={`reprocessing-uncertain-${revision.id}`} tone="warning" variant="compact" title={uiText(revision.pipelineVersion===2?'The provider may have processed an unfinished request. It was not retried automatically. This revision cannot resume an uncertain request. Start a new revision explicitly if you want to process the source again; another charge may apply.':'The provider may have processed an unfinished request. It was not retried automatically. Resuming may send that excerpt again and incur another charge.')}/>}
    {failed&&<p>{uiText("Coverage is incomplete. This reading version contains only accepted changes from completed excerpts.")}</p>}
  </div>;
}
function ExcerptConfiguration({history}:{history?:SourceEditorialAttempt[]}){
  const attempt=history?.at(-1);
  if(!attempt?.model||!attempt.reasoningEffort)return null;
  const model=intelligenceModels.find(model=>model.id===attempt.model)?.label??attempt.model;
  return <span>{uiText("Last attempt:")} {model} · {attempt.reasoningEffort} {uiText("reasoning")}</span>;
}
function ExcerptLedger({revision}:{revision:SourceReprocessingRevision}){
  const {report}=revision,completed=new Set(report.completedChunkIndexes??Array.from({length:report.chunksCompleted},(_,index)=>index));
  const excerpts=report.excerpts??Array.from({length:report.chunksTotal},(_,index)=>({index,status:completed.has(index)?'completed':'pending',attempts:revision.pipelineVersion===2?0:null,startPage:null,endPage:null,error:undefined,errorCode:undefined,history:undefined,durationMs:0}));
  return <details className="reprocessing-ledger" open={partial(revision)||undefined}><DisclosureSummary>{uiText("Excerpt coverage")} · {report.chunksCompleted} / {report.chunksTotal}</DisclosureSummary><ol aria-label={uiText("Excerpt processing ledger")}>{excerpts.map(excerpt=><li key={excerpt.index} data-excerpt-status={excerpt.status}><div><strong>{uiText("Excerpt {value0}",{value0:excerpt.index+1})}</strong>{excerpt.startPage&&<span>{excerpt.endPage&&excerpt.endPage!==excerpt.startPage?uiText("Pages {value0}–{value1}",{value0:excerpt.startPage,value1:excerpt.endPage}):uiText("Page {value0}",{value0:excerpt.startPage})}</span>}<span>{uiText(excerptLabel(excerpt.status))}</span><span>{excerpt.attempts===null?uiText("Attempts unavailable (legacy revision)"):uiText("Attempts: {value0}",{value0:excerpt.attempts})}</span>{revision.pipelineVersion===2&&report.excerpts?.[excerpt.index]?.requiredPassCount&&<span className="reprocessing-pass-progress">{uiText("Model passes")}: {report.excerpts[excerpt.index].passesCompleted??0} / {report.excerpts[excerpt.index].requiredPassCount}{report.excerpts[excerpt.index].activePass?` · ${uiText(excerpt.status==='running'?"Running pass":"Stopped at pass")} ${report.excerpts[excerpt.index].activePass}`:''}</span>}{revision.pipelineVersion===2&&report.excerpts?.[excerpt.index]?.difficultyReason&&<span>{uiText("Difficulty")}: {report.excerpts[excerpt.index].difficultyReason}</span>}<ExcerptConfiguration history={excerpt.history}/>{excerpt.durationMs>0&&<span>{uiText("{value0} seconds",{value0:(excerpt.durationMs/1000).toFixed(1)})}</span>}</div>{excerpt.error&&<p>{excerpt.error}{excerpt.errorCode&&<small> · {excerpt.errorCode}</small>}</p>}</li>)}</ol></details>;
}
function Report({revision}:{revision:SourceReprocessingRevision}){
  const report=revision.report,excludedMessages=report.diagnostics.filter(message=>message.includes(': excluded from review — ')),excluded=excludedMessages.length,observations=report.diagnostics.filter(message=>!message.includes(': excluded from review — ')),processingErrors=(report.excerpts??[]).filter(excerpt=>excerpt.error),token=(n:number|null)=>n===null?'Unavailable':n.toLocaleString(getLocale());
  return <details className="reprocessing-report"><DisclosureSummary>{uiText("Processing report")}</DisclosureSummary>
    {report.usageIncomplete&&<InlineNotice id={`reprocessing-usage-${revision.id}`} tone="warning" variant="compact" announcement="off" title={uiText("Token totals are incomplete: some attempts did not report usage. Displayed counts include only reported usage.")}/>}
    <dl><dt>{uiText("Current session model / reasoning")}</dt><dd>{report.model||uiText("Not started")} / {report.reasoningEffort}</dd><dt>{uiText(revision.pipelineVersion===2?"Review policy":"Auto-accept threshold")}</dt><dd>{revision.pipelineVersion===2?uiText(revision.configuration?.reviewPolicy==='verified'?'Apply verified changes automatically':'Review everything'):revision.acceptanceMode==='review_all'||revision.acceptanceThreshold===undefined?uiText("Manual review for all edits"):`${Math.round(revision.acceptanceThreshold*100)}% · ${revision.acceptanceMode==='safe_formatting'?'eligible formatting only':revision.acceptanceMode==='balanced'?'Balanced':revision.acceptanceMode==='minimal_review'?'Minimal review':'legacy confidence policy'}`}</dd><dt>{uiText("Processing coverage")}</dt><dd>{report.chunksCompleted} / {report.chunksTotal}{" " + uiText("chunks ·") + " "}{report.charactersReviewed.toLocaleString(getLocale())} / {report.charactersTotal.toLocaleString(getLocale())}{" " + uiText("characters")}</dd><dt>{uiText("Input / output tokens")}</dt><dd>{token(report.inputTokens)} / {token(report.outputTokens)}</dd><dt>{uiText("Reasoning / cached input tokens")}</dt><dd>{token(report.reasoningTokens)} / {token(report.cachedInputTokens)}</dd><dt>{uiText("Duration")}</dt><dd>{report.durationMs===null?(revision.status==='queued'?uiText("Not started"):revision.status==='running'?uiText("In progress"):uiText("Unavailable")):uiText("{value0} seconds",{value0: (report.durationMs/1000).toFixed(1)})}</dd><dt>{uiText("Prompt version")}</dt><dd>{report.promptVersion}</dd><dt>{uiText("Created")}</dt><dd>{new Date(revision.createdAt).toLocaleString(getLocale())}</dd></dl>
    {revision.pipelineVersion===2&&<p>{uiText("Provider expenditure is tracked by the reported token totals above; currency cost is unavailable. Unreported usage may still be billable. Real-provider academic PDF quality evaluation has not been run.")}</p>}
    <p>{uiText("Coverage measures text sent for review. It does not certify transcription accuracy or completeness.")}</p>
    {revision.instructions&&<p><strong>{uiText("Your instructions:")}</strong> {revision.instructions}</p>}
    {excluded>0&&<InlineNotice id={`reprocessing-excluded-${revision.id}`} tone="warning" variant="compact" announcement="off" title={<>{excluded}{" " + uiText("AI") + " "}{excluded===1?uiText("suggestion was"):uiText("suggestions were")}{" " + uiText("excluded because they could not be safely matched or applied. Valid suggestions remain available for review. See excluded suggestions for the reasons.")}</>}/>}
    {(report.error||processingErrors.length>0)&&<details><DisclosureSummary>{uiText("Processing errors")}</DisclosureSummary>{report.error&&<p>{report.error}</p>}<ul>{processingErrors.map(excerpt=><li key={excerpt.index}>{uiText("Excerpt {value0}",{value0:excerpt.index+1})}: {excerpt.error} {excerpt.errorCode&&<code>{excerpt.errorCode}</code>}</li>)}</ul></details>}
    {excluded>0&&<details><DisclosureSummary>{uiText("Excluded suggestions")} ({excluded})</DisclosureSummary><ul>{excludedMessages.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}
    {observations.length>0&&<details><DisclosureSummary>{uiText("Editorial observations")}</DisclosureSummary><ul>{observations.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}
    {!!report.validationDiagnostics?.length&&<details><DisclosureSummary>{uiText("Local checks (")}{report.validationDiagnostics.length})</DisclosureSummary><ul>{report.validationDiagnostics.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}
    <details><DisclosureSummary>{uiText("Page structure and source metadata")}</DisclosureSummary><pre>{JSON.stringify({source:revision.reprocessed.document.source,physical:revision.reprocessed.document.physical,processing:revision.reprocessed.document.processing},null,2)}</pre></details>
    <div className="reprocessing-actions"><button className="button small" onClick={()=>exportJSON(revision,`source-revision-${revision.id}.json`)}>{uiText("Export provenance + report")}</button><button className="button small" onClick={()=>exportVariant(revision,'original')}>{uiText("Original JSON")}</button><button className="button small" onClick={()=>exportVariant(revision,'reprocessed')}>{uiText("Reprocessed JSON")}</button></div>
  </details>;
}
export function SourceReprocessing({sourceId,vaultId,fileId,visible,onShow,onOriginal,onCompare,onReadingRevision,canonicalVersion,onReviewOpenChange}:Props){
  const destination=useContext(ReviewDestination);
  const reviewRun=destination?.category==='editorial'&&destination.fileId===fileId?destination.runId:undefined;
  useEffect(()=>{if(reviewRun){setRevisionId(reviewRun);setTab('review');}},[reviewRun]);
  const [summaries,setSummaries]=useState<SourceReprocessingSummary[]>([]),[revisionId,setRevisionId]=useState(''),[revision,setRevision]=useState<SourceReprocessingRevision|null>(null),[prompt,setPrompt]=useState(false),[instructions,setInstructions]=useState(''),[depth,setDepth]=useState<SourceProcessingDepth>('balanced'),[reviewPolicy,setReviewPolicy]=useState<SourceReviewPolicy>('verified'),[filter,setFilter]=useState<'all'|'pending'|'accepted'|'rejected'|'automatic'>('pending'),[comparisonLayout,setComparisonLayout]=useState<ComparisonLayout>('unified'),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0),[tab,setTab]=useState<'read'|'review'>('read');
  useEffect(()=>{onReviewOpenChange?.(visible&&tab==='review');return()=>onReviewOpenChange?.(false);},[visible,tab,onReviewOpenChange]);
  const reviewTrigger=useRef<HTMLButtonElement>(null);
  function closeReview(){setTab('read');reviewTrigger.current?.focus({preventScroll:true});}
  const [activePatchId,setActivePatchId]=useState(''),[bulk,setBulk]=useState(false),[reviewLimit,setReviewLimit]=useState(20);
  const mounted=useRef(true),latestRevisionId=useRef(revisionId);latestRevisionId.current=revisionId;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setReviewLimit(20);setSelected([]);},[revisionId]);
  useEffect(()=>{
    function openPatch(event:Event){const detail=(event as CustomEvent<{fileId:string;revisionId?:string;patchId:string}>).detail;if(detail?.fileId!==fileId)return;if(detail.revisionId)setRevisionId(detail.revisionId);setActivePatchId(detail.patchId);setFilter('all');setTab('review');onShow();}
    window.addEventListener('noema:review-source-patch',openPatch);return()=>window.removeEventListener('noema:review-source-patch',openPatch);
  },[fileId,onShow]);
  const readingKey=`noema:source-reading:${vaultId}:${fileId}`;
  const [currentReadingId,setCurrentReadingId]=useState(()=>{try{return localStorage.getItem(readingKey)??'';}catch{return '';}}),[readingChoice,setReadingChoice]=useState('current');
  const requestedReadingId=readingChoice==='original'?'':readingChoice==='current'?currentReadingId:readingChoice;
  const readingCallback=useRef(onReadingRevision);readingCallback.current=onReadingRevision;
  const readingRequest=useRef(0);
  const eligible=(item:SourceReprocessingRevision|SourceReprocessingSummary)=>item.status==='completed'&&item.report.chunksCompleted>=item.report.chunksTotal&&!item.stale;
  useEffect(()=>{
    const requestId=++readingRequest.current;
    if(!requestedReadingId){readingCallback.current?.(null);return;}
    readingCallback.current?.(null);
    const controller=new AbortController();
    void request<SourceReprocessingRevision>(`source-files/${encodeURIComponent(fileId)}/reprocessing/${encodeURIComponent(requestedReadingId)}`,'GET',undefined,vaultId,controller.signal).then(value=>{
      if(controller.signal.aborted||readingRequest.current!==requestId)return;
      if(value.fileId===fileId&&eligible(value))readingCallback.current?.(value);
      else {readingCallback.current?.(null);setError('This revision is incomplete or no longer matches the canonical source. Original processed text is shown.');}
    }).catch(cause=>{if(!controller.signal.aborted&&readingRequest.current===requestId){readingCallback.current?.(null);setError(String(cause));}});
    return()=>controller.abort();
  },[fileId,vaultId,requestedReadingId,reload,canonicalVersion]);
  function chooseReading(value:string){
    setReadingChoice(value);
    if(value!=='current'&&value!=='original'){
      const item=revisionOptions.find(item=>item.id===value);if(!item||!eligible(item))return;
      setCurrentReadingId(value);try{localStorage.setItem(readingKey,value);}catch{/* Reading remains selected for this session. */}
    }
    if(value==='original')onOriginal();
  }
  const defaultTabRevision=useRef('');
  useEffect(()=>{if(!revision||defaultTabRevision.current===revision.id)return;defaultTabRevision.current=revision.id;if(reviewRun===revision.id)setTab('review');},[revision,reviewRun]);
  const [configuration,setConfiguration]=useState<IntelligencePreferences|null>(null),[configurationError,setConfigurationError]=useState('');
  useEffect(()=>{if(!prompt)return;const controller=new AbortController();setConfiguration(null);setConfigurationError('');void request<IntelligencePreferences>('intelligence','GET',undefined,undefined,controller.signal).then(value=>{if(!controller.signal.aborted){if(supportedIntelligencePreferences(value))setConfiguration(value);else setConfigurationError('Choose a supported model and reasoning in Settings → Intelligence.');}}).catch(()=>{if(!controller.signal.aborted)setConfigurationError('Could not load the AI configuration. Reopen this form to retry.');});return()=>controller.abort();},[prompt]);
  const actionRunning=useRef(false);
  function beginAction(){if(actionRunning.current)return false;actionRunning.current=true;setBusy(true);setError('');return true;}
  function finishAction(){actionRunning.current=false;if(mounted.current)setBusy(false);}
  useEffect(()=>setSelected([]),[revisionId]);
  const route=`source-files/${encodeURIComponent(fileId)}/reprocessing`;
  const [evidenceOptions,setEvidenceOptions]=useState<SourceReprocessingConfiguration['evidence']>({originalPages:false,ocr:false,allowExternalTransmission:false}),[evidenceCapabilities,setEvidenceCapabilities]=useState<EvidenceCapabilities|null>(null),[evidenceError,setEvidenceError]=useState('');
  useEffect(()=>{
    if(!prompt)return;const controller=new AbortController();setEvidenceOptions({originalPages:false,ocr:false,allowExternalTransmission:false});setEvidenceCapabilities(null);setEvidenceError('');
    void request<unknown>(`${route}/capabilities`,'GET',undefined,vaultId,controller.signal).then(value=>{if(controller.signal.aborted)return;if(validEvidenceCapabilities(value)){setEvidenceCapabilities(value);}else setEvidenceError('Evidence capabilities could not be checked. Extracted text remains available.');}).catch(()=>{if(!controller.signal.aborted)setEvidenceError('Evidence capabilities could not be checked. Extracted text remains available.');});return()=>controller.abort();
  },[prompt,route,vaultId]);

  useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function refresh(){try{const items=await request<SourceReprocessingSummary[]>(route,'GET',undefined,vaultId,controller.signal);if(controller.signal.aborted)return;setSummaries(items);setRevisionId(id=>id||items[0]?.id||'');if(items.some(item=>active(item.status)))timer=setTimeout(()=>void refresh(),2500);}catch(cause){if(!controller.signal.aborted)setError(String(cause));}}
    void refresh();return()=>{controller.abort();clearTimeout(timer);};
  },[route,vaultId,reload,canonicalVersion]);
  useEffect(()=>{setRevision(current=>current?.id===revisionId?current:null);if(!revisionId)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    let last:{status:string;chunksCompleted:number;updatedAt:string}|undefined;
    async function refresh(){try{
      if(last){
        const status=await request<{status:string;chunksCompleted:number;updatedAt:string}>(`${route}/${encodeURIComponent(revisionId)}/status`,'GET',undefined,vaultId,controller.signal);
        if(controller.signal.aborted)return;
        if(status.status===last.status&&status.chunksCompleted===last.chunksCompleted&&status.updatedAt===last.updatedAt){if(active(status.status))timer=setTimeout(()=>void refresh(),2500);return;}
      }
      const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revisionId)}`,'GET',undefined,vaultId,controller.signal);
      if(controller.signal.aborted)return;setRevision(value);last={status:value.status,chunksCompleted:value.report.chunksCompleted,updatedAt:value.updatedAt};
      if(active(value.status))timer=setTimeout(()=>void refresh(),2500);
    }catch(cause){if(!controller.signal.aborted)setError(String(cause));}}
    void refresh();return()=>{controller.abort();clearTimeout(timer);};
  },[route,vaultId,revisionId,reload,canonicalVersion]);
  const running=summaries.some(item=>active(item.status))||(revision!==null&&active(revision.status)),stale=revision?.stale,pending=revision?.patches.filter(p=>p.decision==='pending').length??0;
  const revisionOptions=revision&&!summaries.some(item=>item.id===revision.id)?[revision,...summaries]:summaries;
  async function start(){if(!configuration||!evidenceCapabilities&&!evidenceError||evidenceOptions.originalPages&&!evidenceOptions.allowExternalTransmission||!beginAction())return;try{const value=await request<SourceReprocessingRevision>(route,'POST',{instructions,pipelineVersion:2,configuration:{depth,reviewPolicy,evidence:evidenceOptions}},vaultId);if(!mounted.current)return;setRevisionId(value.id);setRevision(value);setPrompt(false);setReload(n=>n+1);onShow();}catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}}
  async function decide(patch:SourceEditorialPatch,decision:'accepted'|'rejected'|'pending',replacement?:string){if(!revision||!beginAction())return;try{const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revision.id)}/review`,'POST',{updatedAt:revision.updatedAt,decisions:revision.patches.filter(item=>item.id===patch.id||!!patch.patchGroupId&&item.patchGroupId===patch.patchGroupId).map(item=>({patchId:item.id,decision,...(item.id===patch.id&&replacement!==undefined?{replacement}:{})}))},vaultId);if(!mounted.current)return;if(latestRevisionId.current===value.id)setRevision(value);setSelected(ids=>ids.filter(id=>!revision.patches.some(item=>item.id===id&&(item.id===patch.id||!!patch.patchGroupId&&item.patchGroupId===patch.patchGroupId))));setReload(n=>n+1);}catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}}
  async function control(action:'cancel'|'resume'){
    if(!revision||!beginAction())return;
    try{const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revision.id)}/${action}`,'POST',{},vaultId);if(!mounted.current)return;if(latestRevisionId.current===value.id)setRevision(value);setReload(n=>n+1);}
    catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}
  }
  async function decideSelected(decision:'accepted'|'rejected'){
    if(!revision||!selected.length||!beginAction())return;
    try{const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revision.id)}/review`,'POST',{updatedAt:revision.updatedAt,decisions:revision.patches.filter(patch=>selected.includes(patch.id)||!!patch.patchGroupId&&revision.patches.some(item=>item.patchGroupId===patch.patchGroupId&&selected.includes(item.id))).map(patch=>({patchId:patch.id,decision}))},vaultId);if(!mounted.current)return;if(latestRevisionId.current===value.id)setRevision(value);setSelected([]);setReload(n=>n+1);}
    catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}
  }
  const automaticallyApplied=(patch:SourceEditorialPatch)=>patch.decision==='accepted'&&(patch.decisionHistory?.at(-1)?.actor??(patch.autoAcceptance?'automatic':'user'))==='automatic';
  const matches=(patch:SourceEditorialPatch,value:typeof filter)=>value==='all'||(value==='automatic'?automaticallyApplied(patch):value==='accepted'?patch.decision==='accepted'&&!automaticallyApplied(patch):patch.decision===value);
  const shownPatches=revision?.patches.filter(patch=>matches(patch,filter))??[];
  const visiblePatches=shownPatches.slice(0,reviewLimit),activePatch=shownPatches.find(patch=>patch.id===activePatchId)??shownPatches[0];
  const reviewFilters=['pending','automatic','accepted','rejected','all'] as const;
  const reviewLabels={pending:'Pending',automatic:'Automatically applied',accepted:'Applied manually',rejected:'Rejected',all:'All history'};
  const emptyReviewMessages={pending:'No pending changes to review.',automatic:'No automatically applied changes.',accepted:'No manually applied changes yet.',rejected:'No rejected changes. Rejected suggestions keep the original text.',all:'No editorial changes recorded.'};
  function locatePatch(patch:SourceEditorialPatch){
    setActivePatchId(patch.id);
    const candidates=revision?sourceDocumentEntries(revision.original.document).filter(({node})=>patch.nodeIds.includes(node.id)&&node.range.startOffset<patch.range.endOffset&&node.range.endOffset>patch.range.startOffset).sort((a,b)=>(a.node.range.endOffset-a.node.range.startOffset)-(b.node.range.endOffset-b.node.range.startOffset)):[];
    const nodeId=candidates[0]?.node.id;
    if(nodeId){setReadingChoice('original');onOriginal(nodeId,false);onShow();}
  }
  return <section className="source-reprocessing" aria-label={uiText("Beta source reprocessing")}>
    <div className="reprocessing-bar">
      <label className="reprocessing-reading-picker">{uiText("Reading version")} <select aria-label={uiText("Reading version")} value={readingChoice} onChange={event=>chooseReading(event.target.value)}>
        <option value="current">{uiText("Current reading")}</option><option value="original">{uiText("Original processed")}</option>
        {revisionOptions.filter(eligible).map(item=><option key={item.id} value={item.id}>{uiText("Editorial revision")} · {new Date(item.createdAt).toLocaleString(getLocale())}</option>)}
      </select></label>
      <button ref={reviewTrigger} type="button" className="reprocessing-quiet-action" aria-expanded={visible&&tab==='review'} aria-controls={`source-review-${fileId}`} onClick={()=>{setTab('review');onShow();}}>{uiText("Review changes (")}{pending})</button>
      <button type="button" className="button small reprocessing-loading-button" aria-busy={running} disabled={busy||running} onClick={()=>{setPrompt(true);onShow();}}>{running&&<span className="scan-spinner" aria-hidden="true"/>}{running?uiText("Reprocessing…"):uiText("Reprocess with AI")}</button>
    </div>
    {error&&<InlineNotice id={`reprocessing-operation-error-${fileId}`} tone="error" title={error} announcement="assertive" actions={<button type="button" className="button" onClick={()=>{setError('');setReload(n=>n+1);}}>{uiText("Refresh")}</button>}/>}
    {visible&&<><p className="reprocessing-hint">{uiText("An editorial reading version. Original processed Markdown remains canonical for citations. Verified review requires independent source evidence. Missing evidence remains for review. Wording, quotations, numbers, citations, deletions and uncertain mappings require review.")}</p>
      {prompt&&<form className="reprocessing-prompt" onSubmit={e=>{e.preventDefault();void start();}}><h3>{uiText("Re-edit this source") + " "}<span>{uiText("Beta")}</span></h3><p>{uiText("Review OCR, line breaks, footnotes, page apparatus, foreign-language citations, metadata and math while preserving source meaning and page provenance.")}</p><div className="reprocessing-configuration" role="status">{configuration?<><strong>{intelligenceModels.find(model=>model.id===configuration.model)?.label??configuration.model} · {configuration.reasoningEffort} {uiText("reasoning")}</strong><p>{uiText("Supported reasoning:")} {intelligenceModels.find(model=>model.id===configuration.model)?.efforts.join(', ')}</p></>:configurationError?<InlineNotice id={`reprocessing-configuration-error-${fileId}`} tone="error" variant="compact" title={configurationError} announcement="assertive"/>:uiText("Loading AI configuration…")}</div><label>{uiText("Processing depth")}<select aria-label={uiText("Processing depth")} value={depth} onChange={event=>setDepth(event.target.value as SourceProcessingDepth)}>{(['light','balanced','deep'] as const).map(value=><option key={value} value={value}>{uiText(depthLabels[value])}</option>)}</select></label><p className="reprocessing-depth-detail">{uiText(depthPasses[depth])}. {uiText("Each pass is a separate model request. Balanced and Deep cost at least two requests per excerpt, even when no changes are proposed.")}</p><label>{uiText("Review policy")}<select aria-label={uiText("Review policy")} value={reviewPolicy} onChange={event=>setReviewPolicy(event.target.value as SourceReviewPolicy)}><option value="verified">{uiText("Apply verified changes automatically")}</option><option value="review_all">{uiText("Review everything")}</option></select></label><p>{uiText("Uncertain wording, quotations, mathematics and bibliographic changes remain pending without verified source evidence. A second AI pass alone does not verify a change.")}</p><EvidenceOptions capabilities={evidenceCapabilities} error={evidenceError} options={evidenceOptions} onChange={setEvidenceOptions} disabled={busy}/><label>{uiText("Editorial guidance (optional)")}<textarea autoFocus value={instructions} maxLength={4000} onChange={e=>setInstructions(e.target.value)} placeholder={uiText("For example: preserve Greek quotations; check ambiguous footnote numbering carefully.")}/></label><div className="reprocessing-actions"><button className="button primary reprocessing-loading-button" aria-busy={busy} disabled={busy||running||!configuration||!evidenceCapabilities&&!evidenceError||evidenceOptions.originalPages&&!evidenceOptions.allowExternalTransmission} type="submit">{busy&&<span className="scan-spinner" aria-hidden="true"/>}{busy?uiText("Starting…"):uiText("Start reprocessing")}</button><button className="button" disabled={busy} type="button" onClick={()=>setPrompt(false)}>{uiText("Cancel")}</button></div></form>}
      {revisionOptions.length>0&&<label className="reprocessing-revision-picker">{uiText("Revision") + " "}<select disabled={busy} value={revisionId} onChange={e=>{setActivePatchId('');setRevisionId(e.target.value);}}>{revisionOptions.map(item=><option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString(getLocale())} · {uiText(partial(item)?"Partial revision":item.status)}</option>)}</select></label>}
      {!revision&&!prompt&&<p role="status">{revisionId?uiText("Loading revision…"):uiText("Create a beta revision to improve reading quality and review editorial suggestions.")}</p>}
      {revision&&revision.id===revisionId&&<>{stale&&<InlineNotice id={`reprocessing-stale-${revision.id}`} tone="warning" title={uiText("The canonical source has changed. This revision is preserved for comparison; start a new run before reviewing changes.")}/>}
        <ReprocessingProgress key={revision.id} revision={revision}/>
        {revision.report.metadata&&<section className="source-metadata-run-summary" aria-label="Metadata processing summary"><strong>Metadata</strong><p>{revision.report.metadata.added} added · {revision.report.metadata.corroborated} corroborated · {revision.report.metadata.requiresReview} require review</p><button type="button" className="button small" onClick={()=>window.dispatchEvent(new CustomEvent('noema:open-source-metadata',{detail:{vaultId,sourceId,fileId,runId:revision.id}}))}>Review metadata</button></section>}
        <details className="reprocessing-processing-details"><DisclosureSummary>{uiText("Processing details")}</DisclosureSummary><ExcerptLedger revision={revision}/><Report revision={revision}/></details>
        <p className="reprocessing-status" role="status">{uiText("Editorial decisions")} · {pending}{" " + uiText("pending ·") + " "}{revision.patches.filter(patch=>patch.decision==='accepted').length}{" " + uiText("accepted ·") + " "}{revision.patches.filter(patch=>patch.decision==='rejected').length}{" " + uiText("kept original")}</p>
        {active(revision.status)&&<><button type="button" className="button small" disabled={busy} onClick={()=>void control('cancel')}>{uiText("Stop and keep progress")}</button></>}
        {['failed','interrupted'].includes(revision.status)&&!stale&&!(revision.pipelineVersion===2&&revision.report.excerpts?.some(excerpt=>excerpt.outcomeUncertain))&&<button type="button" className="button small" disabled={busy||running} onClick={()=>void control('resume')}>{uiText(configurationFailure(revision)?"Retry after configuration repair":revision.report.excerpts?.some(excerpt=>excerpt.status==='failed')?"Retry failed and remaining excerpts":"Resume remaining excerpts")}</button>}
        {tab==='read'?<button type="button" className="reprocessing-quiet-action" onClick={()=>setTab('review')}>{uiText("Open corrections")}</button>:<aside id={`source-review-${fileId}`} className="reprocessing-reviews" aria-label={uiText("Review corrections")} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();closeReview();}}}>
          <button type="button" className="reprocessing-quiet-action" onClick={closeReview}>{uiText("Close corrections")}</button>
          <div className="reprocessing-tabs reprocessing-review-filters" role="group" aria-label={uiText("Review status")}>
            {reviewFilters.map(value=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>{setFilter(value);setActivePatchId('');setReviewLimit(20);setSelected([]);}}>{reviewLabels[value]} <span className="reprocessing-filter-count">{revision.patches.filter(patch=>matches(patch,value)).length}</span></button>)}
          </div>
          <div className="reprocessing-actions reprocessing-review-toolbar">
            <label className="reprocessing-layout-picker">{uiText("Comparison") + " "}<select aria-label={uiText("Comparison layout")} value={comparisonLayout} onChange={event=>setComparisonLayout(event.target.value as ComparisonLayout)}><option value="auto">{uiText("Auto (unified on narrow screens)")}</option><option value="split">{uiText("Side by side")}</option><option value="unified">{uiText("Unified")}</option></select></label>
            <button type="button" className="reprocessing-quiet-action" aria-pressed={bulk} onClick={()=>{setBulk(value=>!value);setSelected([]);}}>{uiText(bulk?"Exit bulk review":"Bulk review")}</button>
            {bulk&&<><button className="button small" disabled={!selected.length||busy||!!stale||active(revision.status)} onClick={()=>void decideSelected('accepted')}>{uiText("Accept selected (")}{selected.length})</button><button className="button small" disabled={!selected.length||busy||!!stale||active(revision.status)} onClick={()=>void decideSelected('rejected')}>{uiText("Keep original for selected")}</button></>}
          </div>
          {filter==='rejected'&&shownPatches.length>0&&<p className="reprocessing-hint">{uiText("These suggestions were rejected. The original text is kept in the reading version.")}</p>}
          {!shownPatches.length&&<p role="status">{emptyReviewMessages[filter]}</p>}
          <div className="reprocessing-master-detail">
            <ol className="reprocessing-patch-list" aria-label={uiText("Corrections")}>
              {visiblePatches.map((patch,index)=><li key={patch.id}>
                {bulk&&<label className="reprocessing-select"><input type="checkbox" aria-label={uiText("Select change {value0}",{value0:index+1})} checked={selected.includes(patch.id)} disabled={busy||!!stale||active(revision.status)} onChange={event=>setSelected(ids=>{const related=revision.patches.filter(item=>item.id===patch.id||!!patch.patchGroupId&&item.patchGroupId===patch.patchGroupId).map(item=>item.id);return event.target.checked?[...new Set([...ids,...related])]:ids.filter(id=>!related.includes(id));})}/></label>}
                <button type="button" aria-pressed={activePatch?.id===patch.id} onClick={()=>locatePatch(patch)} onKeyDown={event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?visiblePatches.length-1:Math.max(0,Math.min(visiblePatches.length-1,index+(event.key==='ArrowDown'?1:-1)));locatePatch(visiblePatches[target]);event.currentTarget.closest('ol')?.querySelectorAll<HTMLButtonElement>('li>button')[target]?.focus();}}>
                  <strong>{uiText(label(patch.category))}</strong><span>{patch.range.startPage?uiText("Page {value0}",{value0:patch.range.startPage}):uiText("Line {value0}",{value0:patch.range.startLine})}{patch.riskReasons?.length?' · '+uiText("Manual verification required"):''}</span><span>{patch.original.slice(0,100)}</span>
                </button>
              </li>)}
            </ol>
            {activePatch&&<PatchReview draftKey={JSON.stringify([vaultId,fileId,revision.id,activePatch.id])} key={`${revision.id}:${activePatch.id}`} patch={activePatch} layout={comparisonLayout} onCompare={onCompare} disabled={busy||!!stale||active(revision.status)} onDecision={decide}/>}
          </div>
          {shownPatches.length>reviewLimit&&<button type="button" className="button small" onClick={()=>setReviewLimit(limit=>limit+20)}>{uiText("Load more changes")}</button>}

        </aside>}
      </>}
    </>}
  </section>;
}
