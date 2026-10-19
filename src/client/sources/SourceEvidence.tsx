import {useEffect,useState} from 'react';
import {request} from '../api';
import {DisclosureSummary} from '../components/DisclosureSummary';

interface EvidencePage {page:number;method:string;text:string;findings?:string[]}
interface Evidence {
 originalAvailable?:boolean;originalHash?:string;originalBytes?:number;admittedBytes?:number;findings?:string[];
 flattening?:{reason?:string;discardedFeatures?:string[]};
 rawExtraction?:{ocrPages?:number;pageEvidence?:EvidencePage[];unresolvedOutlines?:string[]};
}
export function SourceEvidence({vaultId,fileId,pageCount,page,onPage}:{vaultId:string;fileId:string;pageCount:number;page:number|null;onPage:(page:number|null)=>void}){
 const [evidence,setEvidence]=useState<Evidence|null>(null),[error,setError]=useState(''),[imageFailed,setImageFailed]=useState(false);
 useEffect(()=>{setEvidence(null);setError('');},[vaultId,fileId]);
 useEffect(()=>{
  if(page===null||evidence)return;
  const controller=new AbortController();
  void request<Evidence>(`source-files/${encodeURIComponent(fileId)}/evidence`,'GET',undefined,vaultId,controller.signal).then(value=>{if(!controller.signal.aborted)setEvidence(value);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
  return()=>controller.abort();
 },[vaultId,fileId,page,evidence]);
 useEffect(()=>setImageFailed(false),[vaultId,fileId,page]);
 const raw=evidence?.rawExtraction?.pageEvidence?.find(item=>item.page===page);
 const findings=[...(evidence?.findings??[]),...(evidence?.rawExtraction?.unresolvedOutlines??[]),...(raw?.findings??[])];
 return <details className="source-evidence" open={page!==null} onToggle={event=>{if(event.currentTarget.open&&page===null)onPage(1);else if(!event.currentTarget.open&&page!==null)onPage(null);}}>
  <DisclosureSummary>Compare with PDF and extraction evidence</DisclosureSummary>
  {page!==null&&<>
   <p>The page image comes from the safe viewing copy. Raw extraction is shown before text formatting or AI edits.</p>
   <label>Physical page <select aria-label="Evidence page" value={page} onChange={event=>onPage(Number(event.target.value))}>{Array.from({length:pageCount},(_,i)=><option key={i+1} value={i+1}>{i+1} of {pageCount}</option>)}</select></label>
   {error&&<p role="alert">{error}</p>}
   {evidence&&<><p>{evidence.originalAvailable?'Original file preserved separately.':'Original file unavailable for this legacy import; re-upload to recover it.'} {evidence.rawExtraction?.ocrPages!==undefined&&`${evidence.rawExtraction.ocrPages} pages used OCR.`}</p>
    {evidence.flattening&&<p>A separate viewing copy was flattened for safety. Text and structure are extracted from the preserved original when available.</p>}
    {!!findings.length&&<ul className="reprocessing-warning">{findings.map((finding,i)=><li key={i}>{finding}</li>)}</ul>}
   </>}
   <div className="source-evidence-comparison"><div>{imageFailed?<p role="alert">The page image could not load. Change pages to retry, or download the safe PDF.</p>:<img src={`/api/source-files/${encodeURIComponent(fileId)}/page-image/${page}?vault=${encodeURIComponent(vaultId)}`} alt={`Source PDF physical page ${page}`} onError={()=>setImageFailed(true)}/>}</div><div><h4>Raw {raw?.method==='native'?'embedded text':raw?.method==='ocr'?'OCR text':'extraction'}</h4>{raw?<pre>{raw.text}</pre>:<p>{evidence?'Raw page evidence is unavailable for this import.':'Loading extraction evidence…'}</p>}</div></div>
   {evidence?.originalHash&&<details><DisclosureSummary>Preservation details</DisclosureSummary><p>Original SHA-256: <code>{evidence.originalHash}</code></p><p>Original: {evidence.originalBytes?.toLocaleString()} bytes · Viewing copy: {evidence.admittedBytes?.toLocaleString()} bytes</p>{evidence.flattening?.discardedFeatures&&<p>Removed from the viewing copy: {evidence.flattening.discardedFeatures.join(', ')}.</p>}</details>}
  </>}
 </details>;
}
