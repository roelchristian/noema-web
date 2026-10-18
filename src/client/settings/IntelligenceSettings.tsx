import { Select } from '../components/Select';
import { defaultIntelligencePreferences, defaultManualRequestsPerMinute, maxManualRequestsPerMinute, intelligenceModels, type IntelligenceConfiguration, type ReasoningEffort } from '../../shared/intelligence';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { IntelligenceStatus } from '../../shared/domain';
export function IntelligenceSettings() {
  const [status,setStatus]=useState<IntelligenceStatus|null>(null),[key,setKey]=useState(''),[days,setDays]=useState(30),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [preferences,setPreferences]=useState<IntelligenceConfiguration>({...defaultIntelligencePreferences,manualRequestsPerMinute:defaultManualRequestsPerMinute});
  const modelOption=intelligenceModels.find(option=>option.id===preferences.model)!;
  const changed=!!status&&(preferences.model!==status.model||preferences.reasoningEffort!==status.reasoningEffort||preferences.manualRequestsPerMinute!==status.manualRequestsPerMinute);
  useEffect(()=>{let active=true;void api.intelligence().then(value=>{if(active){setStatus(value);setPreferences({model:value.model,reasoningEffort:value.reasoningEffort,manualRequestsPerMinute:value.manualRequestsPerMinute});}}).catch(()=>{if(active)setMessage('Secure storage is unavailable. Unlock your macOS login keychain and reopen Settings.');});return()=>{active=false;};},[]);
  async function perform(work:()=>Promise<unknown>,success:string) {
    setBusy(true);setMessage('');
    try {await work();setMessage(success);}catch(error){setMessage(error instanceof Error?error.message:'Request failed.');}finally{setBusy(false);}
  }
  function save(event:FormEvent) {event.preventDefault();const value=key;setKey('');void perform(async()=>setStatus(await api.saveIntelligence(value,days)),'API key saved.');}
  return <section className="settings-section intelligence-settings" aria-labelledby="intelligence-heading">
    <h3 id="intelligence-heading">Intelligence</h3>
    <p>Connect OpenAI for writing and search. Your API key is stored in macOS Keychain and shared across vaults.</p>
    <div className="intelligence-status">{status?.configured ? <>API key saved · expires {new Date(status.expiresAt!).toLocaleString()}</> : 'No active API key'}{status && <small>Model: {status.model} · Reasoning: {status.reasoningEffort}</small>}</div>
    <form onSubmit={event=>{event.preventDefault();void perform(async()=>{const saved=await api.saveIntelligencePreferences(preferences);setStatus(current=>current?{...current,...saved}:current);setPreferences(saved);},'AI preferences saved.');}}>
      <label htmlFor="ai-model">Model</label>
      <Select id="ai-model" value={preferences.model} disabled={busy||!status} onChange={event=>{
        const model=intelligenceModels.find(option=>option.id===event.target.value)!;
        setPreferences(current=>({...current,model:model.id,reasoningEffort:model.efforts.includes(current.reasoningEffort)?current.reasoningEffort:'low'}));
      }}>{intelligenceModels.map(model=><option key={model.id} value={model.id}>{model.label}</option>)}</Select>
      <label htmlFor="ai-reasoning">Reasoning effort</label>
      <Select id="ai-reasoning" value={preferences.reasoningEffort} disabled={busy||!status} onChange={event=>setPreferences(current=>({...current,reasoningEffort:event.target.value as ReasoningEffort}))}>
        {modelOption.efforts.map(effort=><option key={effort} value={effort}>{effort==='low'?'Low (default)':effort==='xhigh'?'Extra high':effort[0]!.toUpperCase()+effort.slice(1)}</option>)}
      </Select>
      <p>Higher effort may take longer and cost more.</p>
      <label htmlFor="ai-manual-request-limit">Manual AI requests per minute</label>
      <input id="ai-manual-request-limit" type="number" min={1} max={maxManualRequestsPerMinute} step={1} required value={preferences.manualRequestsPerMinute || ''} disabled={busy||!status} onChange={event=>setPreferences(current=>({...current,manualRequestsPerMinute:Number(event.target.value)}))}/>
      <p>Shared across vaults. Counts each manual AI request; excludes background tasks.</p>
      <div className="intelligence-actions"><button className="button" disabled={busy||!changed}>Save AI preferences</button></div>
    </form>
    <form onSubmit={save} autoComplete="off">
      <label htmlFor="openai-key">{status?.configured?'Replacement OpenAI API key':'OpenAI API key'}</label>
      <input id="openai-key" type="password" value={key} onChange={event=>setKey(event.target.value)} placeholder="sk-…" autoComplete="new-password" spellCheck={false} autoCapitalize="none" maxLength={503} required disabled={busy}/>
      <label htmlFor="key-lifetime">Key lifetime in Noema (days)</label>
      <input id="key-lifetime" type="number" min={1} max={365} step={1} required value={days} disabled={busy} onChange={event=>setDays(Number(event.target.value))}/>
      <p>Expiry stops use in Noema. Revoke the key in OpenAI to disable it everywhere.</p>
      <div className="intelligence-actions"><button className="button primary" disabled={busy||!key.trim()}>{busy?'Working…':status?.configured?'Replace key':'Save key'}</button>
        <button className="button" type="button" disabled={busy||!status?.configured||changed} onClick={()=>void perform(()=>api.validateIntelligence(),'Connection validated.')}>Validate connection</button>
        <button className="button danger" type="button" disabled={busy||!status?.configured} onClick={()=>void perform(async()=>setStatus(await api.removeIntelligence()),'Saved key removed from Noema.')}>Remove key</button></div>
    </form>
    {changed&&<p>Save AI preferences before validating the new selection.</p>}
    <p className="intelligence-note">AI features send relevant note text, source text, and search queries to OpenAI. Source enrichment runs automatically; automatic indexing is configured below. API charges apply.</p>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
