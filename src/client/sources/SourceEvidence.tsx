import {Select} from '../components/Select';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {useEffect,useState} from 'react';
import {request} from '../api';
import {DisclosureSummary} from '../components/DisclosureSummary';

interface EvidenceRegion {bounds:number[];reason:string;status:string;recoveredText?:string;confidence?:number;candidates?:{text:string;confidence?:number}[]}
interface EvidencePage {page:number;method:string;text:string;findings?:string[];coordinateSystem?:string;coverage?:{detectedRegions:number;unmatchedRegions:number;retriedRegions:number;recoveredRegions:number;unresolvedRegions:number};regions?:EvidenceRegion[]}
interface Evidence {
 ingestion?:{provider:'openai'|'gemini';model:string;page?:number;text:string;uncertainty?:string[];coverage?:string;independentEvidence?:string};
 originalAvailable?:boolean;originalHash?:string;originalBytes?:number;admittedBytes?:number;findings?:string[];
 flattening?:{reason?:string;discardedFeatures?:string[];compression?:string;durationMs?:number;cacheHit?:boolean};
 rawExtraction?:{ocrPages?:number;pageEvidence?:EvidencePage[];unresolvedOutlines?:string[]};
}
export function SourceEvidence({vaultId,fileId,pageCount,page,onPage}:{vaultId:string;fileId:string;pageCount:number;page:number|null;onPage:(page:number|null)=>void}){
 const [evidence,setEvidence]=useState<Evidence|null>(null),[error,setError]=useState(''),[imageFailed,setImageFailed]=useState(false),[selectedRegion,setSelectedRegion]=useState<number|null>(null);
 useEffect(()=>{setEvidence(null);setError('');},[vaultId,fileId]);
 useEffect(()=>{
  if(page===null)return;
  setEvidence(null);setError('');
  const controller=new AbortController();
  void request<Evidence>(`source-files/${encodeURIComponent(fileId)}/evidence?page=${page}`,'GET',undefined,vaultId,controller.signal).then(value=>{if(!controller.signal.aborted)setEvidence(value);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
  return()=>controller.abort();
 },[vaultId,fileId,page]);
 useEffect(()=>{setImageFailed(false);setSelectedRegion(null);},[vaultId,fileId,page]);
 const raw=evidence?.rawExtraction?.pageEvidence?.find(item=>item.page===page);
 const transcription=evidence?.ingestion;
 const region=selectedRegion===null?undefined:raw?.regions?.[selectedRegion];
 const box=region?.bounds;
 const validBox=raw?.coordinateSystem==='normalized-bottom-left'&&box?.length===4&&box.every(Number.isFinite)&&box[0]>=0&&box[1]>=0&&box[2]>0&&box[3]>0&&box[0]+box[2]<=1.001&&box[1]+box[3]<=1.001;
 const findings=[...(evidence?.findings??[]),...(evidence?.rawExtraction?.unresolvedOutlines??[]),...(raw?.findings??[])];
 return <details className="source-evidence" open={page!==null} onToggle={event=>{if(event.currentTarget.open&&page===null)onPage(1);else if(!event.currentTarget.open&&page!==null)onPage(null);}}>
  <DisclosureSummary>{uiText("Compare with PDF and extraction evidence")}</DisclosureSummary>
  {page!==null&&<>
   <p>{uiText(transcription?'The page image comes from the safe viewing copy. Provider transcription is the initial baseline; it is not native extraction or independent OCR verification.':'The page image comes from the safe viewing copy. Raw extraction is shown before text formatting or AI edits.')}</p>
   <label>{uiText("Physical page") + " "}<Select aria-label={uiText("Evidence page")} value={page} onChange={event=>onPage(Number(event.target.value))}>{Array.from({length:pageCount},(_,i)=><option key={i+1} value={i+1}>{i+1}{" " + uiText("of") + " "}{pageCount}</option>)}</Select></label>
   {error&&<p role="alert">{error}</p>}
   {evidence&&<><p>{evidence.originalAvailable?uiText("Original file preserved separately."):uiText(transcription?'Original PDF evidence is unavailable in this vault or restored backup. The preserved transcription remains readable.':'Original file unavailable for this legacy import; re-upload to recover it.')} {evidence.rawExtraction?.ocrPages!==undefined&&`${evidence.rawExtraction.ocrPages} pages used OCR.`}</p>
    {evidence.flattening&&<p>{uiText(transcription?'A separate viewing copy was reconstructed for safety. Provider transcription uses the admitted PDF, with the original preserved separately when available.':'A separate viewing copy was flattened for safety. Text and structure are extracted from the preserved original when available.')}</p>}
    {!!findings.length&&<ul className="reprocessing-warning">{findings.map((finding,i)=><li key={i}>{finding}</li>)}</ul>}
    {raw?.coverage&&<p>{uiText("OCR region check:") + " "}{raw.coverage.detectedRegions}{" " + uiText("detected ·") + " "}{raw.coverage.retriedRegions}{" " + uiText("retried ·") + " "}{raw.coverage.recoveredRegions}{" " + uiText("recovered ·") + " "}{raw.coverage.unresolvedRegions}{" " + uiText("unresolved. Region detection can also miss text; this is not a completeness guarantee.")}</p>}
    {!!raw?.regions?.length&&<details><DisclosureSummary>{uiText("Review OCR regions (")}{raw.regions.length})</DisclosureSummary><ul className="source-evidence-regions">{raw.regions.map((item,i)=><li key={i}><button type="button" aria-pressed={selectedRegion===i} onClick={()=>setSelectedRegion(selectedRegion===i?null:i)}>{uiText("Region") + " "}{i+1}: {item.status}</button> <span>{item.reason==='unmatched-detected-text'?uiText("Detected text was missing from the first OCR pass."):item.reason==='low-confidence'?uiText("OCR confidence was low."):item.reason}</span>{item.recoveredText&&<blockquote>{item.recoveredText}</blockquote>}{item.status!=='recovered'&&!!item.candidates?.length&&<p>{uiText("Retry readings (not applied):") + " "}{[...new Set(item.candidates.map(candidate=>candidate.text))].slice(0,3).join(' · ')}</p>}</li>)}</ul></details>}
   </>}
   <div className="source-evidence-comparison"><div>{imageFailed?<p role="alert">{uiText("The page image could not load. Change pages to retry, or download the safe PDF.")}</p>:<div className="source-evidence-image"><img src={`/api/source-files/${encodeURIComponent(fileId)}/page-image/${page}?vault=${encodeURIComponent(vaultId)}`} alt={uiText("Source PDF physical page {value0}",{value0: page})} onError={()=>setImageFailed(true)}/>{validBox&&<span className="source-evidence-region-box" role="img" aria-label={uiText("Highlighted OCR region {value0}",{value0: selectedRegion!+1})} style={{left:`${box![0]*100}%`,top:`${(1-box![1]-box![3])*100}%`,width:`${box![2]*100}%`,height:`${box![3]*100}%`}}/>}</div>}</div><div><h4>{transcription?uiText('Provider transcription'):uiText("Raw") + " "}{!transcription&&(raw?.method==='native'?uiText("embedded text"):raw?.method==='ocr'?uiText("OCR text"):raw?.method==='mixed'?uiText("native and OCR text"):uiText("extraction"))}</h4>{transcription?<><p>{transcription.provider==='openai'?'OpenAI':'Gemini'} · {transcription.model}</p><pre>{transcription.text}</pre>{!!transcription.uncertainty?.length&&<ul>{transcription.uncertainty.map((item,index)=><li key={index}>{item}</li>)}</ul>}<p>{uiText('Page accounting has been checked. Transcription accuracy still requires evidence inspection or user review.')}</p></>:raw?<pre>{raw.text}</pre>:<p>{evidence?uiText("Raw page evidence is unavailable for this import."):uiText("Loading extraction evidence…")}</p>}</div></div>
   {evidence?.originalHash&&<details><DisclosureSummary>{uiText("Preservation details")}</DisclosureSummary><p>{uiText("Original SHA-256:") + " "}<code>{evidence.originalHash}</code></p><p>{uiText("Original:") + " "}{evidence.originalBytes?.toLocaleString(getLocale())}{" " + uiText("bytes · Viewing copy:") + " "}{evidence.admittedBytes?.toLocaleString(getLocale())}{" " + uiText("bytes")}</p>{evidence.flattening?.compression&&<p>{uiText("Viewing compression:") + " "}{evidence.flattening.compression}. {evidence.flattening.cacheHit?uiText("Reused a verified viewing copy."):evidence.flattening.durationMs!==undefined?uiText("Prepared in {value0} seconds.",{value0: (evidence.flattening.durationMs/1000).toFixed(2)}):''}</p>}{evidence.flattening?.discardedFeatures&&<p>{uiText("Removed from the viewing copy:") + " "}{evidence.flattening.discardedFeatures.join(', ')}.</p>}</details>}
  </>}
 </details>;
}
