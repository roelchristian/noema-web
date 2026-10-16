import { Select } from '../components/Select';
import { defaultIntelligencePreferences, intelligenceModels, type IntelligencePreferences, type ReasoningEffort } from '../../shared/intelligence';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { IntelligenceStatus } from '../../shared/domain';
export function IntelligenceSettings() {
  const [status,setStatus]=useState<IntelligenceStatus|null>(null),[key,setKey]=useState(''),[days,setDays]=useState(30),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [preferences,setPreferences]=useState<IntelligencePreferences>({...defaultIntelligencePreferences});
  const modelOption=intelligenceModels.find(option=>option.id===preferences.model)!;
  const changed=!!status&&(preferences.model!==status.model||preferences.reasoningEffort!==status.reasoningEffort);
  useEffect(()=>{let active=true;void api.intelligence().then(value=>{if(active){setStatus(value);setPreferences({model:value.model,reasoningEffort:value.reasoningEffort});}}).catch(()=>{if(active)setMessage('Secure storage is unavailable. Unlock your macOS login keychain and reopen Settings.');});return()=>{active=false;};},[]);
  async function perform(work:()=>Promise<unknown>,success:string) {
    setBusy(true);setMessage('');
    try {await work();setMessage(success);}catch(error){setMessage(error instanceof Error?error.message:'Request failed.');}finally{setBusy(false);}
  }
  function save(event:FormEvent) {event.preventDefault();const value=key;setKey('');void perform(async()=>setStatus(await api.saveIntelligence(value,days)),'API key saved securely. Validate the connection to test access.');}
  return <section className="settings-section intelligence-settings" aria-labelledby="intelligence-heading">
    <h3 id="intelligence-heading">Intelligence</h3>
    <p>Connect OpenAI for page titles, summaries, and semantic search embeddings. Your key is saved in macOS Keychain and cannot be viewed or retrieved through Noema. This connection is shared across your local vaults.</p>
    <div className="intelligence-status">{status?.configured ? <>API key saved · expires {new Date(status.expiresAt!).toLocaleString()}</> : 'No active API key'}{status && <small>Model: {status.model} · Reasoning: {status.reasoningEffort}</small>}</div>
    <form onSubmit={event=>{event.preventDefault();void perform(async()=>{const saved=await api.saveIntelligencePreferences(preferences);setStatus(current=>current?{...current,...saved}:current);},'AI preferences saved. Validation and summaries will use this model and effort.');}}>
      <label htmlFor="ai-model">Model</label>
      <Select id="ai-model" value={preferences.model} disabled={busy||!status} onChange={event=>{
        const model=intelligenceModels.find(option=>option.id===event.target.value)!;
        setPreferences({model:model.id,reasoningEffort:model.efforts.includes(preferences.reasoningEffort)?preferences.reasoningEffort:'low'});
      }}>{intelligenceModels.map(model=><option key={model.id} value={model.id}>{model.label}</option>)}</Select>
      <label htmlFor="ai-reasoning">Reasoning effort</label>
      <Select id="ai-reasoning" value={preferences.reasoningEffort} disabled={busy||!status} onChange={event=>setPreferences(current=>({...current,reasoningEffort:event.target.value as ReasoningEffort}))}>
        {modelOption.efforts.map(effort=><option key={effort} value={effort}>{effort==='low'?'Low (default)':effort==='xhigh'?'Extra high':effort[0]!.toUpperCase()+effort.slice(1)}</option>)}
      </Select>
      <p>Low is the default. Higher effort can increase latency and cost; requests still have a 45-second timeout and token limit. Only supported efforts are offered for each model.</p>
      <p>Text models reviewed October 16, 2026 against <a href="https://developers.openai.com/api/docs/guides/latest-model" target="_blank" rel="noreferrer">OpenAI documentation</a>. Model access depends on your API project.</p>
      <div className="intelligence-actions"><button className="button" disabled={busy||!changed}>Save AI preferences</button></div>
    </form>
    <form onSubmit={save} autoComplete="off">
      <label htmlFor="openai-key">{status?.configured?'Replacement OpenAI API key':'OpenAI API key'}</label>
      <input id="openai-key" type="password" value={key} onChange={event=>setKey(event.target.value)} placeholder="sk-…" autoComplete="new-password" spellCheck={false} autoCapitalize="none" maxLength={503} required disabled={busy}/>
      <label htmlFor="key-lifetime">Key lifetime in Noema (days)</label>
      <input id="key-lifetime" type="number" min={1} max={365} step={1} required value={days} disabled={busy} onChange={event=>setDays(Number(event.target.value))}/>
      <p>Default: 30 days. Applies when saving or replacing a key. Expiry disables local use and removes the saved credential when Keychain is available. Revoke the key in OpenAI to invalidate it everywhere.</p>
      <div className="intelligence-actions"><button className="button primary" disabled={busy||!key.trim()}>{busy?'Working…':status?.configured?'Replace key':'Save key'}</button>
        <button className="button" type="button" disabled={busy||!status?.configured||changed} onClick={()=>void perform(()=>api.validateIntelligence(),'Connection validated. OpenAI accepted a small test request.')}>Validate connection</button>
        <button className="button danger" type="button" disabled={busy||!status?.configured} onClick={()=>void perform(async()=>setStatus(await api.removeIntelligence()),'Saved key removed from Noema.')}>Remove key</button></div>
    </form>
    {changed&&<p>Save AI preferences before validating the new selection.</p>}
    <p className="intelligence-note">Noema accepts local connections only (127.0.0.1). Title and summary actions send page text to OpenAI over HTTPS. When automatic embeddings are enabled for a vault, eligible saved notes are also sent to OpenAI; bulk indexing and semantic searches send note text or your search query. API charges may apply. Validation sends a small test prompt. Use a dedicated project key with restricted permissions and spending limits in OpenAI.</p>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
