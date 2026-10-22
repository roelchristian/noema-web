import {aiPersonas,defaultPersonaId,type BuiltinPersonaId} from '../../shared/ai-personas';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import { Select } from '../components/Select';
import { defaultIntelligencePreferences, defaultPageEnrichmentPreferences, defaultManualRequestsPerMinute, maxManualRequestsPerMinute, intelligenceModels, type IntelligenceConfiguration, type ReasoningEffort } from '../../shared/intelligence';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { IntelligenceStatus } from '../../shared/domain';
export function IntelligenceSettings() {
  const [status,setStatus]=useState<IntelligenceStatus|null>(null),[key,setKey]=useState(''),[days,setDays]=useState(30),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [preferences,setPreferences]=useState<IntelligenceConfiguration>({...defaultIntelligencePreferences,manualRequestsPerMinute:defaultManualRequestsPerMinute,pageEnrichment:{...defaultPageEnrichmentPreferences}});
  const modelOption=intelligenceModels.find(option=>option.id===preferences.model)!;
  const enrichment=preferences.pageEnrichment??defaultPageEnrichmentPreferences;
  const savedEnrichment=status?.pageEnrichment??defaultPageEnrichmentPreferences;
  const enrichmentModelOption=intelligenceModels.find(option=>option.id===enrichment.model)!;
  const changed=!!status&&((preferences.personaId??defaultPersonaId)!==(status.personaId??defaultPersonaId)||preferences.model!==status.model||preferences.reasoningEffort!==status.reasoningEffort||preferences.manualRequestsPerMinute!==status.manualRequestsPerMinute||enrichment.model!==savedEnrichment.model||enrichment.reasoningEffort!==savedEnrichment.reasoningEffort);
  useEffect(()=>{let active=true;void api.intelligence().then(value=>{if(active){setStatus(value);setPreferences({personaId:(value.personaId??defaultPersonaId) as BuiltinPersonaId,model:value.model,reasoningEffort:value.reasoningEffort,manualRequestsPerMinute:value.manualRequestsPerMinute,pageEnrichment:value.pageEnrichment??{...defaultPageEnrichmentPreferences}});}}).catch(()=>{if(active)setMessage('Secure storage is unavailable. Unlock your macOS login keychain and reopen Settings.');});return()=>{active=false;};},[]);
  async function perform(work:()=>Promise<unknown>,success:string) {
    setBusy(true);setMessage('');
    try {await work();setMessage(success);}catch(error){setMessage(error instanceof Error?error.message:'Request failed.');}finally{setBusy(false);}
  }
  function save(event:FormEvent) {event.preventDefault();const value=key;setKey('');void perform(async()=>setStatus(await api.saveIntelligence(value,days)),'API key saved.');}
  return <section className="settings-section intelligence-settings" aria-labelledby="intelligence-heading">
    <h3 id="intelligence-heading">{uiText("OpenAI")}</h3>
    <p>{uiText("Connect OpenAI for writing and search. Your API key is stored in macOS Keychain and shared across vaults.")}</p>
    <div className="intelligence-status">{status?.configured ? <>{uiText("API key saved · expires") + " "}{new Date(status.expiresAt!).toLocaleString(getLocale())}</> : uiText("No active API key")}{status && <small>{uiText("Model:") + " "}{status.model}{" " + uiText("· Reasoning:") + " "}{status.reasoningEffort}</small>}</div>
    <form className="ai-preferences-form" onInvalidCapture={event=>{const details=(event.target as HTMLElement).closest('details');if(details)details.open=true;}} onSubmit={event=>{event.preventDefault();void perform(async()=>{const saved=await api.saveIntelligencePreferences(preferences);setStatus(current=>current?{...current,...saved}:current);setPreferences(saved);window.dispatchEvent(new Event('noema:persona-preferences'));},'AI preferences saved.');}}>
      <fieldset className="ai-personas"><legend>AI Persona</legend><p>Choose the default voice for generated prose. Shared across vaults. Models and factual standards stay independent.</p>
      {aiPersonas.map(persona=><label className="ai-persona-card" key={persona.id}><input type="radio" name="ai-persona" value={persona.id} checked={(preferences.personaId??defaultPersonaId)===persona.id} disabled={busy||!status} onChange={()=>setPreferences(current=>({...current,personaId:persona.id as BuiltinPersonaId}))}/><span><strong>{persona.name}</strong><span>{persona.description}</span><small>“{persona.sample}”</small></span></label>)}
      </fieldset>
      <div className="ai-setting-row"><label htmlFor="ai-model">{uiText("Model")}</label>
      <Select id="ai-model" value={preferences.model} disabled={busy||!status} onChange={event=>{
        const model=intelligenceModels.find(option=>option.id===event.target.value)!;
        setPreferences(current=>({...current,model:model.id,reasoningEffort:model.efforts.includes(current.reasoningEffort)?current.reasoningEffort:'low'}));
      }}>{intelligenceModels.map(model=><option key={model.id} value={model.id}>{model.label}</option>)}</Select>
      </div>
      <details className="settings-advanced ai-advanced-options"><summary>{uiText("Advanced AI options")}</summary>
      <div className="ai-setting-row"><label htmlFor="ai-reasoning">{uiText("Reasoning effort")}</label>
      <Select id="ai-reasoning" value={preferences.reasoningEffort} disabled={busy||!status} onChange={event=>setPreferences(current=>({...current,reasoningEffort:event.target.value as ReasoningEffort}))}>
        {modelOption.efforts.map(effort=><option key={effort} value={effort}>{effort==='low'?uiText("Low (default)"):effort==='xhigh'?uiText("Extra high"):uiText(effort[0]!.toUpperCase()+effort.slice(1))}</option>)}
      </Select>
      </div>
      <p>{uiText("Higher effort may take longer and cost more.")}</p>
      <div className="ai-setting-row"><label htmlFor="ai-enrichment-model">{uiText("Page enrichment model")}</label>
      <Select id="ai-enrichment-model" value={enrichment.model} disabled={busy||!status} onChange={event=>{
        const model=intelligenceModels.find(option=>option.id===event.target.value)!;
        setPreferences(current=>{
          const selected=current.pageEnrichment??defaultPageEnrichmentPreferences;
          return {...current,pageEnrichment:{model:model.id,reasoningEffort:model.efforts.includes(selected.reasoningEffort)?selected.reasoningEffort:model.efforts.includes('none')?'none':'low'}};
        });
      }}>{intelligenceModels.map(model=><option key={model.id} value={model.id}>{model.label}</option>)}</Select>
      </div>
      <div className="ai-setting-row"><label htmlFor="ai-enrichment-reasoning">{uiText("Page enrichment reasoning effort")}</label>
      <Select id="ai-enrichment-reasoning" value={enrichment.reasoningEffort} disabled={busy||!status} onChange={event=>setPreferences(current=>({...current,pageEnrichment:{...(current.pageEnrichment??defaultPageEnrichmentPreferences),reasoningEffort:event.target.value as ReasoningEffort}}))}>
        {enrichmentModelOption.efforts.map(effort=><option key={effort} value={effort}>{effort==='none'?uiText("None (recommended)"):effort==='xhigh'?uiText("Extra high"):uiText(effort[0]!.toUpperCase()+effort.slice(1))}</option>)}
      </Select>
      </div>
      <p>{uiText("Used for page titles, subjects, language, and summaries. Defaults to GPT-6 Luna with no reasoning. Choosing a different model or higher effort may increase cost.")}</p>
      <div className="ai-setting-row"><label htmlFor="ai-manual-request-limit">{uiText("Manual AI requests per minute")}</label>
      <input id="ai-manual-request-limit" type="number" min={1} max={maxManualRequestsPerMinute} step={1} required value={preferences.manualRequestsPerMinute || ''} disabled={busy||!status} onChange={event=>setPreferences(current=>({...current,manualRequestsPerMinute:Number(event.target.value)}))}/>
      </div>
      <p>{uiText("Shared across vaults. Counts each manual AI request; excludes background tasks.")}</p>
      </details>
      <div className="intelligence-actions"><button className="button" disabled={busy||!changed}>{uiText("Save AI preferences")}</button></div>
    </form>
    <details className="settings-advanced ai-key-settings" key={String(status?.configured)} open={status ? !status.configured : undefined}><summary>{uiText("API key & connection")}</summary>
    <form onSubmit={save} autoComplete="off">
      <div className="ai-setting-row"><label htmlFor="openai-key">{status?.configured?uiText("Replacement OpenAI API key"):uiText("OpenAI API key")}</label>
      <input id="openai-key" type="password" value={key} onChange={event=>setKey(event.target.value)} placeholder={uiText("sk-…")} autoComplete="new-password" spellCheck={false} autoCapitalize="none" maxLength={503} required disabled={busy}/>
      </div>
      <div className="ai-setting-row"><label htmlFor="key-lifetime">{uiText("Key lifetime in Noema (days)")}</label>
      <input id="key-lifetime" type="number" min={1} max={365} step={1} required value={days} disabled={busy} onChange={event=>setDays(Number(event.target.value))}/>
      </div>
      <p>{uiText("Expiry stops use in Noema. Revoke the key in OpenAI to disable it everywhere.")}</p>
      <div className="intelligence-actions"><button className="button primary" disabled={busy||!key.trim()}>{busy?uiText("Working…"):status?.configured?uiText("Replace key"):uiText("Save key")}</button>
        <button className="button" type="button" disabled={busy||!status?.configured||changed} onClick={()=>void perform(()=>api.validateIntelligence(),'Connection validated.')}>{uiText("Validate connection")}</button>
        <button className="button danger" type="button" disabled={busy||!status?.configured} onClick={()=>void perform(async()=>setStatus(await api.removeIntelligence()),'Saved key removed from Noema.')}>{uiText("Remove key")}</button></div>
    </form>
    </details>
    {changed&&<p>{uiText("Save AI preferences before validating the new selection.")}</p>}
    <p className="intelligence-note">{uiText("AI features send relevant note text, source text, and search queries to OpenAI. Source enrichment runs automatically; automatic indexing is configured below. API charges apply.")}</p>
    <p role="status" aria-live="polite">{uiText(message)}</p>
  </section>;
}
