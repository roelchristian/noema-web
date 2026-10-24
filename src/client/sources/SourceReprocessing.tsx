import {editorialDraft,saveEditorialDraft,clearEditorialDraft} from '../review/editorial-drafts';
import {useContext} from 'react';
import {ReviewDestination} from '../review/review-destination';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {useEffect,useId,useRef,useState} from 'react';
import {sourceDocumentEntries,sourceNodeLocator} from '../../shared/source-document';
import type {SourceEditorialPatch,SourceEditorialAttempt,SourceReprocessingRevision,SourceReprocessingSummary} from '../../shared/source-reprocessing';
import {request} from '../api';
import {intelligenceModels,supportedIntelligencePreferences,type IntelligencePreferences} from '../../shared/intelligence';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {SourceReaderText,SourceReaderInline} from './SourceReaderText';
import {SourcePatchComparison,type ComparisonLayout} from './SourcePatchComparison';
import './source-reprocessing.css';

type Props={vaultId:string;fileId:string;visible:boolean;onShow:()=>void;onOriginal:(nodeId?:string)=>void;onCompare?:(page:number)=>void};
const active=(status:string)=>status==='queued'||status==='running';
const label=(value:string)=>value.replaceAll('_',' ');
const excerptLabel=(status:string)=>({pending:'Not started',running:'Processing',completed:'Completed',failed:'Failed',interrupted:'Interrupted'}[status]??label(status));
function exportJSON(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function originalNode(revision:SourceReprocessingRevision,offset:number,nodeId:string){
  const originalEntries=sourceDocumentEntries(revision.original.document);
  const linkedIds=new Set(revision.nodeLinks?.filter(item=>item.reprocessedNodeIds.includes(nodeId)).map(item=>item.originalNodeId));
  const linked=originalEntries.filter(({node})=>linkedIds.has(node.id)).sort((a,b)=>(a.node.id===nodeId?-1:b.node.id===nodeId?1:0)||(a.node.range.endOffset-a.node.range.startOffset)-(b.node.range.endOffset-b.node.range.startOffset));
  if(linked[0])return linked[0].node.id;
  let shift=0;
  for(const patch of revision.patches.filter(p=>p.decision==='accepted').sort((a,b)=>a.range.startOffset-b.range.startOffset)){
    const replacement=patch.userReplacement??patch.replacement,start=patch.range.startOffset+shift;
    if(offset<start)break;
    if(offset<start+replacement.length)return patch.nodeIds[0];
    shift+=replacement.length-patch.original.length;
  }
  const original=offset-shift,entries=sourceDocumentEntries(revision.original.document);
  return entries.find(({node})=>node.range.startOffset<=original&&node.range.endOffset>original&&node.text!==undefined)?.node.id??entries.find(({node})=>node.range.startOffset<=original&&node.range.endOffset>original)?.node.id;
}
function RevisionPassage({revision,entry}:{revision:SourceReprocessingRevision;entry:ReturnType<typeof sourceDocumentEntries>[number]}){
  const [expanded,setExpanded]=useState(false),panelId=useId(),trigger=useRef<HTMLButtonElement>(null);
  const {node,path}=entry,locator=sourceNodeLocator(path)??'Passage';
  const originalId=expanded?originalNode(revision,node.range.startOffset,node.id):undefined;
  const original=originalId?sourceDocumentEntries(revision.original.document).find(({node})=>node.id===originalId)?.node:undefined;
  function dismiss(){setExpanded(false);trigger.current?.focus({preventScroll:true});}
  return <section className="reprocessing-passage">
    <button ref={trigger} type="button" className="reprocessing-origin" aria-expanded={expanded} aria-controls={panelId} onClick={()=>setExpanded(value=>!value)} title={uiText("Compare the original passage below")}>{locator} · {expanded?uiText("Hide original"):uiText("Show original")}</button>
    {node.text===undefined?<h3><SourceReaderInline text={node.title??''} footnotePrefix={revision.id}/></h3>:<SourceReaderText text={node.text} kind={node.kind} footnotePrefix={revision.id}/>}
    <aside id={panelId} className="reprocessing-original-preview" aria-label={uiText("Original passage {value0}",{value0: locator})} hidden={!expanded} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();dismiss();}}}>
      {expanded&&<>
        <div className="reprocessing-original-heading"><span>{uiText("Original")}</span><button type="button" aria-label={uiText("Dismiss original passage {value0}",{value0: locator})} onClick={dismiss}>{uiText("Dismiss")}</button></div>
        {original?(original.text===undefined?<SourceReaderInline text={original.title??''} footnotePrefix={`${revision.id}-original`}/>:<SourceReaderText text={original.text} kind={original.kind} footnotePrefix={`${revision.id}-original`}/>):<p>{uiText("The original passage could not be matched.")}</p>}
      </>}
    </aside>
  </section>;
}
function RevisionDocument({revision}:{revision:SourceReprocessingRevision}){
  const entries=sourceDocumentEntries(revision.reprocessed.document).filter(({node})=>node.text!==undefined||node.title);
  return <article className="source-reader-document reprocessing-document" aria-label={uiText("Reprocessed source")}>
    {entries.map(entry=><RevisionPassage key={`${revision.id}:${entry.node.id}`} revision={revision} entry={entry}/>)}
    {!entries.length&&<SourceReaderText text={revision.reprocessed.text} footnotePrefix={revision.id}/>}
  </article>;
}
function PatchReview({draftKey,patch,disabled,selected,layout,onSelect,onCompare,onDecision}:{draftKey:string;patch:SourceEditorialPatch;layout:ComparisonLayout;disabled:boolean;selected:boolean;onCompare?:(page:number)=>void;onSelect:(selected:boolean)=>void;onDecision:(patch:SourceEditorialPatch,decision:'accepted'|'rejected'|'pending',replacement?:string)=>Promise<void>}){
  const baseline=JSON.stringify([patch.original,patch.userReplacement??patch.replacement,patch.decision]);
  const restored=editorialDraft(draftKey,baseline);
  const [editing,setEditing]=useState(restored!==undefined),[replacement,setReplacement]=useState(restored??patch.userReplacement??patch.replacement);
  useEffect(()=>{if(editing)saveEditorialDraft(draftKey,baseline,replacement);},[draftKey,baseline,editing,replacement]);
  const changeTypes={ocr:'OCR correction',line_breaks:'Line breaks',footnote:'Footnote',apparatus:'Page apparatus',metadata:'Metadata',citation:'Citation',math:'Math',formatting:'Formatting'};
  const hasRisks=!!patch.riskReasons?.length;
  useEffect(()=>{if(!editing)setReplacement(patch.userReplacement??patch.replacement);},[patch.userReplacement,patch.replacement,editing]);
  return <details className="reprocessing-patch" open={patch.decision==='pending'?true:undefined}>
    <DisclosureSummary><span className="reprocessing-change-type">{changeTypes[patch.category]}</span><span className="reprocessing-decision">{patch.decision==='pending'?uiText("Pending review"):patch.decision==='accepted'?uiText("Accepted"):uiText("Rejected · original kept")}</span>{hasRisks&&<span className="reprocessing-risk-badge">{uiText("Review carefully")}</span>}</DisclosureSummary>
    <div className="reprocessing-patch-location"><span>{uiText("Original") + " "}{patch.range.startPage?uiText("page {value0}{value1} · ",{value0: patch.range.startPage,value1: patch.range.endPage&&patch.range.endPage!==patch.range.startPage?`–${patch.range.endPage}`:''}):''}{uiText("lines") + " "}{patch.range.startLine}–{patch.range.endLine}</span>
      {onCompare&&patch.range.startPage&&<button type="button" className="reprocessing-quiet-action" onClick={()=>onCompare(patch.range.startPage!)}>{uiText("Compare PDF page") + " "}{patch.range.startPage}</button>}
    </div>
    <SourcePatchComparison original={patch.original} replacement={editing?replacement:patch.userReplacement??patch.replacement} layout={layout}/>
    {editing&&<label className="reprocessing-edit">{uiText("Edit suggested replacement")}<textarea aria-label={uiText("Edit suggested replacement")} disabled={disabled} value={replacement} onChange={e=>setReplacement(e.target.value)}/></label>}
    <div className="reprocessing-patch-explanation">
      {hasRisks&&<div className="reprocessing-patch-risks"><strong>{uiText("Review carefully")}</strong><ul>{patch.riskReasons!.map(reason=><li key={reason}>{reason}</li>)}</ul></div>}
      <p>{patch.reason}</p>
      <small className="reprocessing-confidence">{uiText("AI confidence:") + " "}{Math.round(patch.confidence*100)}%</small>
    </div>
    <div className="reprocessing-patch-footer">
      <div className="reprocessing-actions"><button type="button" className="button primary small" disabled={disabled} onClick={()=>void onDecision(patch,'accepted',editing?replacement:undefined)}>{editing?uiText("Accept edited change"):uiText("Accept change")}</button><button type="button" className="button small" disabled={disabled} onClick={()=>void onDecision(patch,'rejected')}>{uiText("Keep original")}</button><button type="button" className="reprocessing-quiet-action" disabled={disabled} onClick={()=>{if(editing)clearEditorialDraft(draftKey);setEditing(value=>!value);}}>{editing?uiText("Cancel edit"):uiText("Edit")}</button>{patch.decision!=='pending'&&<button type="button" className="reprocessing-quiet-action" disabled={disabled} onClick={()=>void onDecision(patch,'pending')}>{uiText("Return to review")}</button>}</div>
      <label className="reprocessing-select"><input type="checkbox" checked={selected} disabled={disabled} onChange={event=>onSelect(event.target.checked)}/>{" " + uiText("Select for bulk review")}</label>
    </div>
  </details>;
}
function exportVariant(revision:SourceReprocessingRevision,variant:'original'|'reprocessed'){
  exportJSON({schemaVersion:1,revisionId:revision.id,fileId:revision.fileId,baseHash:revision.baseHash,variant,canonical:variant==='original',createdAt:revision.createdAt,updatedAt:revision.updatedAt,provenance:{original:`source-original-${revision.id}.json`,reprocessed:`source-reprocessed-${revision.id}.json`,fullRevision:`source-revision-${revision.id}.json`,nodeLinks:revision.nodeLinks??[],patches:revision.patches},...revision[variant]},`source-${variant}-${revision.id}.json`);
}
const partial=(revision:Pick<SourceReprocessingRevision,'status'|'report'>)=>!active(revision.status)&&revision.report.chunksCompleted<revision.report.chunksTotal;
const configurationFailure=(revision:SourceReprocessingRevision)=>/config|unsupported|provider_http_(?:40[0134]|422)/.test(revision.report.errorCode??'');
function ReprocessingProgress({revision}:{revision:SourceReprocessingRevision}){
  const {report,status}=revision;
  const sessionStarted=report.sessionStartedAt?Date.parse(report.sessionStartedAt):NaN;
  const recent=(report.excerpts??[]).filter(excerpt=>excerpt.status==='completed').flatMap(excerpt=>excerpt.history??[]).filter(attempt=>!attempt.errorCode&&attempt.durationMs>0&&Date.parse(attempt.startedAt)>=sessionStarted).sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt)).slice(0,5);
  const remaining=report.chunksTotal-report.chunksCompleted;
  const seconds=recent.length?Math.max(1,Math.ceil(recent.reduce((sum,attempt)=>sum+attempt.durationMs,0)/recent.length*Math.ceil(remaining/Math.max(1,report.concurrency??1))/1000)):null;
  const duration=seconds===null?'':seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;
  const estimate=status==='queued'?uiText("Waiting to start"):remaining<=0?uiText("Finishing up…"):seconds===null?uiText("Time estimate available after a successful excerpt in this session."):uiText("Est. time remaining: ~{value0}",{value0:duration});
  const failed=partial(revision);
  return <div className="reprocessing-progress" data-status={status==='failed'?'warning':undefined}>
    <div className="reprocessing-progress-heading" role="status">{active(status)&&<span className="scan-spinner" aria-hidden="true"/>}<strong>{status==='queued'?uiText("Queued for reprocessing"):status==='running'?uiText("Reprocessing source…"):failed?uiText("Partial revision"):status==='failed'?uiText("Processing failed"):status==='interrupted'?uiText("Processing interrupted"):uiText("Processing complete")}</strong><span>{report.chunksCompleted} / {report.chunksTotal}{" " + uiText("excerpts completed")}</span></div>
    <progress aria-label={uiText("Reprocessing progress")} max={Math.max(1,report.chunksTotal)} value={report.chunksCompleted}/>
    {active(status)&&<small>{estimate}</small>}
    {report.error&&<div className="reprocessing-failure" role="alert"><strong>{uiText("Processing stopped")}</strong><p>{report.error}</p>{configurationFailure(revision)?<p>{uiText("Check the model, supported reasoning and provider access in Settings → Intelligence before retrying. Completed suggestions remain available for review.")}</p>:<p>{uiText("Completed excerpts and review decisions are retained. Resuming processes only unfinished excerpts.")}</p>}</div>}
    {report.excerpts?.some(excerpt=>excerpt.outcomeUncertain)&&<p className="reprocessing-outcome">{uiText("The provider may have processed an unfinished request. It was not retried automatically. Resuming may send that excerpt again and incur another charge.")}</p>}
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
  const excerpts=report.excerpts??Array.from({length:report.chunksTotal},(_,index)=>({index,status:completed.has(index)?'completed':'pending',attempts:null,startPage:null,endPage:null,error:undefined,errorCode:undefined,history:undefined,durationMs:0}));
  return <details className="reprocessing-ledger" open={partial(revision)||undefined}><DisclosureSummary>{uiText("Excerpt coverage")} · {report.chunksCompleted} / {report.chunksTotal}</DisclosureSummary><ol aria-label={uiText("Excerpt processing ledger")}>{excerpts.map(excerpt=><li key={excerpt.index} data-excerpt-status={excerpt.status}><div><strong>{uiText("Excerpt {value0}",{value0:excerpt.index+1})}</strong>{excerpt.startPage&&<span>{excerpt.endPage&&excerpt.endPage!==excerpt.startPage?uiText("Pages {value0}–{value1}",{value0:excerpt.startPage,value1:excerpt.endPage}):uiText("Page {value0}",{value0:excerpt.startPage})}</span>}<span>{uiText(excerptLabel(excerpt.status))}</span><span>{excerpt.attempts===null?uiText("Attempts unavailable (legacy revision)"):uiText("Attempts: {value0}",{value0:excerpt.attempts})}</span><ExcerptConfiguration history={excerpt.history}/>{excerpt.durationMs>0&&<span>{uiText("{value0} seconds",{value0:(excerpt.durationMs/1000).toFixed(1)})}</span>}</div>{excerpt.error&&<p>{excerpt.error}{excerpt.errorCode&&<small> · {excerpt.errorCode}</small>}</p>}</li>)}</ol></details>;
}
function Report({revision}:{revision:SourceReprocessingRevision}){
  const report=revision.report,excludedMessages=report.diagnostics.filter(message=>message.includes(': excluded from review — ')),excluded=excludedMessages.length,observations=report.diagnostics.filter(message=>!message.includes(': excluded from review — ')),processingErrors=(report.excerpts??[]).filter(excerpt=>excerpt.error),token=(n:number|null)=>n===null?'Unavailable':n.toLocaleString(getLocale());
  return <details className="reprocessing-report"><DisclosureSummary>{uiText("Processing report")}</DisclosureSummary>
    {report.usageIncomplete&&<p className="reprocessing-warning">{uiText("Token totals are incomplete: some attempts did not report usage. Displayed counts include only reported usage.")}</p>}
    <dl><dt>{uiText("Current session model / reasoning")}</dt><dd>{report.model||uiText("Not started")} / {report.reasoningEffort}</dd><dt>{uiText("Auto-accept threshold")}</dt><dd>{revision.acceptanceMode==='review_all'||revision.acceptanceThreshold===undefined?uiText("Manual review for all edits"):`${Math.round(revision.acceptanceThreshold*100)}% · ${revision.acceptanceMode==='safe_formatting'?'eligible formatting only':'legacy confidence policy'}`}</dd><dt>{uiText("Processing coverage")}</dt><dd>{report.chunksCompleted} / {report.chunksTotal}{" " + uiText("chunks ·") + " "}{report.charactersReviewed.toLocaleString(getLocale())} / {report.charactersTotal.toLocaleString(getLocale())}{" " + uiText("characters")}</dd><dt>{uiText("Input / output tokens")}</dt><dd>{token(report.inputTokens)} / {token(report.outputTokens)}</dd><dt>{uiText("Reasoning / cached input tokens")}</dt><dd>{token(report.reasoningTokens)} / {token(report.cachedInputTokens)}</dd><dt>{uiText("Duration")}</dt><dd>{report.durationMs===null?(revision.status==='queued'?uiText("Not started"):revision.status==='running'?uiText("In progress"):uiText("Unavailable")):uiText("{value0} seconds",{value0: (report.durationMs/1000).toFixed(1)})}</dd><dt>{uiText("Prompt version")}</dt><dd>{report.promptVersion}</dd><dt>{uiText("Created")}</dt><dd>{new Date(revision.createdAt).toLocaleString(getLocale())}</dd></dl>
    <p>{uiText("Coverage measures text sent for review. It does not certify transcription accuracy or completeness.")}</p>
    {revision.instructions&&<p><strong>{uiText("Your instructions:")}</strong> {revision.instructions}</p>}
    {excluded>0&&<p className="reprocessing-warning">{excluded}{" " + uiText("AI") + " "}{excluded===1?uiText("suggestion was"):uiText("suggestions were")}{" " + uiText("excluded because they could not be safely matched or applied. Valid suggestions remain available for review. See excluded suggestions for the reasons.")}</p>}
    {(report.error||processingErrors.length>0)&&<details><DisclosureSummary>{uiText("Processing errors")}</DisclosureSummary>{report.error&&<p>{report.error}</p>}<ul>{processingErrors.map(excerpt=><li key={excerpt.index}>{uiText("Excerpt {value0}",{value0:excerpt.index+1})}: {excerpt.error} {excerpt.errorCode&&<code>{excerpt.errorCode}</code>}</li>)}</ul></details>}
    {excluded>0&&<details><DisclosureSummary>{uiText("Excluded suggestions")} ({excluded})</DisclosureSummary><ul>{excludedMessages.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}
    {observations.length>0&&<details><DisclosureSummary>{uiText("Editorial observations")}</DisclosureSummary><ul>{observations.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}
    {!!report.validationDiagnostics?.length&&<details><DisclosureSummary>{uiText("Local checks (")}{report.validationDiagnostics.length})</DisclosureSummary><ul>{report.validationDiagnostics.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}
    <details><DisclosureSummary>{uiText("Page structure and source metadata")}</DisclosureSummary><pre>{JSON.stringify({source:revision.reprocessed.document.source,physical:revision.reprocessed.document.physical,processing:revision.reprocessed.document.processing},null,2)}</pre></details>
    <div className="reprocessing-actions"><button className="button small" onClick={()=>exportJSON(revision,`source-revision-${revision.id}.json`)}>{uiText("Export provenance + report")}</button><button className="button small" onClick={()=>exportVariant(revision,'original')}>{uiText("Original JSON")}</button><button className="button small" onClick={()=>exportVariant(revision,'reprocessed')}>{uiText("Reprocessed JSON")}</button></div>
  </details>;
}
export function SourceReprocessing({vaultId,fileId,visible,onShow,onOriginal,onCompare}:Props){
  const destination=useContext(ReviewDestination);
  const reviewRun=destination?.category==='editorial'&&destination.fileId===fileId?destination.runId:undefined;
  useEffect(()=>{if(reviewRun){setRevisionId(reviewRun);setTab('review');}},[reviewRun]);
  const [summaries,setSummaries]=useState<SourceReprocessingSummary[]>([]),[revisionId,setRevisionId]=useState(''),[revision,setRevision]=useState<SourceReprocessingRevision|null>(null),[prompt,setPrompt]=useState(false),[instructions,setInstructions]=useState(''),[acceptanceThreshold,setAcceptanceThreshold]=useState('90'),[acceptanceMode,setAcceptanceMode]=useState<'review_all'|'safe_formatting'>('review_all'),[filter,setFilter]=useState<'all'|'pending'|'accepted'|'rejected'>('pending'),[comparisonLayout,setComparisonLayout]=useState<ComparisonLayout>('auto'),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0),[tab,setTab]=useState<'read'|'review'>('read');
  const defaultTabRevision=useRef('');
  useEffect(()=>{if(!revision||active(revision.status)||defaultTabRevision.current===revision.id)return;defaultTabRevision.current=revision.id;setTab(reviewRun===revision.id||revision.patches.some(patch=>patch.decision==='pending')?'review':'read');},[revision,reviewRun]);
  const [configuration,setConfiguration]=useState<IntelligencePreferences|null>(null),[configurationError,setConfigurationError]=useState('');
  useEffect(()=>{if(!prompt)return;const controller=new AbortController();setConfiguration(null);setConfigurationError('');void request<IntelligencePreferences>('intelligence','GET',undefined,undefined,controller.signal).then(value=>{if(!controller.signal.aborted){if(supportedIntelligencePreferences(value))setConfiguration(value);else setConfigurationError('Choose a supported model and reasoning in Settings → Intelligence.');}}).catch(()=>{if(!controller.signal.aborted)setConfigurationError('Could not load the AI configuration. Reopen this form to retry.');});return()=>controller.abort();},[prompt]);
  const actionRunning=useRef(false);
  function beginAction(){if(actionRunning.current)return false;actionRunning.current=true;setBusy(true);setError('');return true;}
  function finishAction(){actionRunning.current=false;setBusy(false);}
  useEffect(()=>setSelected([]),[revisionId]);
  const route=`source-files/${encodeURIComponent(fileId)}/reprocessing`;
  useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function refresh(){try{const items=await request<SourceReprocessingSummary[]>(route,'GET',undefined,vaultId,controller.signal);if(controller.signal.aborted)return;setSummaries(items);setRevisionId(id=>id||items[0]?.id||'');if(items.some(item=>active(item.status)))timer=setTimeout(()=>void refresh(),2500);}catch(cause){if(!controller.signal.aborted)setError(String(cause));}}
    void refresh();return()=>{controller.abort();clearTimeout(timer);};
  },[route,vaultId,reload]);
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
  },[route,vaultId,revisionId,reload]);
  const running=summaries.some(item=>active(item.status))||(revision!==null&&active(revision.status)),stale=revision?.stale,pending=revision?.patches.filter(p=>p.decision==='pending').length??0;
  const revisionOptions=revision&&!summaries.some(item=>item.id===revision.id)?[revision,...summaries]:summaries;
  async function start(){if(!configuration||!beginAction())return;try{const value=await request<SourceReprocessingRevision>(route,'POST',{instructions,acceptanceMode,acceptanceThreshold:Number(acceptanceThreshold)/100},vaultId);setRevisionId(value.id);setRevision(value);setPrompt(false);setReload(n=>n+1);onShow();}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}}
  async function decide(patch:SourceEditorialPatch,decision:'accepted'|'rejected'|'pending',replacement?:string){if(!revision||!beginAction())return;try{const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revision.id)}/review`,'POST',{updatedAt:revision.updatedAt,decisions:[{patchId:patch.id,decision,...(replacement!==undefined?{replacement}:{})}]},vaultId);setRevision(value);setSelected(ids=>ids.filter(id=>id!==patch.id));setReload(n=>n+1);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}}
  async function control(action:'cancel'|'resume'){
    if(!revision||!beginAction())return;
    try{const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revision.id)}/${action}`,'POST',{},vaultId);setRevision(value);setReload(n=>n+1);}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}
  }
  async function decideSelected(decision:'accepted'|'rejected'){
    if(!revision||!selected.length||!beginAction())return;
    try{const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revision.id)}/review`,'POST',{updatedAt:revision.updatedAt,decisions:selected.map(patchId=>({patchId,decision}))},vaultId);setRevision(value);setSelected([]);setReload(n=>n+1);}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{finishAction();}
  }
  const shownPatches=revision?.patches.filter(patch=>filter==='all'||patch.decision===filter)??[];
  const reviewFilters=['pending','accepted','rejected','all'] as const;
  const reviewLabels={pending:'Pending',accepted:'Accepted',rejected:'Rejected',all:'All changes'};
  const emptyReviewMessages={pending:'No pending changes to review.',accepted:'No accepted changes yet.',rejected:'No rejected changes. Rejected suggestions keep the original text.',all:'No editorial changes recorded.'};
  return <section className="source-reprocessing" aria-label={uiText("Beta source reprocessing")}>
    <div className="reprocessing-bar"><div className="reprocessing-switch" aria-label={uiText("Processed version")}><button type="button" aria-pressed={!visible} onClick={()=>onOriginal()}>{uiText("Original processed")}</button><button type="button" aria-pressed={visible} onClick={onShow}>{uiText(revision&&partial(revision)?"Partial revision":"Editorial revision") + " "}<span>{uiText("Beta")}</span></button></div><button type="button" className="button small reprocessing-loading-button" aria-busy={running} disabled={busy||running} onClick={()=>{setPrompt(true);onShow();}}>{running&&<span className="scan-spinner" aria-hidden="true"/>}{running?uiText("Reprocessing…"):uiText("Reprocess with AI")}</button></div>
    {error&&<p className="dialog-error" role="alert">{error} <button onClick={()=>{setError('');setReload(n=>n+1);}}>{uiText("Refresh")}</button></p>}
    {visible&&<><p className="reprocessing-hint">{uiText("An editorial reading version. Original processed Markdown remains canonical for citations. Review all changes by default. Optional automatic acceptance is limited to verified formatting changes; wording, citations, deletions, and structural changes require review.")}</p>
      {prompt&&<form className="reprocessing-prompt" onSubmit={e=>{e.preventDefault();void start();}}><h3>{uiText("Re-edit this source") + " "}<span>{uiText("Beta")}</span></h3><p>{uiText("Review OCR, line breaks, footnotes, page apparatus, foreign-language citations, metadata and math while preserving source meaning and page provenance.")}</p><div className="reprocessing-configuration" role="status">{configuration?<><strong>{intelligenceModels.find(model=>model.id===configuration.model)?.label??configuration.model} · {configuration.reasoningEffort} {uiText("reasoning")}</strong><p>{uiText("Supported reasoning:")} {intelligenceModels.find(model=>model.id===configuration.model)?.efforts.join(', ')}</p></>:configurationError?<p role="alert">{configurationError}</p>:uiText("Loading AI configuration…")}</div><label>{uiText("Review policy")}<select aria-label={uiText("Review policy")} value={acceptanceMode} onChange={event=>setAcceptanceMode(event.target.value as typeof acceptanceMode)}><option value="review_all">{uiText("Review every change")}</option><option value="safe_formatting">{uiText("Automatically accept safe formatting")}</option></select></label>{acceptanceMode==='safe_formatting'&&<><label>{uiText("Auto-accept confidence threshold (%)")}<input type="number" min="0" max="100" step="1" required value={acceptanceThreshold} onChange={e=>setAcceptanceThreshold(e.target.value)}/></label><p>{uiText("Only formatting changes that pass preservation checks and meet this confidence can be accepted automatically. All other edits remain pending.")}</p></>}<label>{uiText("Editorial guidance (optional)")}<textarea autoFocus value={instructions} maxLength={4000} onChange={e=>setInstructions(e.target.value)} placeholder={uiText("For example: preserve Greek quotations; check ambiguous footnote numbering carefully.")}/></label><div className="reprocessing-actions"><button className="button primary reprocessing-loading-button" aria-busy={busy} disabled={busy||running||!configuration} type="submit">{busy&&<span className="scan-spinner" aria-hidden="true"/>}{busy?uiText("Starting…"):uiText("Start reprocessing")}</button><button className="button" disabled={busy} type="button" onClick={()=>setPrompt(false)}>{uiText("Cancel")}</button></div></form>}
      {revisionOptions.length>0&&<label className="reprocessing-revision-picker">{uiText("Revision") + " "}<select disabled={busy} value={revisionId} onChange={e=>setRevisionId(e.target.value)}>{revisionOptions.map(item=><option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString(getLocale())} · {uiText(partial(item)?"Partial revision":item.status)}</option>)}</select></label>}
      {!revision&&!prompt&&<p role="status">{revisionId?uiText("Loading revision…"):uiText("Create a beta revision to improve reading quality and review editorial suggestions.")}</p>}
      {revision&&<>{stale&&<p className="reprocessing-warning" role="alert">{uiText("The canonical source has changed. This revision is preserved for comparison; start a new run before reviewing changes.")}</p>}
        <ReprocessingProgress key={revision.id} revision={revision}/>
        <ExcerptLedger revision={revision}/>
        <p className="reprocessing-status" role="status">{uiText("Editorial decisions")} · {pending}{" " + uiText("pending ·") + " "}{revision.patches.filter(patch=>patch.decision==='accepted').length}{" " + uiText("accepted ·") + " "}{revision.patches.filter(patch=>patch.decision==='rejected').length}{" " + uiText("kept original")}</p>
        {active(revision.status)&&<><button type="button" className="button small" disabled={busy} onClick={()=>void control('cancel')}>{uiText("Stop and keep progress")}</button></>}
        {['failed','interrupted'].includes(revision.status)&&!stale&&<button type="button" className="button small" disabled={busy||running} onClick={()=>void control('resume')}>{uiText(configurationFailure(revision)?"Retry after configuration repair":revision.report.excerpts?.some(excerpt=>excerpt.status==='failed')?"Retry failed and remaining excerpts":"Resume remaining excerpts")}</button>}
        <Report revision={revision}/>
        <div className="reprocessing-tabs"><button aria-pressed={tab==='read'} onClick={()=>setTab('read')}>{uiText(partial(revision)?"Read partial revision":"Read revision")}</button><button aria-pressed={tab==='review'} onClick={()=>setTab('review')}>{uiText("Review changes (")}{revision.patches.length})</button></div>
        {tab==='read'?<RevisionDocument revision={revision}/>:<div className="reprocessing-reviews">
          <div className="reprocessing-tabs reprocessing-review-filters" role="group" aria-label={uiText("Review status")}>
            {reviewFilters.map(value=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>{setFilter(value);setSelected([]);}}>{reviewLabels[value]} <span className="reprocessing-filter-count">{value==='all'?revision.patches.length:revision.patches.filter(patch=>patch.decision===value).length}</span></button>)}
          </div>
          <div className="reprocessing-actions reprocessing-review-toolbar">
            <label className="reprocessing-layout-picker">{uiText("Comparison") + " "}<select aria-label={uiText("Comparison layout")} value={comparisonLayout} onChange={event=>setComparisonLayout(event.target.value as ComparisonLayout)}><option value="auto">{uiText("Auto (unified on narrow screens)")}</option><option value="split">{uiText("Side by side")}</option><option value="unified">{uiText("Unified")}</option></select></label>
            <button className="button small" disabled={!selected.length||busy||!!stale||active(revision.status)} onClick={()=>void decideSelected('accepted')}>{uiText("Accept selected (")}{selected.length})</button><button className="button small" disabled={!selected.length||busy||!!stale||active(revision.status)} onClick={()=>void decideSelected('rejected')}>{uiText("Keep original for selected")}</button>
          </div>
          {filter==='rejected'&&shownPatches.length>0&&<p className="reprocessing-hint">{uiText("These suggestions were rejected. The original text is kept in the reading version.")}</p>}
          {!shownPatches.length&&<p role="status">{emptyReviewMessages[filter]}</p>}
          {shownPatches.map(patch=><PatchReview draftKey={JSON.stringify([vaultId,fileId,revision.id,patch.id])} key={`${revision.id}:${patch.id}`} patch={patch} layout={comparisonLayout} onCompare={onCompare} selected={selected.includes(patch.id)} onSelect={checked=>setSelected(ids=>checked?[...ids,patch.id]:ids.filter(id=>id!==patch.id))} disabled={busy||!!stale||active(revision.status)} onDecision={decide}/>)}
        </div>}
      </>}
    </>}
  </section>;
}
