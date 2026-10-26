import {useEffect,useState} from 'react';
import type {SourceIngestionOptions,SourceIngestionRoute} from '../../shared/source-ingestion';
import {request} from '../api';
import {documentModel} from '../../shared/document-models';
import {Select} from '../components/Select';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {t as uiText} from '../i18n';

export interface PdfProcessingCapabilities {
 enabled:boolean;localExtraction:boolean;
 providers:{provider:'openai'|'gemini';available:boolean;reason?:string;models:{id:string;label?:string;available?:boolean}[]}[];
}
export const initialPdfIngestionOptions:SourceIngestionOptions={route:'local',model:null,depth:'balanced',reviewPolicy:'verified',containsMath:false,guidance:'',transmissionConsent:false,budget:{maxRequests:64,maxOutputTokens:32000,maxCostUsd:null}};
const providerLabels={local:'Local extraction',openai:'OpenAI PDF enrichment',gemini:'Gemini PDF enrichment'};
/** Only the server capability gate exposes API routes. Consent is never remembered. */
export function SourcePdfProcessing({vaultId,value,onChange,onReady,onEnabled,disabled}:{vaultId:string;value:SourceIngestionOptions;onChange:(value:SourceIngestionOptions)=>void;onReady:(ready:boolean)=>void;onEnabled?:(enabled:boolean)=>void;disabled:boolean}){
 const [capabilities,setCapabilities]=useState<PdfProcessingCapabilities|null>(null),[checked,setChecked]=useState(false);
 useEffect(()=>{const controller=new AbortController();setChecked(false);void request<PdfProcessingCapabilities>('source-ingestion/capabilities','GET',undefined,vaultId,controller.signal).then(value=>{if(!controller.signal.aborted)setCapabilities(value);}).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setChecked(true);});return()=>controller.abort();},[vaultId]);
 useEffect(()=>{if(!capabilities?.enabled)return;let saved:string|null=null;try{saved=localStorage.getItem(`noema:pdf-route:${vaultId}`);}catch{}if(saved==='openai'||saved==='gemini'){const provider=capabilities.providers.find(item=>item.provider===saved);const model=provider?.models.find(item=>item.available!==false);if(provider?.available&&model)onChange({...value,route:saved,model:model.id,transmissionConsent:false,budget:{...value.budget,maxOutputTokens:Math.min(value.budget.maxOutputTokens,Math.floor((documentModel(model.id)?.maxOutputTokens??40000)*0.8))}});}},[capabilities,vaultId]);
 const maxOutputTokens=Math.floor((documentModel(value.model??'')?.maxOutputTokens??40000)*0.8);
 useEffect(()=>{onEnabled?.(!!capabilities?.enabled);},[capabilities?.enabled,onEnabled]);
 const selected=capabilities?.providers.find(item=>item.provider===value.route);
 const ready=checked&&(!capabilities?.enabled||value.route==='local'?capabilities?.localExtraction!==false:!!selected?.available&&!!value.model&&selected.models.some(model=>model.id===value.model&&model.available!==false)&&value.transmissionConsent);
 useEffect(()=>{onReady(ready);},[ready,onReady]);
 if(!checked)return <p role="status" className="section-hint">{uiText('Checking PDF processing capabilities…')}</p>;
 if(!capabilities?.enabled)return null;
 function choose(route:SourceIngestionRoute){const provider=capabilities!.providers.find(item=>item.provider===route),model=provider?.models.find(model=>model.available!==false)?.id??null;onChange({...value,route,model,transmissionConsent:false,budget:{...value.budget,maxOutputTokens:Math.min(value.budget.maxOutputTokens,Math.floor((documentModel(model??'')?.maxOutputTokens??40000)*0.8))}});try{localStorage.setItem(`noema:pdf-route:${vaultId}`,route);}catch{}}
 return <fieldset disabled={disabled} className="source-pdf-processing"><legend>{uiText('PDF processing')}</legend>
  <label>{uiText('Processing route')}<Select aria-label={uiText('PDF processing')} value={value.route} onChange={event=>choose(event.target.value as SourceIngestionRoute)}>
   <option value="local" disabled={!capabilities.localExtraction}>{uiText(providerLabels.local)}</option>
   {(['openai','gemini'] as const).map(provider=><option key={provider} value={provider} disabled={!capabilities.providers.find(item=>item.provider===provider)?.available}>{uiText(providerLabels[provider])}</option>)}
  </Select></label>
  {!capabilities.localExtraction&&<p className="section-hint">{uiText('Local PDF extraction is unavailable on this server. Choose a configured PDF provider.')}</p>}
  {value.route!=='local'&&<>
   <p>{uiText('Document model:')} {value.model??uiText('No verified document model is available.')}</p>
   {!!selected?.reason&&<p>{selected.reason}</p>}
   <label>{uiText('Reconstruction depth')}<Select aria-label={uiText('Reconstruction depth')} value={value.depth} onChange={event=>onChange({...value,depth:event.target.value as SourceIngestionOptions['depth']})}>{(['light','balanced','deep'] as const).map(depth=><option key={depth} value={depth}>{uiText(depth==='light'?'Light':depth==='balanced'?'Balanced':'Deep')}</option>)}</Select></label>
   <p className="section-hint">{uiText('Every depth transcribes the whole document. Balanced reconstructs reading order and structure. Deep uses smaller page windows for dense material; unresolved readings remain available for review.')}</p>
   <label>{uiText('Review policy')}<Select aria-label={uiText('PDF review policy')} value={value.reviewPolicy} onChange={event=>onChange({...value,reviewPolicy:event.target.value as SourceIngestionOptions['reviewPolicy']})}><option value="verified">{uiText('Apply verified changes automatically')}</option><option value="review-all">{uiText('Review all changes')}</option></Select></label>
   <p className="section-hint">{uiText('The first transcription becomes the readable baseline. Uncertain corrections remain localized proposals for review.')}</p>
   <fieldset className="reprocessing-transmission-consent"><legend>{uiText('Provider transmission')}</legend><p>{uiText('This route sends the PDF itself, including page images, to')} {value.route==='openai'?'OpenAI':'Google Gemini'}. {uiText('Original-page input is required. Embedding settings are separate.')}</p><label><input type="checkbox" checked={value.transmissionConsent} onChange={event=>onChange({...value,transmissionConsent:event.target.checked})}/>{uiText('Allow selected source evidence to be sent to the AI provider')}</label></fieldset>
   <details><DisclosureSummary>{uiText('Advanced model and budget settings')}</DisclosureSummary>
    <label>{uiText('Document model')}<Select aria-label={uiText('Document model')} value={value.model??''} onChange={event=>onChange({...value,model:event.target.value,transmissionConsent:false,budget:{...value.budget,maxOutputTokens:Math.min(value.budget.maxOutputTokens,Math.floor((documentModel(event.target.value)?.maxOutputTokens??40000)*0.8))}})}>{selected?.models.map(model=><option key={model.id} value={model.id} disabled={model.available===false}>{model.label??model.id}</option>)}</Select></label>
    <label>{uiText('Maximum requests')}<input type="number" min={1} max={512} value={value.budget.maxRequests} onChange={event=>onChange({...value,budget:{...value.budget,maxRequests:Math.max(1,Math.min(512,Number(event.target.value)||1))}})}/></label>
    <label>{uiText('Maximum output tokens per request')}<input type="number" min={1024} max={maxOutputTokens} value={value.budget.maxOutputTokens} onChange={event=>onChange({...value,budget:{...value.budget,maxOutputTokens:Math.max(1024,Math.min(maxOutputTokens,Number(event.target.value)||1024))}})}/></label>
    <label>{uiText('Maximum estimated provider cost (USD, optional)')}<input type="number" min={0.01} max={10000} step={0.01} value={value.budget.maxCostUsd??''} onChange={event=>onChange({...value,budget:{...value.budget,maxCostUsd:event.target.value===''?null:Math.max(0.01,Math.min(10000,Number(event.target.value)||0.01))}})}/></label>
    <label>{uiText('Processing guidance (optional)')}<textarea maxLength={4000} value={value.guidance} onChange={event=>onChange({...value,guidance:event.target.value})}/></label>
   </details>
  </>}
 </fieldset>;
}
