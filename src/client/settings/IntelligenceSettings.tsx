import {GeminiSpeechKey} from './GeminiSpeechKey';
import {aiPersonas,defaultPersonaId,type BuiltinPersonaId} from '../../shared/ai-personas';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import { Select } from '../components/Select';
import { speechModelFor, speechVoicesFor, defaultSpeechProvider, defaultSpeechVoiceFor, isSpeechProvider, isSpeechVoice, defaultIntelligencePreferences, defaultPageEnrichmentPreferences, defaultManualRequestsPerMinute, maxManualRequestsPerMinute, intelligenceModels, type IntelligenceConfiguration, type ReasoningEffort } from '../../shared/intelligence';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type SpeechModelStatus } from '../api';
import type { IntelligenceStatus } from '../../shared/domain';
export function IntelligenceSettings() {
  const [status,setStatus]=useState<IntelligenceStatus|null>(null),[key,setKey]=useState(''),[days,setDays]=useState(30),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [preferences,setPreferences]=useState<IntelligenceConfiguration>({...defaultIntelligencePreferences,ttsEnabled:false,ttsProvider:defaultSpeechProvider,ttsVoice:defaultSpeechVoiceFor(defaultSpeechProvider),manualRequestsPerMinute:defaultManualRequestsPerMinute,pageEnrichment:{...defaultPageEnrichmentPreferences}});
  const [localSpeech,setLocalSpeech]=useState<SpeechModelStatus|null>(null),[speechBusy,setSpeechBusy]=useState(false),[speechError,setSpeechError]=useState('');
  useEffect(()=>{let active=true;void api.speechModel().then(value=>{if(active)setLocalSpeech(value);}).catch(error=>{if(active)setSpeechError(error instanceof Error?error.message:'Could not check the local speech model.');});return()=>{active=false;};},[]);
  async function prepareSpeech(download=false) {
    setSpeechBusy(true);setSpeechError('');
    try {
      if(download)await api.downloadSpeechModel();
      const value=await api.speechModel();setLocalSpeech(value);
      if(download&&!value.ready)setSpeechError('The local speech model is still unavailable. Retry the download or use the setup command below.');
    }catch(error){setSpeechError(error instanceof Error?error.message:'Could not prepare the local speech model.');}finally{setSpeechBusy(false);}
  }
  const modelOption=intelligenceModels.find(option=>option.id===preferences.model)!;
  const enrichment=preferences.pageEnrichment??defaultPageEnrichmentPreferences;
  const savedEnrichment=status?.pageEnrichment??defaultPageEnrichmentPreferences;
  const enrichmentModelOption=intelligenceModels.find(option=>option.id===enrichment.model)!;
  const provider=preferences.ttsProvider??defaultSpeechProvider;
  const savedProvider=isSpeechProvider(status?.ttsProvider)?status.ttsProvider:defaultSpeechProvider;
  const changed=!!status&&((preferences.personaId??defaultPersonaId)!==(status.personaId??defaultPersonaId)||Boolean(preferences.ttsEnabled)!==Boolean(status.ttsEnabled)||provider!==savedProvider||preferences.ttsVoice!==(isSpeechVoice(status.ttsVoice,savedProvider)?status.ttsVoice:defaultSpeechVoiceFor(savedProvider))||preferences.model!==status.model||preferences.reasoningEffort!==status.reasoningEffort||preferences.manualRequestsPerMinute!==status.manualRequestsPerMinute||enrichment.model!==savedEnrichment.model||enrichment.reasoningEffort!==savedEnrichment.reasoningEffort);
  useEffect(()=>{let active=true;void api.intelligence().then(value=>{if(active){setStatus(value);setPreferences({personaId:(value.personaId??defaultPersonaId) as BuiltinPersonaId,ttsEnabled:value.ttsEnabled??false,ttsProvider:isSpeechProvider(value.ttsProvider)?value.ttsProvider:defaultSpeechProvider,ttsVoice:isSpeechVoice(value.ttsVoice,isSpeechProvider(value.ttsProvider)?value.ttsProvider:defaultSpeechProvider)?value.ttsVoice:defaultSpeechVoiceFor(isSpeechProvider(value.ttsProvider)?value.ttsProvider:defaultSpeechProvider),model:value.model,reasoningEffort:value.reasoningEffort,manualRequestsPerMinute:value.manualRequestsPerMinute,pageEnrichment:value.pageEnrichment??{...defaultPageEnrichmentPreferences}});}}).catch(()=>{if(active)setMessage('Secure storage is unavailable. Unlock your macOS login keychain and reopen Settings.');});return()=>{active=false;};},[]);
  async function perform(work:()=>Promise<unknown>,success:string) {
    setBusy(true);setMessage('');
    try {await work();setMessage(success);}catch(error){setMessage(error instanceof Error?error.message:'Request failed.');}finally{setBusy(false);}
  }
  function save(event:FormEvent) {event.preventDefault();const value=key;setKey('');void perform(async()=>setStatus(await api.saveIntelligence(value,days)),'API key saved.');}
  return <section className="settings-section intelligence-settings" aria-labelledby="intelligence-heading">
    <h3 id="intelligence-heading">{uiText("OpenAI")}</h3>
    <p>{uiText("Connect OpenAI for writing and search. Your API key is stored in macOS Keychain and shared across vaults.")}</p>
    <div className="intelligence-status">{status?.configured ? <>{uiText("API key saved · expires") + " "}{new Date(status.expiresAt!).toLocaleString(getLocale())}</> : uiText("No active API key")}{status && <small>{uiText("Model:") + " "}{status.model}{" " + uiText("· Reasoning:") + " "}{status.reasoningEffort}</small>}</div>
    <form className="ai-preferences-form" onInvalidCapture={event=>{const details=(event.target as HTMLElement).closest('details');if(details)details.open=true;}} onSubmit={event=>{event.preventDefault();void perform(async()=>{const saved=await api.saveIntelligencePreferences(preferences);setStatus(current=>current?{...current,...saved}:current);setPreferences(saved);window.dispatchEvent(new Event('noema:persona-preferences'));window.dispatchEvent(new Event('noema:tts-preferences'));},'AI preferences saved.');}}>
      <div className="ai-setting-row"><label id="ai-tts-label" htmlFor="ai-tts-enabled">{uiText("Text to speech")}</label><div>
        <button id="ai-tts-enabled" type="button" className="security-switch" role="switch" aria-checked={Boolean(preferences.ttsEnabled)} aria-labelledby="ai-tts-label" aria-describedby="ai-tts-description" disabled={busy||!status} onClick={()=>setPreferences(current=>({...current,ttsEnabled:!current.ttsEnabled}))}><span/></button>
      </div></div>
      <p id="ai-tts-description">{provider==='kokoro'?uiText("Enable Speak for selected editor blocks across all vaults. Kokoro runs locally on your CPU with an AI-generated voice. No API key or API charges."):provider==='gemini'?uiText("Enable Speak with an AI-generated voice across all vaults. Selected text is sent to Google. A separate Gemini API key is required and API charges apply."):uiText("Enable Speak with an AI-generated voice across all vaults. Selected text is sent to OpenAI. An OpenAI API key is required and API charges apply.")}</p>
      <div className="ai-setting-row"><label htmlFor="ai-tts-provider">{uiText("TTS provider")}</label>
        <Select id="ai-tts-provider" value={provider} disabled={busy||!status} onChange={event=>{const selected=event.target.value;if(isSpeechProvider(selected))setPreferences(current=>({...current,ttsProvider:selected,ttsVoice:defaultSpeechVoiceFor(selected)}));}}>
          <option value="kokoro">Kokoro 82M (default, local)</option><option value="openai">OpenAI (opt in)</option><option value="gemini">Gemini Flash-Lite TTS (opt in)</option>
        </Select>
      </div>
      {provider==='openai'&&!status?.configured&&<p role="note">{uiText("Save an OpenAI API key below to use OpenAI speech.")}</p>}
      <div className="ai-setting-row"><label htmlFor="ai-tts-voice">{uiText("TTS voice")}</label>
        <Select id="ai-tts-voice" value={preferences.ttsVoice} aria-describedby="ai-tts-voice-description" disabled={busy||!status} onChange={event=>{const voice=event.target.value;if(isSpeechVoice(voice,provider))setPreferences(current=>({...current,ttsVoice:voice}));}}>
          {speechVoicesFor(provider).map(voice=><option key={voice} value={voice}>{voice[0]!.toUpperCase()+voice.slice(1)}{voice===defaultSpeechVoiceFor(provider)?' (default)':''}</option>)}
        </Select>
      </div>
      <p id="ai-tts-voice-description">{provider==='kokoro'?uiText("Each voice uses separate saved audio generated locally. Switching back can reuse its saved audio."):provider==='gemini'?uiText("Each Gemini voice uses separate saved audio. Switching back can reuse its saved audio."):uiText("Each OpenAI voice uses separate saved audio. Switching back can reuse its saved audio.")}</p>
      <p>{uiText("Speech model:")} <code>{speechModelFor(provider)}</code></p>
      {provider==='kokoro'&&<div className="local-speech-model" aria-busy={speechBusy}>
        <p id="ai-tts-model-status" role="status" aria-live="polite">{speechBusy?uiText("Preparing local speech model…"):localSpeech?.ready?uiText("Kokoro model ready for local speech."):localSpeech?uiText("Download the Kokoro model to use Speak. Model files are stored locally and excluded from Git."):speechError?uiText("Local speech model availability could not be checked."):uiText("Checking local speech model…")}</p>
        {localSpeech&&!localSpeech.ready&&<><p>{uiText("Missing model files:")} {localSpeech.missingFiles.join(', ')}</p><button type="button" className="button" disabled={speechBusy} onClick={()=>void prepareSpeech(true)}>{speechBusy?uiText("Downloading Kokoro model…"):uiText("Download Kokoro model")}</button>{localSpeech.downloadCommand&&<details><summary>{uiText("Manual model setup")}</summary><code>{localSpeech.downloadCommand}</code></details>}</>}
        {speechError&&<><p role="alert">{speechError}</p><button type="button" className="button" disabled={speechBusy} onClick={()=>void prepareSpeech()}>{uiText("Retry model check")}</button></>}
      </div>}
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
    <GeminiSpeechKey/>
    {changed&&<p>{uiText("Save AI preferences before validating the new selection.")}</p>}
    <p className="intelligence-note">{uiText("Writing and search features send relevant note text, source text, and search queries to OpenAI. Source enrichment runs automatically; automatic indexing is configured below. API charges apply to OpenAI features. Kokoro speech stays local.")}</p>
    <p role="status" aria-live="polite">{uiText(message)}</p>
  </section>;
}
