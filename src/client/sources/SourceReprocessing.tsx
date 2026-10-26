import {sourceRevisionLabels} from './source-revision-labels';
import {SourceRevisionDiff} from './SourceRevisionDiff';
import {sourceEditorialRevisionLimit} from '../../shared/source-reprocessing';
import {SourceRevisionManager} from './SourceRevisionManager';
import {Select} from '../components/Select';
import {createPortal} from 'react-dom';
import {editorialDraft,saveEditorialDraft,clearEditorialDraft} from '../review/editorial-drafts';
import {useContext} from 'react';
import {ReviewDestination} from '../review/review-destination';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {SourceEditorialPatch,SourceEditorialAttempt,SourceReprocessingRevision,SourceReprocessingSummary,SourceProcessingDepth,SourceReviewPolicy,SourceReprocessingConfiguration} from '../../shared/source-reprocessing';
import {request} from '../api';
import {sourceDocumentEntries} from '../../shared/source-document';
import {intelligenceModels,supportedIntelligencePreferences,type IntelligencePreferences} from '../../shared/intelligence';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {SourcePatchComparison,type ComparisonLayout} from './SourcePatchComparison';
import {InlineNotice} from '../notifications';
import {SourceReprocessingSetup,type EvidenceCapabilities} from './SourceReprocessingSetup';
import {SourceReprocessingProgress} from './SourceReprocessingProgress';
import './source-reprocessing.css';

