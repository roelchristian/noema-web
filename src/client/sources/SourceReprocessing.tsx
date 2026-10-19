import {useEffect,useState} from 'react';
import {sourceDocumentEntries,sourceNodeLocator} from '../../shared/source-document';
import type {SourceEditorialPatch,SourceReprocessingRevision,SourceReprocessingSummary} from '../../shared/source-reprocessing';
import {request} from '../api';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {SourceReaderText,SourceReaderInline} from './SourceReaderText';
import './source-reprocessing.css';

type Props={vaultId:string;fileId:string;visible:boolean;onShow:()=>void;onOriginal:(nodeId?:string)=>void};
const active=(status:string)=>status==='queued'||status==='running';
const label=(value:string)=>value.replaceAll('_',' ');
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
function RevisionDocument({revision,onOriginal}:{revision:SourceReprocessingRevision;onOriginal:(id?:string)=>void}){
  const entries=sourceDocumentEntries(revision.reprocessed.document).filter(({node})=>node.text!==undefined||node.title);
  return <article className="source-reader-document reprocessing-document" aria-label="Reprocessed source">
    {entries.map(({node,path})=><section key={node.id} className="reprocessing-passage">
      <button type="button" className="reprocessing-origin" onClick={()=>onOriginal(revision.stale?undefined:originalNode(revision,node.range.startOffset,node.id))} title="Open this passage in the canonical source">{sourceNodeLocator(path)??'Passage'} · Show original</button>
      {node.text===undefined?<h3><SourceReaderInline text={node.title??''} footnotePrefix={revision.id}/></h3>:<SourceReaderText text={node.text} kind={node.kind} footnotePrefix={revision.id}/>}
    </section>)}
    {!entries.length&&<SourceReaderText text={revision.reprocessed.text} footnotePrefix={revision.id}/>}
  </article>;
}
function PatchReview({patch,disabled,onDecision}:{patch:SourceEditorialPatch;disabled:boolean;onDecision:(patch:SourceEditorialPatch,decision:'accepted'|'rejected'|'pending',replacement?:string)=>Promise<void>}){
  const [editing,setEditing]=useState(false),[replacement,setReplacement]=useState(patch.userReplacement??patch.replacement);
  useEffect(()=>{if(!editing)setReplacement(patch.userReplacement??patch.replacement);},[patch.userReplacement,patch.replacement,editing]);
  return <details className="reprocessing-patch" open={patch.decision==='pending'?true:undefined}>
    <DisclosureSummary><span>{label(patch.category)} · {patch.decision}</span><small>{Math.round(patch.confidence*100)}% confidence</small></DisclosureSummary>
    <p>{patch.reason}</p><small>Original {patch.range.startPage?`page ${patch.range.startPage} · `:''}lines {patch.range.startLine}–{patch.range.endLine}</small>
    <div className="reprocessing-comparison"><div><h4>Original processed</h4><pre>{patch.original}</pre></div><div><h4>Suggested revision</h4>{editing?<textarea aria-label="Edit suggested replacement" value={replacement} onChange={e=>setReplacement(e.target.value)}/>:<pre>{(patch.userReplacement??patch.replacement)||'(Removed from reading text; preserved in provenance)'}</pre>}</div></div>
    <div className="reprocessing-actions"><button className="button small" disabled={disabled} onClick={()=>void onDecision(patch,'accepted',editing?replacement:undefined)}>Accept{editing?' edit':''}</button><button className="button small" disabled={disabled} onClick={()=>void onDecision(patch,'rejected')}>Keep original</button><button className="button small" disabled={disabled} onClick={()=>setEditing(value=>!value)}>{editing?'Cancel edit':'Edit suggestion'}</button>{patch.decision!=='pending'&&<button className="button small" disabled={disabled} onClick={()=>void onDecision(patch,'pending')}>Return to review</button>}</div>
  </details>;
}
function exportVariant(revision:SourceReprocessingRevision,variant:'original'|'reprocessed'){
  exportJSON({schemaVersion:1,revisionId:revision.id,fileId:revision.fileId,baseHash:revision.baseHash,variant,canonical:variant==='original',createdAt:revision.createdAt,updatedAt:revision.updatedAt,provenance:{original:`source-original-${revision.id}.json`,reprocessed:`source-reprocessed-${revision.id}.json`,fullRevision:`source-revision-${revision.id}.json`,nodeLinks:revision.nodeLinks??[],patches:revision.patches},...revision[variant]},`source-${variant}-${revision.id}.json`);
}
function ReprocessingProgress({revision}:{revision:SourceReprocessingRevision}){
  const {report,status}=revision;
  const [now,setNow]=useState(Date.now);
  const [sample,setSample]=useState({completed:report.chunksCompleted,at:Date.parse(revision.updatedAt)});
  useEffect(()=>{setSample(previous=>previous.completed===report.chunksCompleted?previous:{completed:report.chunksCompleted,at:Date.parse(revision.updatedAt)});},[report.chunksCompleted,revision.updatedAt]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const started=report.startedAt?Date.parse(report.startedAt):NaN;
  const remaining=sample.completed>0&&Number.isFinite(started)?(sample.at-started)/sample.completed*(report.chunksTotal-sample.completed)-(now-sample.at):NaN;
  const seconds=Math.max(1,Math.ceil(remaining/1000));
  const duration=seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;
  const estimate=status==='queued'?'Waiting to start':report.chunksCompleted>=report.chunksTotal&&report.chunksTotal>0?'Finishing up…':!Number.isFinite(remaining)?'Estimating time remaining after the first chunk…':remaining<=0?'Taking longer than estimated…':`Est. time remaining: ~${duration}`;
  return <div className="reprocessing-progress">
    <div className="reprocessing-progress-heading" role="status"><span className="scan-spinner" aria-hidden="true"/>{status==='queued'?'Queued for reprocessing':'Reprocessing source…'}<span>{report.chunksCompleted} / {report.chunksTotal} chunks</span></div>
    <progress aria-label="Reprocessing progress" max={Math.max(1,report.chunksTotal)} value={report.chunksCompleted}/>
    <small>{estimate}</small>
  </div>;
}
function Report({revision}:{revision:SourceReprocessingRevision}){
  const report=revision.report,excluded=report.diagnostics.filter(message=>message.includes(': excluded from review — ')).length,token=(n:number|null)=>n===null?'Unavailable':n.toLocaleString();
  return <details className="reprocessing-report"><DisclosureSummary>Processing report</DisclosureSummary>
    <dl><dt>Model / reasoning</dt><dd>{report.model||'Not started'} / {report.reasoningEffort}</dd><dt>Auto-accept threshold</dt><dd>{revision.acceptanceThreshold===undefined?'Manual review for all edits':`${Math.round(revision.acceptanceThreshold*100)}% confidence`}</dd><dt>Coverage</dt><dd>{report.chunksCompleted} / {report.chunksTotal} chunks · {report.charactersReviewed.toLocaleString()} / {report.charactersTotal.toLocaleString()} characters</dd><dt>Input / output tokens</dt><dd>{token(report.inputTokens)} / {token(report.outputTokens)}</dd><dt>Reasoning / cached input tokens</dt><dd>{token(report.reasoningTokens)} / {token(report.cachedInputTokens)}</dd><dt>Duration</dt><dd>{report.durationMs===null?(revision.status==='queued'?'Not started':revision.status==='running'?'In progress':'Unavailable'):`${(report.durationMs/1000).toFixed(1)} seconds`}</dd><dt>Prompt version</dt><dd>{report.promptVersion}</dd><dt>Created</dt><dd>{new Date(revision.createdAt).toLocaleString()}</dd></dl>
    {revision.instructions&&<p><strong>Your instructions:</strong> {revision.instructions}</p>}
    {report.error&&<p role="alert">{report.error}</p>}
    {excluded>0&&<p className="reprocessing-warning">{excluded} AI {excluded===1?'suggestion was':'suggestions were'} excluded because they could not be safely matched or applied. Valid suggestions remain available for review. See processing diagnostics for the reasons.</p>}
    {report.diagnostics.length>0&&<details><DisclosureSummary>Processing diagnostics</DisclosureSummary><ul>{report.diagnostics.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}
    {!!report.validationDiagnostics?.length&&<details><DisclosureSummary>Local checks ({report.validationDiagnostics.length})</DisclosureSummary><ul>{report.validationDiagnostics.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}
    <details><DisclosureSummary>Page structure and source metadata</DisclosureSummary><pre>{JSON.stringify({source:revision.reprocessed.document.source,physical:revision.reprocessed.document.physical,processing:revision.reprocessed.document.processing},null,2)}</pre></details>
    <div className="reprocessing-actions"><button className="button small" onClick={()=>exportJSON(revision,`source-revision-${revision.id}.json`)}>Export provenance + report</button><button className="button small" onClick={()=>exportVariant(revision,'original')}>Original JSON</button><button className="button small" onClick={()=>exportVariant(revision,'reprocessed')}>Reprocessed JSON</button></div>
  </details>;
}
export function SourceReprocessing({vaultId,fileId,visible,onShow,onOriginal}:Props){
  const [summaries,setSummaries]=useState<SourceReprocessingSummary[]>([]),[revisionId,setRevisionId]=useState(''),[revision,setRevision]=useState<SourceReprocessingRevision|null>(null),[prompt,setPrompt]=useState(false),[instructions,setInstructions]=useState(''),[acceptanceThreshold,setAcceptanceThreshold]=useState('90'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0),[tab,setTab]=useState<'read'|'review'>('read');
  const route=`source-files/${encodeURIComponent(fileId)}/reprocessing`;
  useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function refresh(){try{const items=await request<SourceReprocessingSummary[]>(route,'GET',undefined,vaultId,controller.signal);if(controller.signal.aborted)return;setSummaries(items);setRevisionId(id=>id||items[0]?.id||'');if(items.some(item=>active(item.status)))timer=setTimeout(()=>void refresh(),2500);}catch(cause){if(!controller.signal.aborted)setError(String(cause));}}
    void refresh();return()=>{controller.abort();clearTimeout(timer);};
  },[route,vaultId,reload]);
  useEffect(()=>{setRevision(current=>current?.id===revisionId?current:null);if(!revisionId)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function refresh(){try{const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revisionId)}`,'GET',undefined,vaultId,controller.signal);if(controller.signal.aborted)return;setRevision(value);if(active(value.status))timer=setTimeout(()=>void refresh(),2500);}catch(cause){if(!controller.signal.aborted)setError(String(cause));}}
    void refresh();return()=>{controller.abort();clearTimeout(timer);};
  },[route,vaultId,revisionId,reload]);
  const running=summaries.some(item=>active(item.status))||(revision!==null&&active(revision.status)),stale=revision?.stale,pending=revision?.patches.filter(p=>p.decision==='pending').length??0;
  const revisionOptions=revision&&!summaries.some(item=>item.id===revision.id)?[revision,...summaries]:summaries;
  async function start(){setBusy(true);setError('');try{const value=await request<SourceReprocessingRevision>(route,'POST',{instructions,acceptanceThreshold:Number(acceptanceThreshold)/100},vaultId);setRevisionId(value.id);setRevision(value);setPrompt(false);setReload(n=>n+1);onShow();}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}}
  async function decide(patch:SourceEditorialPatch,decision:'accepted'|'rejected'|'pending',replacement?:string){if(!revision)return;setBusy(true);setError('');try{const value=await request<SourceReprocessingRevision>(`${route}/${encodeURIComponent(revision.id)}/review`,'POST',{updatedAt:revision.updatedAt,decisions:[{patchId:patch.id,decision,...(replacement!==undefined?{replacement}:{})}]},vaultId);setRevision(value);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setBusy(false);}}
  return <section className="source-reprocessing" aria-label="Beta source reprocessing">
    <div className="reprocessing-bar"><div className="reprocessing-switch" aria-label="Processed version"><button type="button" aria-pressed={!visible} onClick={()=>onOriginal()}>Original processed</button><button type="button" aria-pressed={visible} onClick={onShow}>Reprocessed <span>Beta</span></button></div><button type="button" className="button small reprocessing-loading-button" aria-busy={running} disabled={busy||running} onClick={()=>{setPrompt(true);onShow();}}>{running&&<span className="scan-spinner" aria-hidden="true"/>}{running?'Reprocessing…':'Reprocess with AI'}</button></div>
    {error&&<p className="dialog-error" role="alert">{error} <button onClick={()=>{setError('');setReload(n=>n+1);}}>Refresh</button></p>}
    {visible&&<><p className="reprocessing-hint">An editorial reading version. Original processed Markdown remains canonical for citations. Edits meeting the confidence threshold are accepted automatically; review the remaining suggestions or reverse accepted changes.</p>
      {prompt&&<form className="reprocessing-prompt" onSubmit={e=>{e.preventDefault();void start();}}><h3>Re-edit this source <span>Beta</span></h3><p>Review OCR, line breaks, footnotes, page apparatus, foreign-language citations, metadata and math while preserving source meaning and page provenance. Reasoning: none.</p><label>Auto-accept confidence threshold (%)<input type="number" min="0" max="100" step="1" required value={acceptanceThreshold} onChange={e=>setAcceptanceThreshold(e.target.value)}/></label><p>Edits at or above this confidence are accepted automatically. Lower-confidence edits remain pending for review.</p><label>Editorial guidance (optional)<textarea autoFocus value={instructions} maxLength={4000} onChange={e=>setInstructions(e.target.value)} placeholder="For example: preserve Greek quotations; check ambiguous footnote numbering carefully."/></label><div className="reprocessing-actions"><button className="button primary reprocessing-loading-button" aria-busy={busy} disabled={busy||running} type="submit">{busy&&<span className="scan-spinner" aria-hidden="true"/>}{busy?'Starting…':'Start reprocessing'}</button><button className="button" disabled={busy} type="button" onClick={()=>setPrompt(false)}>Cancel</button></div></form>}
      {revisionOptions.length>0&&<label className="reprocessing-revision-picker">Revision <select disabled={busy} value={revisionId} onChange={e=>setRevisionId(e.target.value)}>{revisionOptions.map(item=><option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.status}</option>)}</select></label>}
      {!revision&&!prompt&&<p role="status">{revisionId?'Loading revision…':'Create a beta revision to improve reading quality and review editorial suggestions.'}</p>}
      {revision&&<>{stale&&<p className="reprocessing-warning" role="alert">The canonical source has changed. This revision is preserved for comparison; start a new run before reviewing changes.</p>}
        <p className="reprocessing-status" role="status">{label(revision.status)} · {revision.report.chunksCompleted}/{revision.report.chunksTotal} chunks · {pending} pending · {revision.patches.filter(patch=>patch.decision==='accepted').length} accepted · {revision.patches.filter(patch=>patch.decision==='rejected').length} kept original</p>
        {active(revision.status)&&<ReprocessingProgress key={revision.id} revision={revision}/> }
        <Report revision={revision}/>
        <div className="reprocessing-tabs"><button aria-pressed={tab==='read'} onClick={()=>setTab('read')}>Read revision</button><button aria-pressed={tab==='review'} onClick={()=>setTab('review')}>Review changes ({revision.patches.length})</button></div>
        {tab==='read'?<RevisionDocument revision={revision} onOriginal={onOriginal}/>:<div className="reprocessing-reviews">{!revision.patches.length&&<p>No editorial changes recorded.</p>}{revision.patches.map(patch=><PatchReview key={`${revision.id}:${patch.id}`} patch={patch} disabled={busy||!!stale||active(revision.status)} onDecision={decide}/>)}</div>}
      </>}
    </>}
  </section>;
}
