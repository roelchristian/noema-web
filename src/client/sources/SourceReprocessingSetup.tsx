import {Select} from '../components/Select';
import {useEffect,useId,useRef} from 'react';
import type {SourceProcessingDepth,SourceReviewPolicy,SourceReprocessingConfiguration} from '../../shared/source-reprocessing';
import {intelligenceModels,type IntelligencePreferences} from '../../shared/intelligence';
import {t as uiText} from '../i18n';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {InlineNotice} from '../notifications';
import './source-reprocessing-workspace.css';
export type EvidenceCapabilities={originalPages:boolean;ocr:boolean;externalImages:boolean;reason:string};
export const depthLabels={light:'Light Cleanup',balanced:'Balanced Reconstruction',deep:'Deep Restoration'};
export const depthPasses={light:'1 model request per excerpt',balanced:'2 model requests per excerpt, plus document synthesis; one additional repair request if footnote validation fails',deep:'2–3 model requests per excerpt, plus document synthesis; a third requires a recorded difficulty'};
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
 </fieldset>;
}

type Props={fileId:string;configuration:IntelligencePreferences|null;configurationError:string;depth:SourceProcessingDepth;onDepth:(depth:SourceProcessingDepth)=>void;substantialMath:boolean;onSubstantialMath:(value:boolean)=>void;reviewPolicy:SourceReviewPolicy;onReviewPolicy:(policy:SourceReviewPolicy)=>void;instructions:string;onInstructions:(instructions:string)=>void;evidenceCapabilities:EvidenceCapabilities|null;evidenceError:string;evidenceOptions:SourceReprocessingConfiguration['evidence'];onEvidenceOptions:(options:SourceReprocessingConfiguration['evidence'])=>void;busy:boolean;running:boolean;error?:string;onStart:()=>void;onClose:()=>void};
export function SourceReprocessingSetup({fileId,configuration,configurationError,depth,onDepth,substantialMath,onSubstantialMath,reviewPolicy,onReviewPolicy,instructions,onInstructions,evidenceCapabilities,evidenceError,evidenceOptions,onEvidenceOptions,busy,running,error,onStart,onClose}:Props){
 const dialog=useRef<HTMLDialogElement>(null),titleId=useId(),mathHelpId=useId(),returnFocus=useRef(typeof document!=='undefined'&&document.activeElement instanceof HTMLElement?document.activeElement:null);
 useEffect(()=>{
  const element=dialog.current;if(!element)return;
  const trigger=returnFocus.current,workspace=element.closest('.source-reprocessing');
  element.showModal();element.querySelector<HTMLElement>('[role="combobox"]')?.focus();
  return()=>{
   element.close();
   const target=trigger?.isConnected&&!trigger.matches(':disabled')?trigger:workspace?.querySelector<HTMLButtonElement>('.reprocessing-bar .reprocessing-loading-button:not(:disabled)');
   if(target?.isConnected)target.focus({preventScroll:true});
  };
 },[]);
 return <dialog ref={dialog} className="reprocessing-setup-sheet" aria-labelledby={titleId} onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <form className="reprocessing-prompt" onSubmit={event=>{event.preventDefault();onStart();}}>
   <div className="reprocessing-setup-heading"><h2 id={titleId}>{uiText("Refine text")}</h2><button type="button" className="button small" disabled={busy} onClick={onClose}>{uiText("Cancel")}</button></div>
   <p>{uiText("Improve reading quality while preserving source meaning and page provenance.")}</p>
   {error&&<InlineNotice tone="error" title={error} announcement="assertive"/>}
   <label>{uiText("Processing depth")}<Select autoFocus aria-label={uiText("Processing depth")} disabled={busy} value={depth} onChange={event=>onDepth(event.target.value as SourceProcessingDepth)}>{(['light','balanced','deep'] as const).map(value=><option key={value} value={value}>{uiText(depthLabels[value])}</option>)}</Select></label>
   <div className="reprocessing-math-option"><label><input type="checkbox" aria-label={uiText("Substantial math content")} aria-describedby={mathHelpId} disabled={busy} checked={substantialMath} onChange={event=>onSubstantialMath(event.target.checked)}/>{uiText("Substantial math content")}</label><p id={mathHelpId}>{uiText("Check every mathematical expression, including inline variables and group names, for missing math markup. Preserve the notation and keep uncertain corrections for review.")}</p></div>
   <label>{uiText("Review policy")}<Select aria-label={uiText("Review policy")} disabled={busy} value={reviewPolicy} onChange={event=>onReviewPolicy(event.target.value as SourceReviewPolicy)}><option value="verified">{uiText("Apply verified changes automatically")}</option><option value="review_all">{uiText("Review everything")}</option></Select></label>
   <p>{uiText("Text-preserving layout and paired footnote formatting may be applied automatically. Uncertain wording, mathematics and bibliographic changes remain for review.")}</p>
   <div className="reprocessing-configuration" role="status">{configuration?<><strong>{intelligenceModels.find(model=>model.id===configuration.model)?.label??configuration.model} · {configuration.reasoningEffort} {uiText("reasoning")}</strong><p>{uiText(depthPasses[depth])}. {uiText("Each pass is a separate model request.")}</p></>:configurationError?<InlineNotice id={`reprocessing-configuration-error-${fileId}`} tone="error" variant="compact" title={configurationError} announcement="assertive"/>:uiText("Loading AI configuration…")}</div>
   <details className="reprocessing-advanced"><DisclosureSummary>{uiText("Advanced options")}</DisclosureSummary><p>{uiText("Balanced and Deep cost at least two requests per excerpt, even when no changes are proposed.")}</p><EvidenceOptions capabilities={evidenceCapabilities} error={evidenceError} options={evidenceOptions} onChange={onEvidenceOptions} disabled={busy}/><label>{uiText("Editorial guidance (optional)")}<textarea disabled={busy} value={instructions} maxLength={4000} onChange={event=>onInstructions(event.target.value)} placeholder={uiText("For example: preserve Greek quotations; check ambiguous footnote numbering carefully.")}/></label></details>
   {(evidenceOptions.ocr||evidenceOptions.originalPages)&&<fieldset className="reprocessing-transmission-consent" disabled={busy}><legend>{uiText("Provider transmission")}</legend><p>{uiText(evidenceOptions.originalPages?"Original-page comparison selected. Transmission consent is required.":"Local OCR selected. Without transmission consent, its text stays local.")}</p><label><input type="checkbox" aria-label={uiText("Allow selected source evidence to be sent to the AI provider")} checked={evidenceOptions.allowExternalTransmission} onChange={event=>onEvidenceOptions({...evidenceOptions,allowExternalTransmission:event.target.checked})}/>{uiText("Allow selected source evidence to be sent to the AI provider")}</label><p>{uiText("This sends selected original-page images and/or OCR text to your configured AI provider and may increase provider charges. Consent applies to this run.")}</p>{evidenceOptions.originalPages&&!evidenceOptions.allowExternalTransmission&&<InlineNotice tone="warning" variant="compact" title={uiText("Original-page model comparison requires transmission consent before starting.")}/>}</fieldset>}
   <div className="reprocessing-actions"><button className="button primary reprocessing-loading-button" aria-busy={busy} disabled={busy||running||!configuration||!evidenceCapabilities&&!evidenceError||evidenceOptions.originalPages&&!evidenceOptions.allowExternalTransmission} type="submit">{busy&&<span className="scan-spinner" aria-hidden="true"/>}{busy?uiText("Starting…"):uiText("Start reprocessing")}</button></div>
  </form>
 </dialog>;
}