type Props={sourceId?:string;canonicalVersion?:string;vaultId:string;fileId:string;visible:boolean;onShow:()=>void;onOriginal:(nodeId?:string,focus?:boolean)=>void;onCompare?:(page:number)=>void;onReadingRevision?:(revision:SourceReprocessingRevision|null)=>void;reviewHost?:HTMLElement|null;onReviewRevision?:(revision:SourceReprocessingRevision|null)=>void;onReturnContext?:()=>void;onEvidenceSurfaceChange?:(open:boolean)=>void;onReviewOpenChange?:(open:boolean,presentation?:'diff'|'drawer')=>void};
const active=(status:string)=>status==='queued'||status==='running';
const label=(value:string)=>value.replaceAll('_',' ');
const excerptLabel=(status:string)=>({pending:'Not started',running:'Processing',completed:'Completed',failed:'Failed',interrupted:'Interrupted'}[status]??label(status));
function validEvidenceCapabilities(value:unknown):value is EvidenceCapabilities {
 if(!value||typeof value!=='object')return false;
 const result=value as Record<string,unknown>;return ['originalPages','ocr','externalImages'].every(key=>typeof result[key]==='boolean')&&typeof result.reason==='string';
}
function exportJSON(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const patchBaseline=(patch:SourceEditorialPatch)=>JSON.stringify([patch.original,patch.userReplacement??patch.replacement,patch.decision]);
function PatchReview({draftKey,draftKeyFor,patch,group,sourceText,disabled,layout,onCompare,onLocate,onChoose,onDecision}:{draftKey:string;draftKeyFor:(patch:SourceEditorialPatch)=>string;patch:SourceEditorialPatch;group:SourceEditorialPatch[];sourceText:string;layout:ComparisonLayout;disabled:boolean;onCompare?:(page:number)=>void;onLocate:()=>void;onChoose:(patch:SourceEditorialPatch)=>void;onDecision:(patch:SourceEditorialPatch,decision:'accepted'|'rejected'|'pending',replacement?:string)=>Promise<void>}){
  const baseline=patchBaseline(patch);
  const restored=editorialDraft(draftKey,baseline);
  const [editing,setEditing]=useState(restored!==undefined),[replacement,setReplacement]=useState(restored??patch.userReplacement??patch.replacement);
  useEffect(()=>{const draft=editorialDraft(draftKey,baseline);setEditing(draft!==undefined);setReplacement(draft??patch.userReplacement??patch.replacement);},[draftKey,baseline]);
  const changeTypes={ocr:'OCR correction',line_breaks:'Line breaks',footnote:'Footnote',apparatus:'Page apparatus',metadata:'Metadata',citation:'Citation',math:'Math',formatting:'Formatting'};
  const hasRisks=!!patch.riskReasons?.length;
  useEffect(()=>{if(!editing)setReplacement(patch.userReplacement??patch.replacement);},[patch.userReplacement,patch.replacement,editing]);
  const sorted=[...group].sort((a,b)=>a.range.startOffset-b.range.startOffset);
  const start=sorted[0]!.range.startOffset,end=sorted.at(-1)!.range.endOffset;
  let from=start,to=end;
  while(from>0&&start-from<180&&sourceText.slice(from-2,from)!=='\n\n')from--;
  while(to<sourceText.length&&to-end<180&&sourceText.slice(to,to+2)!=='\n\n')to++;
  const original=sourceText.slice(from,to);
  let proposed=original;
  for(const item of [...sorted].reverse())proposed=proposed.slice(0,item.range.startOffset-from)+(item.id===patch.id&&editing?replacement:editorialDraft(draftKeyFor(item),patchBaseline(item))??item.userReplacement??item.replacement)+proposed.slice(item.range.endOffset-from);
  return <article className="reprocessing-patch">
    <h3 className="reprocessing-patch-heading"><span className="reprocessing-change-type">{changeTypes[patch.category]}</span><span className="reprocessing-decision">{patch.decision==='pending'?uiText("Pending review"):patch.decision==='accepted'?uiText("Accepted"):uiText("Rejected · original kept")}</span>{patch.patchGroupId&&<span className="reprocessing-risk-badge">{uiText("Linked scholarly changes")}</span>}{hasRisks&&<span className="reprocessing-risk-badge">{uiText("Review carefully")}</span>}</h3>
    <div className="reprocessing-patch-location"><span>{uiText("Original") + " "}{patch.range.startPage?uiText("page {value0}{value1} · ",{value0: patch.range.startPage,value1: patch.range.endPage&&patch.range.endPage!==patch.range.startPage?`–${patch.range.endPage}`:''}):''}{uiText("lines") + " "}{patch.range.startLine}–{patch.range.endLine}</span>
    </div>
    <div className="reprocessing-actions">
      <button type="button" className="button small" onClick={onLocate}>{uiText("Show original passage")}</button>
      {onCompare&&patch.range.startPage&&<button type="button" className="button small" onClick={()=>onCompare(patch.range.startPage!)}>{uiText("Compare PDF page") + " "}{patch.range.startPage}</button>}
    </div>
    {group.length>1&&<div className="reprocessing-linked-group"><p>{uiText("These {value0} linked changes are reviewed together. The comparison includes every part and the original text between them.",{value0:group.length})}</p><label>{uiText("Part to edit")} <Select aria-label={uiText("Linked change to edit")} value={patch.id} onChange={event=>{const item=group.find(item=>item.id===event.target.value);if(item)onChoose(item);}}>{sorted.map((item,index)=><option key={item.id} value={item.id}>{index+1} · {uiText(label(item.category))} · {uiText("Line {value0}",{value0:item.range.startLine})}</option>)}</Select></label></div>}
    <SourcePatchComparison original={original} replacement={proposed} layout={layout}/>
    {editing&&<label className="reprocessing-edit">{uiText("Edit suggested replacement")}<textarea aria-label={uiText("Edit suggested replacement")} disabled={disabled} value={replacement} onChange={e=>{setReplacement(e.target.value);saveEditorialDraft(draftKey,baseline,e.target.value);}}/></label>}
    <p className="reprocessing-patch-reason">{patch.reason}</p>
    <details className="reprocessing-patch-explanation"><DisclosureSummary>{uiText("Details")}</DisclosureSummary>
      {hasRisks&&<div className="reprocessing-patch-risks"><strong>{uiText("Review carefully")}</strong><ul>{patch.riskReasons!.map(reason=><li key={reason}>{reason}</li>)}</ul></div>}
      {patch.autoAcceptance&&<><strong>{uiText("Acceptance evidence")}</strong><p>{patch.autoAcceptance.validator} · {patch.autoAcceptance.policy} · {new Date(patch.autoAcceptance.appliedAt).toLocaleString(getLocale())}</p><ul>{patch.autoAcceptance.checks.map(check=><li key={check}>{check}</li>)}</ul></>}
      {!!patch.decisionHistory?.length&&<details><DisclosureSummary>{uiText("Decision history")}</DisclosureSummary><ol>{patch.decisionHistory.map((entry,index)=><li key={index}>{new Date(entry.at).toLocaleString(getLocale())} · {entry.actor} · {entry.from} → {entry.to}{entry.previousReplacement!==undefined&&<pre>{entry.previousReplacement}</pre>}</li>)}</ol></details>}
      {patch.confidence>0&&<small className="reprocessing-confidence">{uiText("AI confidence:") + " "}{Math.round(patch.confidence*100)}%</small>}
    </details>
    <div className="reprocessing-patch-footer">
      <div className="reprocessing-actions"><button type="button" className="button primary small" disabled={disabled} onClick={()=>void onDecision(patch,'accepted',editing?replacement:undefined)}>{group.length>1?uiText(editing?"Accept edited group ({value0})":"Accept linked group ({value0})",{value0:group.length}):editing?uiText("Accept edited change"):uiText("Accept change")}</button><button type="button" className="button small" disabled={disabled} onClick={()=>void onDecision(patch,'rejected')}>{group.length>1?uiText("Keep originals for group ({value0})",{value0:group.length}):uiText(patch.decision==='accepted'?"Reverse applied change":"Keep original")}</button><button type="button" className="reprocessing-quiet-action" disabled={disabled} onClick={()=>{if(editing)clearEditorialDraft(draftKey);setEditing(value=>!value);}}>{editing?uiText("Cancel edit"):uiText("Edit")}</button>{patch.decision!=='pending'&&<button type="button" className="reprocessing-quiet-action" disabled={disabled} onClick={()=>void onDecision(patch,'pending')}>{uiText("Return to review")}</button>}</div>
    </div>
  </article>;
}
function exportVariant(revision:SourceReprocessingRevision,variant:'original'|'reprocessed'){
  exportJSON({schemaVersion:1,revisionId:revision.id,fileId:revision.fileId,baseHash:revision.baseHash,variant,canonical:variant==='original',createdAt:revision.createdAt,updatedAt:revision.updatedAt,provenance:{original:`source-original-${revision.id}.json`,reprocessed:`source-reprocessed-${revision.id}.json`,fullRevision:`source-revision-${revision.id}.json`,nodeLinks:revision.nodeLinks??[],patches:revision.patches},...revision[variant]},`source-${variant}-${revision.id}.json`);
}
const partial=(revision:Pick<SourceReprocessingRevision,'status'|'report'>)=>!active(revision.status)&&revision.report.chunksCompleted<revision.report.chunksTotal;
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
    {revision.pipelineVersion===2&&<p><strong>{uiText("Substantial math content")}:</strong> {uiText(revision.configuration?.substantialMath?"Enabled":"Disabled")}</p>}
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
type SavedSourceView={readingChoice:string;revisionId:string;tab:'read'|'review';reviewStyle:'diff'|'drawer'};
function savedSourceView(key:string):SavedSourceView|null {
  try {const value=JSON.parse(localStorage.getItem(key)??'null');return value&&typeof value.readingChoice==='string'&&typeof value.revisionId==='string'&&['read','review'].includes(value.tab)&&['diff','drawer'].includes(value.reviewStyle)?value:null;}catch{return null;}
}
export function SourceReprocessing({sourceId,vaultId,fileId,visible,onShow,onOriginal,onCompare,onReadingRevision,canonicalVersion,onReviewOpenChange,reviewHost,onReviewRevision,onReturnContext,onEvidenceSurfaceChange}:Props){
  const destination=useContext(ReviewDestination);
  const viewKey=`noema:source-view:${vaultId}:${fileId}`;
  const [savedView]=useState(()=>savedSourceView(viewKey));
  const reviewRun=destination?.category==='editorial'&&destination.fileId===fileId?destination.runId:undefined;
  useEffect(()=>{if(reviewRun){setRevisionId(reviewRun);setTab('review');}},[reviewRun]);
  const [managing,setManaging]=useState(false),[creatingAfterManage,setCreatingAfterManage]=useState(false);
  const [summaries,setSummaries]=useState<SourceReprocessingSummary[]>([]),[revisionId,setRevisionId]=useState(savedView?.revisionId??''),[revision,setRevision]=useState<SourceReprocessingRevision|null>(null),[prompt,setPrompt]=useState(false),[instructions,setInstructions]=useState(''),[depth,setDepth]=useState<SourceProcessingDepth>('balanced'),[substantialMath,setSubstantialMath]=useState(false),[reviewPolicy,setReviewPolicy]=useState<SourceReviewPolicy>('verified'),[filter,setFilter]=useState<'all'|'pending'|'accepted'|'rejected'|'automatic'>('pending'),[comparisonLayout,setComparisonLayout]=useState<ComparisonLayout>('unified'),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0),[tab,setTab]=useState<'read'|'review'>(savedView?.tab??'read');
  const [reviewStyle,setReviewStyle]=useState<'diff'|'drawer'>(savedView?.reviewStyle??'diff');
  const reviewReady=visible&&tab==='review'&&!!revision&&revision.id===revisionId;
  useLayoutEffect(()=>{onReviewOpenChange?.(reviewReady,reviewStyle);return()=>onReviewOpenChange?.(false,reviewStyle);},[reviewReady,reviewStyle,onReviewOpenChange]);
  const reviewTrigger=useRef<HTMLButtonElement>(null),reviewPane=useRef<HTMLElement>(null);
  const [evidenceSurface,setEvidenceSurface]=useState<'reading'|'original'|'pdf'>('reading');
  const contextReading=useRef<string|null>(null);
  useLayoutEffect(()=>{onEvidenceSurfaceChange?.(reviewReady&&evidenceSurface!=='reading');},[reviewReady,evidenceSurface,onEvidenceSurfaceChange]);
  useEffect(()=>{const back=()=>returnToCorrection();window.addEventListener('noema:return-to-source-correction',back);return()=>window.removeEventListener('noema:return-to-source-correction',back);});
  useEffect(()=>{if(!visible||tab!=='review'||evidenceSurface!=='reading')return;const frame=requestAnimationFrame(()=>reviewPane.current?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);},[visible,tab,revision?.id,reviewHost,evidenceSurface]);
  useEffect(()=>{onReviewRevision?.(reviewReady?revision:null);},[reviewReady,revision,onReviewRevision]);
  const reviewInvoker=useRef<HTMLElement|null>(null);
  function closeReview(){returnToCorrection();setTab('read');requestAnimationFrame(()=>{const target=reviewInvoker.current;(target?.isConnected?target:reviewTrigger.current)?.focus({preventScroll:true});});}
  const [passagePatchIds,setPassagePatchIds]=useState<string[]>([]);
  const [activePatchId,setActivePatchId]=useState(''),[bulk,setBulk]=useState(false),[reviewLimit,setReviewLimit]=useState(20);
  const mounted=useRef(true),latestRevisionId=useRef(revisionId);latestRevisionId.current=revisionId;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setReviewLimit(20);setSelected([]);},[revisionId]);
  useEffect(()=>{
    function openPatch(event:Event){const detail=(event as CustomEvent<{fileId:string;revisionId?:string;patchId:string;patchIds?:string[]}>).detail;if(detail?.fileId!==fileId)return;reviewInvoker.current=document.activeElement instanceof HTMLElement?document.activeElement:null;if(detail.revisionId)setRevisionId(detail.revisionId);setActivePatchId(detail.patchId);setPassagePatchIds(detail.patchIds??[]);setFilter('all');setTab('review');onShow();}
    window.addEventListener('noema:review-source-patch',openPatch);return()=>window.removeEventListener('noema:review-source-patch',openPatch);
  },[fileId,onShow]);
  const readingKey=`noema:source-reading:${vaultId}:${fileId}`;
  const [currentReadingId,setCurrentReadingId]=useState(()=>{try{return localStorage.getItem(readingKey)??'';}catch{return '';}}),[readingChoice,setReadingChoice]=useState(()=>{try{return savedView?.readingChoice??(localStorage.getItem(readingKey)||'original');}catch{return 'original';}});
  const requestedReadingId=readingChoice==='original'?'':readingChoice;
  const readingCallback=useRef(onReadingRevision);readingCallback.current=onReadingRevision;
  const readingRequest=useRef(0),readingSnapshot=useRef<SourceReprocessingRevision|null>(null);
  function publishReading(value:SourceReprocessingRevision|null){readingSnapshot.current=value;readingCallback.current?.(value);}
  const eligible=(item:SourceReprocessingRevision|SourceReprocessingSummary)=>item.status==='completed'&&item.report.chunksCompleted>=item.report.chunksTotal&&!item.stale;
  useEffect(()=>{
    const requestId=++readingRequest.current;
    if(!requestedReadingId){publishReading(null);return;}
    const controller=new AbortController();
    void request<SourceReprocessingRevision>(`source-files/${encodeURIComponent(fileId)}/reprocessing/${encodeURIComponent(requestedReadingId)}`,'GET',undefined,vaultId,controller.signal).then(value=>{
      if(controller.signal.aborted||readingRequest.current!==requestId)return;
      if(value.id===requestedReadingId&&value.fileId===fileId&&eligible(value))publishReading(value);
      else {publishReading(null);setReadingChoice('original');setError('This revision is incomplete or no longer matches the canonical source. Original processed text is shown.');}
    }).catch(cause=>{if(!controller.signal.aborted&&readingRequest.current===requestId){publishReading(null);setReadingChoice('original');setError(String(cause));}});
    return()=>controller.abort();
  },[fileId,vaultId,requestedReadingId,reload,canonicalVersion]);
  function chooseReading(value:string,presentation:'diff'|'read'='read'){
    if(value!=='original'&&!revisionOptions.some(item=>item.id===value&&eligible(item)))return;
    contextReading.current=null;setEvidenceSurface('reading');onReturnContext?.();
    // Publish the selected snapshot before exposing the reader. Returning from
    // evidence can restore a different reading snapshot even when the ID is unchanged.
    if(presentation==='read'&&revision?.id===value&&eligible(revision)){
      ++readingRequest.current;
      const fetched=readingSnapshot.current;
      publishReading(fetched?.id===value&&eligible(fetched)&&fetched.updatedAt>=revision.updatedAt?fetched:revision);
    }
    setReadingChoice(value);
    if(value!=='original'){setRevisionId(value);setReviewStyle('diff');setFilter('all');setTab(presentation==='diff'?'review':'read');if(presentation==='diff')onShow();}
    if(value==='original'){setTab('read');onOriginal();}
  }
  function preferReading(){
    const value=requestedReadingId;
    setCurrentReadingId(value);try{if(value)localStorage.setItem(readingKey,value);else localStorage.removeItem(readingKey);}catch{/* Preference remains available this session. */}
  }
  function returnToCorrection(){
    if(contextReading.current!==null){setReadingChoice(contextReading.current);contextReading.current=null;}
    setEvidenceSurface('reading');onReturnContext?.();
  }
  const defaultTabRevision=useRef('');
  useEffect(()=>{if(!revision||defaultTabRevision.current===revision.id)return;defaultTabRevision.current=revision.id;if(!revision.patches.some(patch=>patch.decision==='pending'))setFilter('all');if(reviewRun===revision.id){setTab('review');setReviewStyle('diff');setFilter('all');onShow();}else if(savedView?.revisionId===revision.id&&savedView.tab==='review'){onShow();}},[revision,reviewRun,requestedReadingId,onShow]);
  useEffect(()=>{
    if(!revision||revision.id!==revisionId||evidenceSurface!=='reading')return;
    try {localStorage.setItem(viewKey,JSON.stringify({readingChoice,revisionId,tab,reviewStyle}));}catch{/* Keep the selected view for this session. */}
  },[viewKey,readingChoice,revisionId,revision,tab,reviewStyle,evidenceSurface]);
  const [configuration,setConfiguration]=useState<IntelligencePreferences|null>(null),[configurationError,setConfigurationError]=useState('');
  useEffect(()=>{if(!prompt)return;const controller=new AbortController();setConfiguration(null);setConfigurationError('');void request<IntelligencePreferences>('intelligence','GET',undefined,undefined,controller.signal).then(value=>{if(!controller.signal.aborted){if(supportedIntelligencePreferences(value))setConfiguration(value);else setConfigurationError('Choose a supported model and reasoning in Settings → Intelligence.');}}).catch(()=>{if(!controller.signal.aborted)setConfigurationError('Could not load the AI configuration. Reopen this form to retry.');});return()=>controller.abort();},[prompt]);
  const actionRunning=useRef(false);
  function beginAction(){if(actionRunning.current)return false;actionRunning.current=true;setBusy(true);setError('');return true;}
  function finishAction(){actionRunning.current=false;if(mounted.current)setBusy(false);}
  useEffect(()=>setSelected([]),[revisionId]);
  const route=`source-files/${encodeURIComponent(fileId)}/reprocessing`;
  useEffect(()=>{const refresh=(event:Event)=>{const detail=(event as CustomEvent<{vaultId:string;fileId:string}>).detail;if(detail?.vaultId===vaultId&&detail.fileId===fileId)setReload(value=>value+1);};window.addEventListener('noema:source-ingestion-completed',refresh);return()=>window.removeEventListener('noema:source-ingestion-completed',refresh);},[vaultId,fileId]);
  const [evidenceOptions,setEvidenceOptions]=useState<SourceReprocessingConfiguration['evidence']>({originalPages:false,ocr:false,allowExternalTransmission:false}),[evidenceCapabilities,setEvidenceCapabilities]=useState<EvidenceCapabilities|null>(null),[evidenceError,setEvidenceError]=useState('');
  useEffect(()=>{
    if(!prompt)return;const controller=new AbortController();setEvidenceOptions({originalPages:false,ocr:false,allowExternalTransmission:false});setEvidenceCapabilities(null);setEvidenceError('');
    void request<unknown>(`${route}/capabilities`,'GET',undefined,vaultId,controller.signal).then(value=>{if(controller.signal.aborted)return;if(validEvidenceCapabilities(value)){setEvidenceCapabilities(value);}else setEvidenceError('Evidence capabilities could not be checked. Extracted text remains available.');}).catch(()=>{if(!controller.signal.aborted)setEvidenceError('Evidence capabilities could not be checked. Extracted text remains available.');});return()=>controller.abort();
  },[prompt,route,vaultId]);

  useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function refresh(){try{const items=await request<SourceReprocessingSummary[]>(route,'GET',undefined,vaultId,controller.signal);if(controller.signal.aborted)return;setSummaries(items);setRevisionId(id=>id||(items.some(item=>item.id===requestedReadingId)?requestedReadingId:'')||items[0]?.id||'');if(items.some(item=>active(item.status)))timer=setTimeout(()=>void refresh(),2500);}catch(cause){if(!controller.signal.aborted)setError(String(cause));}}
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
  const activeRun=summaries.find(item=>active(item.status));
  const revisionOptions=revision?summaries.some(item=>item.id===revision.id)?summaries.map(item=>item.id===revision.id?revision:item):[revision,...summaries]:summaries;
  const versionLabels=sourceRevisionLabels(revisionOptions);
  function openSetup(){
    setError('');
    if(summaries.length>=sourceEditorialRevisionLimit){setPrompt(false);setCreatingAfterManage(true);setManaging(true);}else setPrompt(true);
    onShow();
  }
  async function deleteRevision(id:string){
    if(!beginAction())throw new Error('Wait for the current action to finish.');
    try{
      await request(`${route}/${encodeURIComponent(id)}`,'DELETE',undefined,vaultId);
      if(!mounted.current)return;
      const remaining=summaries.filter(item=>item.id!==id);setSummaries(remaining);
      if(readingChoice===id){++readingRequest.current;contextReading.current=null;setReadingChoice('original');publishReading(null);onOriginal();}
      if(contextReading.current===id)contextReading.current='original';
      if(currentReadingId===id){setCurrentReadingId('');try{localStorage.removeItem(readingKey);}catch{/* Session preference is cleared. */}}
      if(revisionId===id){setRevision(null);setRevisionId(remaining[0]?.id??'');setTab('read');setPassagePatchIds([]);setSelected([]);setActivePatchId('');}
      setReload(n=>n+1);
    }finally{finishAction();}
  }
  async function start(){if(summaries.length>=sourceEditorialRevisionLimit){openSetup();return;}if(!configuration||!evidenceCapabilities&&!evidenceError||evidenceOptions.originalPages&&!evidenceOptions.allowExternalTransmission||!beginAction())return;try{const value=await request<SourceReprocessingRevision>(route,'POST',{instructions,pipelineVersion:2,configuration:{depth,substantialMath,reviewPolicy,evidence:evidenceOptions}},vaultId);if(!mounted.current)return;setRevisionId(value.id);setRevision(value);setPrompt(false);setReviewStyle('diff');setFilter('all');setTab('review');setReload(n=>n+1);onShow();}catch(cause){if(mounted.current){const message=cause instanceof Error?cause.message:String(cause);setError(message);if(/Revision limit reached/i.test(message)){setPrompt(false);setCreatingAfterManage(true);setManaging(true);setReload(n=>n+1);}}}finally{finishAction();}}
  const patchDraftKey=(patch:SourceEditorialPatch)=>JSON.stringify([vaultId,fileId,revision?.id,patch.id]);
  async function decide(patch:SourceEditorialPatch,decision:'accepted'|'rejected'|'pending',replacement?:string){
    if(!revision||!beginAction())return;
    const group=revision.patches.filter(item=>item.id===patch.id||!!patch.patchGroupId&&item.patchGroupId===patch.patchGroupId);
    const decisions=group.map(item=>{
      const edited=item.id===patch.id&&replacement!==undefined?replacement:editorialDraft(patchDraftKey(item),patchBaseline(item));
      return {patchId:item.id,decision,...(decision==='accepted'&&edited!==undefined?{replacement:edited}:{})};
    });
    try{
      const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revision.id)}/review`,'POST',{updatedAt:revision.updatedAt,decisions},vaultId);
      if(!mounted.current)return;
      group.forEach(item=>clearEditorialDraft(patchDraftKey(item)));
      if(latestRevisionId.current===value.id)setRevision(value);
      setSelected(ids=>ids.filter(id=>!group.some(item=>item.id===id)));setReload(n=>n+1);
      if(value.origin?.kind==='ingestion')window.dispatchEvent(new CustomEvent('noema:source-ingestion-updated',{detail:{vaultId,fileId}}));
    }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}
  }
  async function control(action:'cancel'|'resume'){
    if(!revision||!beginAction())return;
    try{const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revision.id)}/${action}`,'POST',{},vaultId);if(!mounted.current)return;if(latestRevisionId.current===value.id)setRevision(value);setReload(n=>n+1);}
    catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}
  }
  async function decideMany(patches:SourceEditorialPatch[],decision:'accepted'|'rejected'){
    if(!revision||!patches.length||!beginAction())return;
    const ids=new Set(patches.map(patch=>patch.id)),groups=new Set(patches.map(patch=>patch.patchGroupId).filter(Boolean));
    const targets=revision.patches.filter(patch=>ids.has(patch.id)||!!patch.patchGroupId&&groups.has(patch.patchGroupId));
    const decisions=targets.map(patch=>{
      const replacement=editorialDraft(patchDraftKey(patch),patchBaseline(patch));
      return {patchId:patch.id,decision,...(decision==='accepted'&&replacement!==undefined?{replacement}:{})};
    });
    try{
      const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revision.id)}/review`,'POST',{updatedAt:revision.updatedAt,decisions},vaultId);
      if(!mounted.current)return;
      targets.forEach(patch=>clearEditorialDraft(patchDraftKey(patch)));
      if(latestRevisionId.current===value.id)setRevision(value);
      setSelected(current=>current.filter(id=>!targets.some(patch=>patch.id===id)));setReload(n=>n+1);
      if(value.origin?.kind==='ingestion')window.dispatchEvent(new CustomEvent('noema:source-ingestion-updated',{detail:{vaultId,fileId}}));
      return value;
    }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}
  }
  async function decideSelected(decision:'accepted'|'rejected'){
    await decideMany(revision?.patches.filter(patch=>selected.includes(patch.id))??[],decision);
  }
  function acceptAllPending(){return decideMany(revision?.patches.filter(patch=>patch.decision==='pending')??[],'accepted');}
  const automaticallyApplied=(patch:SourceEditorialPatch)=>patch.decision==='accepted'&&(patch.decisionHistory?.at(-1)?.actor??(patch.autoAcceptance?'automatic':'user'))==='automatic';
  const matches=(patch:SourceEditorialPatch,value:typeof filter)=>value==='all'||(value==='automatic'?automaticallyApplied(patch):value==='accepted'?patch.decision==='accepted'&&!automaticallyApplied(patch):patch.decision===value);
  const shownPatches=revision?.patches.filter(patch=>matches(patch,filter)&&(!passagePatchIds.length||passagePatchIds.includes(patch.id)))??[];
  const brokenFootnotes=revision?.report.validationDiagnostics?.filter(message=>/footnote.*(?:no definition|missing|ambiguous|\d+ definitions)/i.test(message))??[];
  const visiblePatches=shownPatches.slice(0,reviewLimit),activePatch=shownPatches.find(patch=>patch.id===activePatchId)??shownPatches[0];
  const activeIndex=shownPatches.findIndex(patch=>patch.id===activePatch?.id);
  const activeGroup=activePatch?(revision?.patches.filter(patch=>patch.id===activePatch.id||!!activePatch.patchGroupId&&patch.patchGroupId===activePatch.patchGroupId)??[]):[];
  const primaryFilters=['pending','all'] as const,historyFilters=['automatic','accepted','rejected'] as const;
  const reviewLabels={pending:'Pending',automatic:'Automatically applied',accepted:'Applied manually',rejected:'Rejected',all:'All history'};
  const emptyReviewMessages={pending:'No pending changes to review.',automatic:'No automatically applied changes.',accepted:'No manually applied changes yet.',rejected:'No rejected changes. Rejected suggestions keep the original text.',all:'No editorial changes recorded.'};
  function renderFilter(value:typeof filter){
    return <button key={value} type="button" aria-pressed={filter===value} onClick={()=>{setPassagePatchIds([]);setFilter(value);setActivePatchId('');setReviewLimit(20);setSelected([]);}}>{uiText(reviewLabels[value])} <span className="reprocessing-filter-count">{revision!.patches.filter(patch=>matches(patch,value)).length}</span></button>;
  }
  function locatePatch(patch:SourceEditorialPatch){
    setActivePatchId(patch.id);
  }
  function showPatchSource(patch:SourceEditorialPatch){
    if(contextReading.current===null)contextReading.current=readingChoice;
    setEvidenceSurface('original');
    const candidates=revision?sourceDocumentEntries(revision.original.document).filter(({node})=>patch.nodeIds.includes(node.id)&&node.range.startOffset<patch.range.endOffset&&node.range.endOffset>patch.range.startOffset).sort((a,b)=>(a.node.range.endOffset-a.node.range.startOffset)-(b.node.range.endOffset-b.node.range.startOffset)):[];
    const nodeId=candidates[0]?.node.id;
    setReadingChoice('original');onOriginal(nodeId,false);onShow();
  }
  function renderReview(pane:React.ReactNode){return reviewHost?createPortal(pane,reviewHost):pane;}
  return <section className="source-reprocessing" aria-label={uiText("Beta source reprocessing")}>
    <div className="reprocessing-bar">
      <label className="reprocessing-reading-picker">{uiText("Reading version")} <Select aria-label={uiText("Reading version")} value={readingChoice} onChange={event=>chooseReading(event.target.value)}>
        <option value="original">{uiText("Original processed")}{!currentReadingId?" · Preferred":""}</option>
        {revisionOptions.filter(eligible).map(item=><option key={item.id} value={item.id}>{versionLabels.get(item.id)} · {new Date(item.createdAt).toLocaleString(getLocale())}{currentReadingId===item.id?" · Preferred":""}</option>)}
      </Select></label>
      <button type="button" className="reprocessing-quiet-action" aria-label={uiText("Set as preferred reading version")} title={uiText("Set as preferred reading version")} disabled={requestedReadingId===currentReadingId} onClick={preferReading}>{requestedReadingId===currentReadingId?uiText("Preferred"):uiText("Set preferred")}</button>
      <button ref={reviewTrigger} type="button" disabled={!revision||revision.id!==revisionId} className="reprocessing-quiet-action" aria-expanded={visible&&tab==='review'} aria-controls={`source-review-${fileId}`} onClick={()=>{reviewInvoker.current=reviewTrigger.current;setPassagePatchIds([]);setFilter('all');setReviewStyle('diff');setTab('review');onShow();}}>{uiText("Review changes (")}{pending})</button>
      {!!pending&&revision&&revision.id===revisionId&&<button type="button" className="button primary small" disabled={busy||!!stale||active(revision.status)} onClick={()=>void (async()=>{const value=await acceptAllPending();if(!value||!mounted.current||latestRevisionId.current!==value.id)return;contextReading.current=null;setEvidenceSurface('reading');onReturnContext?.();++readingRequest.current;publishReading(value);setReadingChoice(value.id);setTab('read');})()}>{uiText('Accept and read ({value0})',{value0:pending})}</button>}
      <button type="button" className="button small reprocessing-loading-button" aria-busy={running} disabled={busy} onClick={()=>{setError('');if(running){if(activeRun)setRevisionId(activeRun.id);onShow();}else openSetup();}}>{running&&<span className="scan-spinner" aria-hidden="true"/>}{running?uiText("Processing status"):uiText("Refine text")}</button>
    </div>
    <div className="reprocessing-view-controls">
      {revision&&revision.id===revisionId&&<div className="reprocessing-view-switch" role="group" aria-label={uiText('Revision view')}>
        <button type="button" aria-pressed={tab==='read'&&readingChoice===revision.id} disabled={!eligible(revision)} onClick={()=>chooseReading(revision.id,'read')}>{uiText('Changes applied')}</button>
        <button type="button" aria-pressed={reviewReady&&reviewStyle==='diff'} onClick={()=>{returnToCorrection();setReviewStyle('diff');setFilter('all');setPassagePatchIds([]);setTab('review');onShow();}}>{uiText('Diff')}</button>
      </div>}
      <button type="button" className="reprocessing-quiet-action" disabled={busy} onClick={()=>{setCreatingAfterManage(false);setManaging(true);onShow();}}>{uiText('Manage revisions')}</button>
    </div>
    {managing&&<SourceRevisionManager revisions={summaries} busy={busy} creating={creatingAfterManage} readingId={requestedReadingId} preferredId={currentReadingId} onDelete={deleteRevision} onContinue={()=>{setManaging(false);setCreatingAfterManage(false);setPrompt(true);}} onClose={()=>{setManaging(false);setCreatingAfterManage(false);}}/>}
    {error&&!prompt&&<InlineNotice id={`reprocessing-operation-error-${fileId}`} tone="error" title={error} announcement="assertive" actions={<button type="button" className="button" onClick={()=>{setError('');setReload(n=>n+1);}}>{uiText("Refresh")}</button>}/>}
    {visible&&<>
      {prompt&&<SourceReprocessingSetup fileId={fileId} configuration={configuration} configurationError={configurationError} depth={depth} onDepth={setDepth} substantialMath={substantialMath} onSubstantialMath={setSubstantialMath} reviewPolicy={reviewPolicy} onReviewPolicy={setReviewPolicy} instructions={instructions} onInstructions={setInstructions} evidenceCapabilities={evidenceCapabilities} evidenceError={evidenceError} evidenceOptions={evidenceOptions} onEvidenceOptions={setEvidenceOptions} busy={busy} running={running} error={error} onStart={()=>void start()} onClose={()=>setPrompt(false)}/>}
      {activeRun&&activeRun.id!==revisionId&&<div className="reprocessing-active-run" role="status"><span>{versionLabels.get(activeRun.id)} · {uiText("A revision is processing")} · {new Date(activeRun.createdAt).toLocaleString(getLocale())}</span><button type="button" className="button small" onClick={()=>setRevisionId(activeRun.id)}>{uiText("Show processing status")}</button></div>}
      {!revision&&!prompt&&<p role="status">{revisionId?uiText("Loading revision…"):uiText("Refine text to create an editorial reading version and review suggested corrections.")}</p>}
      {revision&&revision.id===revisionId&&<>{stale&&<InlineNotice id={`reprocessing-stale-${revision.id}`} tone="warning" title={uiText("The canonical source has changed. This revision is preserved for comparison; start a new run before reviewing changes.")}/>}
        <SourceReprocessingProgress key={revision.id} versionLabel={versionLabels.get(revision.id)} revision={revision} busy={busy} running={running} pending={pending} onStop={()=>void control('cancel')} onResume={()=>void control('resume')} onReview={()=>{setPassagePatchIds([]);setFilter(pending>0?'pending':'all');setTab('review');}} onRefine={openSetup}>
        {!!revision.furniture?.length&&<details className="reprocessing-page-furniture"><DisclosureSummary>{uiText("Page headers and footers ({value0})",{value0:revision.furniture.length})}</DisclosureSummary><p>{uiText("Marked as page furniture. Source text is retained; use the reading display options to hide headers and footers.")}</p><ul>{revision.furniture.map(item=><li key={item.id}><strong>{uiText(item.kind==='footer'?"Page footer":"Page header")} · {uiText("Page {value0}",{value0:item.page})}</strong><blockquote>{item.text}</blockquote><small>{item.reason}</small></li>)}</ul></details>}

        {eligible(revision)&&<div className="reprocessing-result-summary" role="status"><p>{revision.patches.length===0?uiText("No text or layout changes were proposed."):revision.patches.some(patch=>patch.decision==='accepted')?uiText("The processed reading version includes {value0} applied corrections.",{value0:revision.patches.filter(patch=>patch.decision==='accepted').length}):pending>0?uiText("{value0} proposed corrections are waiting for review. The reading text is unchanged until corrections are accepted.",{value0:pending}):uiText("All proposed corrections were rejected; the original text is retained.")}</p>{revision.reprocessed.text!==revision.original.text&&requestedReadingId!==revision.id&&<button type="button" className="button primary small" onClick={()=>chooseReading(revision.id)}>{uiText("Show processed version")}</button>}{pending>0&&<button type="button" className="reprocessing-quiet-action" onClick={()=>{setFilter('pending');setTab('review');}}>{uiText("Review proposed corrections")}</button>}</div>}
        {revision.report.metadata&&<section className="source-metadata-run-summary" aria-label="Metadata processing summary"><strong>Metadata</strong><p>{revision.report.metadata.added} added · {revision.report.metadata.corroborated} corroborated · {revision.report.metadata.requiresReview} require review</p><button type="button" className="button small" onClick={()=>window.dispatchEvent(new CustomEvent('noema:open-source-metadata',{detail:{vaultId,sourceId,fileId,runId:revision.id}}))}>Review metadata</button></section>}
        <div className="reprocessing-processing-details"><ExcerptLedger revision={revision}/><Report revision={revision}/></div>
        <p className="reprocessing-status" role="status">{uiText("Editorial decisions")} · {pending}{" " + uiText("pending ·") + " "}{revision.patches.filter(patch=>patch.decision==='accepted').length}{" " + uiText("accepted ·") + " "}{revision.patches.filter(patch=>patch.decision==='rejected').length}{" " + uiText("kept original")}</p>
        </SourceReprocessingProgress>
        {brokenFootnotes.length>0&&<InlineNotice tone="warning" title={uiText("This revision has broken footnote links")} description={<>{uiText("Some note definitions are missing or ambiguous. Compare the original source and repair the affected changes before relying on this reading version.")}<ul>{brokenFootnotes.slice(0,5).map((message,index)=><li key={index}>{message}</li>)}</ul></>}/>}
        {tab==='read'?null:renderReview(reviewStyle==='diff'?<aside ref={reviewPane} tabIndex={-1} id={`source-review-${fileId}`} className="reprocessing-reviews reprocessing-diff-review" aria-label={uiText('Revision diff')} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();closeReview();}}}>
          <div className="reprocessing-diff-heading"><strong>{uiText('Changes')}</strong><span>{revision.patches.filter(patch=>patch.decision==='accepted').length} {uiText('accepted')} · {pending} {uiText('pending')}</span><button type="button" className="reprocessing-quiet-action" disabled={!pending||busy||!!stale||active(revision.status)} onClick={()=>void acceptAllPending()}>{uiText('Apply all pending ({value0})',{value0:pending})}</button><button type="button" className="reprocessing-quiet-action" onClick={()=>{setReviewStyle('drawer');setFilter(pending>0?'pending':'all');}}>{uiText('Detailed review')}</button></div>
          <SourceRevisionDiff revision={revision} onDecisions={async(patches,decision)=>{await decideMany(patches,decision);}} disabled={busy||!!stale||active(revision.status)} onDecision={decide} onEdit={patch=>{setReviewStyle('drawer');setPassagePatchIds([]);setFilter('all');setActivePatchId(patch.id);}} onLocate={showPatchSource} onCompare={onCompare?page=>{if(contextReading.current===null)contextReading.current=readingChoice;setEvidenceSurface('pdf');onCompare(page);}:undefined}/>
        </aside>:<aside ref={reviewPane} tabIndex={-1} id={`source-review-${fileId}`} className="reprocessing-reviews" aria-label={uiText("Review corrections")} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();closeReview();}}}>
          <div className="reprocessing-review-heading"><h2>{uiText("Review corrections")}</h2><button type="button" className="button small" onClick={closeReview}>{uiText("Close corrections")}</button></div>
      {revisionOptions.length>0&&<label className="reprocessing-revision-picker">{uiText("Examining revision") + " "}<Select aria-label={uiText("Examining revision")} disabled={busy} value={revisionId} onChange={e=>{returnToCorrection();setPassagePatchIds([]);setActivePatchId('');setRevisionId(e.target.value);}}>{revisionOptions.map(item=><option key={item.id} value={item.id}>{versionLabels.get(item.id)} · {new Date(item.createdAt).toLocaleString(getLocale())} · {uiText(partial(item)?"Partial revision":item.status)}</option>)}</Select></label>}
          {evidenceSurface!=='reading'&&<div className="reprocessing-context-return" role="status"><span>{uiText(evidenceSurface==='pdf'?"PDF page evidence":"Original passage")}</span><button type="button" className="button small" onClick={returnToCorrection}>{uiText("Return to correction")}</button></div>}
          <div className="reprocessing-tabs reprocessing-review-filters" role="group" aria-label={uiText("Review status")}>
            {primaryFilters.map(renderFilter)}
            <details className="reprocessing-history-filters"><DisclosureSummary>{uiText("More filters")}{filter!=='pending'&&filter!=='all'?" · "+uiText(reviewLabels[filter]):''}</DisclosureSummary><div role="group" aria-label={uiText("Historical decision filters")}>{historyFilters.map(renderFilter)}</div></details>
          </div>
          <div className="reprocessing-actions reprocessing-review-toolbar">
            <label className="reprocessing-layout-picker">{uiText("Comparison") + " "}<Select aria-label={uiText("Comparison layout")} value={comparisonLayout} onChange={event=>setComparisonLayout(event.target.value as ComparisonLayout)}><option value="auto">{uiText("Auto (unified on narrow screens)")}</option><option value="split">{uiText("Side by side")}</option><option value="unified">{uiText("Unified")}</option></Select></label>
            <button type="button" className="reprocessing-quiet-action" disabled={!pending||busy||!!stale||active(revision.status)} onClick={()=>void acceptAllPending()}>{uiText('Apply all pending ({value0})',{value0:pending})}</button>
            <button type="button" className="reprocessing-quiet-action" aria-pressed={bulk} onClick={()=>{setBulk(value=>!value);setSelected([]);}}>{uiText(bulk?"Exit bulk review":"Bulk review")}</button>
            {bulk&&<><button className="button small" disabled={!selected.length||busy||!!stale||active(revision.status)} onClick={()=>void decideSelected('accepted')}>{uiText("Accept selected (")}{selected.length})</button><button className="button small" disabled={!selected.length||busy||!!stale||active(revision.status)} onClick={()=>void decideSelected('rejected')}>{uiText("Keep original for selected")}</button></>}
          </div>
          {passagePatchIds.length>0&&<button type="button" className="reprocessing-quiet-action" onClick={()=>setPassagePatchIds([])}>{uiText("Showing this passage · Show all corrections")}</button>}
          {filter==='rejected'&&shownPatches.length>0&&<p className="reprocessing-hint">{uiText("These suggestions were rejected. The original text is kept in the reading version.")}</p>}
          {!shownPatches.length&&<p role="status">{emptyReviewMessages[filter]}</p>}
          {activePatch&&<nav className="reprocessing-review-navigation" aria-label={uiText("Change navigation")}><button type="button" className="button small" disabled={activeIndex<=0} onClick={()=>locatePatch(shownPatches[activeIndex-1]!)}>{uiText("Previous change")}</button><span role="status">{uiText("Change {value0} of {value1}",{value0:activeIndex+1,value1:shownPatches.length})}</span><button type="button" className="button small" disabled={activeIndex>=shownPatches.length-1} onClick={()=>{setReviewLimit(limit=>Math.max(limit,activeIndex+2));locatePatch(shownPatches[activeIndex+1]!);}}>{uiText("Next change")}</button></nav>}
          <div className="reprocessing-master-detail">
            <ol className="reprocessing-patch-list" aria-label={uiText("Corrections")}>
              {visiblePatches.map((patch,index)=><li key={patch.id}>
                {bulk&&<label className="reprocessing-select"><input type="checkbox" aria-label={uiText("Select change {value0}",{value0:index+1})} checked={selected.includes(patch.id)} disabled={busy||!!stale||active(revision.status)} onChange={event=>setSelected(ids=>{const related=revision.patches.filter(item=>item.id===patch.id||!!patch.patchGroupId&&item.patchGroupId===patch.patchGroupId).map(item=>item.id);return event.target.checked?[...new Set([...ids,...related])]:ids.filter(id=>!related.includes(id));})}/></label>}
                <button type="button" aria-pressed={activePatch?.id===patch.id} onClick={()=>locatePatch(patch)} onKeyDown={event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?visiblePatches.length-1:Math.max(0,Math.min(visiblePatches.length-1,index+(event.key==='ArrowDown'?1:-1)));locatePatch(visiblePatches[target]);event.currentTarget.closest('ol')?.querySelectorAll<HTMLButtonElement>('li>button')[target]?.focus();}}>
                  <strong>{uiText(label(patch.category))}</strong><span>{patch.range.startPage?uiText("Page {value0}",{value0:patch.range.startPage}):uiText("Line {value0}",{value0:patch.range.startLine})}{patch.riskReasons?.length?' · '+uiText("Manual verification required"):''}</span><span>{uiText(patch.decision==='pending'?"Pending review":patch.decision==='accepted'?"Applied":"Original kept")}</span>
                </button>
              </li>)}
            </ol>
            {activePatch&&<PatchReview draftKey={patchDraftKey(activePatch)} draftKeyFor={patchDraftKey} key={`${revision.id}:${activePatch.id}`} patch={activePatch} group={activeGroup} sourceText={revision.original.text} layout={comparisonLayout} onLocate={()=>showPatchSource(activePatch)} onChoose={locatePatch} onCompare={onCompare?page=>{if(contextReading.current===null)contextReading.current=readingChoice;setEvidenceSurface('pdf');onCompare(page);}:undefined} disabled={busy||!!stale||active(revision.status)} onDecision={decide}/>}
            {error&&<InlineNotice id={`reprocessing-review-error-${revision.id}`} tone="error" title={uiText("Could not save correction")} description={error} announcement="assertive"/>}
          </div>
          {shownPatches.length>reviewLimit&&<button type="button" className="button small" onClick={()=>setReviewLimit(limit=>limit+20)}>{uiText("Load more changes")}</button>}

        </aside>)}
      </>}
    </>}
  </section>;
}
