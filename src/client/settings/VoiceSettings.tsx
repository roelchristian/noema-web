import {InlineNotice} from '../notifications/InlineNotice';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api,type SpeechModelStatus} from '../api';
import {Select} from '../components/Select';
import {FormNotice,useFormNotice} from '../notifications/FormNotice';
import {defaultSpeechProvider,defaultSpeechVoiceFor,isSpeechProvider,isSpeechVoice,speechModelFor,speechVoicesFor,type IntelligenceConfiguration,type SpeechProvider,type SpeechVoice} from '../../shared/intelligence';
import {defaultNarrationPreferences,type NarrationPreferences} from '../../shared/narration';
import {NarrationSettings} from './NarrationSettings';
import {ProviderConnection} from './ProviderConnection';

type VoiceDraft={ttsEnabled:boolean;ttsProvider:SpeechProvider;ttsVoice:SpeechVoice;narration:NarrationPreferences};
function voiceDraft(value:Partial<Pick<IntelligenceConfiguration,'ttsEnabled'|'ttsProvider'|'ttsVoice'|'narration'>>):VoiceDraft {
  const provider=isSpeechProvider(value.ttsProvider)?value.ttsProvider:defaultSpeechProvider;
  return {ttsEnabled:value.ttsEnabled??false,ttsProvider:provider,ttsVoice:isSpeechVoice(value.ttsVoice,provider)?value.ttsVoice:defaultSpeechVoiceFor(provider),narration:structuredClone(value.narration??defaultNarrationPreferences)};
}

/** Separate voice drafts persist across category navigation; only voice fields are submitted. */
export function VoiceSettings({active=true,vaultId}:{active?:boolean;vaultId?:string}={}) {
  const [draft,setDraft]=useState<VoiceDraft>(()=>voiceDraft({})),[saved,setSaved]=useState<VoiceDraft|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[success,setSuccess,successOccurrence]=useFormNotice();
  const [view,setView]=useState<'overview'|'narration'|'cache'|'model'>('overview');
  const [browse,setBrowse]=useState(false),[query,setQuery]=useState('');
  const [localSpeech,setLocalSpeech]=useState<SpeechModelStatus|null>(null),[modelBusy,setModelBusy]=useState(false),[modelError,setModelError]=useState('');
  const mounted=useRef(true),modelRevision=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;modelRevision.current++;};},[]);
  useEffect(()=>{if(!active||saved)return;let current=true;void api.intelligence().then(value=>{if(current){const next=voiceDraft(value);setDraft(next);setSaved(next);setMessage('');}}).catch(error=>{if(current)setMessage(error instanceof Error?error.message:'Could not load Voice preferences.');});return()=>{current=false;};},[active,saved]);
  useEffect(()=>{
    if(!active||!saved||draft.ttsProvider!=='kokoro')return;
    const revision=++modelRevision.current;setModelError('');
    void api.speechModel().then(value=>{if(mounted.current&&revision===modelRevision.current)setLocalSpeech(value);}).catch(error=>{if(mounted.current&&revision===modelRevision.current)setModelError(error instanceof Error?error.message:'Could not check the local speech model.');});
    return()=>{modelRevision.current++;};
  },[active,!!saved,draft.ttsProvider]);
  async function prepareModel(download=false) {
    const revision=++modelRevision.current;setModelBusy(true);setModelError('');
    try {if(download)await api.downloadSpeechModel();const value=await api.speechModel();if(mounted.current&&revision===modelRevision.current){setLocalSpeech(value);if(download&&!value.ready)setModelError('The local speech model is still unavailable. Retry the download or use manual setup.');}}
    catch(error){if(mounted.current&&revision===modelRevision.current)setModelError(error instanceof Error?error.message:'Could not prepare the local speech model.');}
    finally{if(mounted.current){setModelBusy(false);}}
  }
  const changed=!!saved&&JSON.stringify(saved)!==JSON.stringify(draft),provider=draft.ttsProvider;
  function change(patch:Partial<VoiceDraft>){setDraft(current=>({...current,...patch}));setSuccess('');}
  async function save(event:FormEvent) {
    event.preventDefault();if(busy||!changed)return;setBusy(true);setMessage('');setSuccess('');
    try {const value=voiceDraft(await api.saveVoicePreferences(draft));if(mounted.current){setSaved(value);setDraft(value);setSuccess('Voice preferences saved.');}window.dispatchEvent(new Event('noema:tts-preferences'));}
    catch(error){if(mounted.current)setMessage(error instanceof Error?error.message:'Could not save Voice preferences.');}
    finally{if(mounted.current)setBusy(false);}
  }
  const allVoices=speechVoicesFor(provider),suggested=allVoices.slice(0,4);
  const matches=allVoices.filter(voice=>voice.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const retainedSelection=browse&&!matches.includes(draft.ttsVoice);
  const voices=browse?(retainedSelection?[draft.ttsVoice,...matches]:matches):[...new Set([...suggested,draft.ttsVoice])];
  return <section className="settings-section intelligence-settings voice-settings" aria-labelledby="voice-heading">
    <h3 id="voice-heading">Voice</h3>
    {view!=='overview'&&<button type="button" className="button" onClick={()=>setView('overview')}>Back to Voice</button>}
    {provider!=='kokoro'&&<ProviderConnection provider={provider}/>}
    <form className="voice-preferences-form" onSubmit={save} onInvalidCapture={event=>{const target=event.target as HTMLElement;const details=target.closest('details');if(details)details.open=true;}}>
      {view==='overview'&&<>
        <div className="ai-setting-row"><label id="voice-enabled-label" htmlFor="ai-tts-enabled">Enable Speak</label><div><button id="ai-tts-enabled" type="button" className="security-switch" role="switch" aria-checked={draft.ttsEnabled} aria-labelledby="voice-enabled-label" disabled={busy||!saved} onClick={()=>change({ttsEnabled:!draft.ttsEnabled})}><span/></button></div></div>
        <div className="ai-setting-row"><label htmlFor="ai-tts-provider">Speech provider</label><Select id="ai-tts-provider" value={provider} disabled={busy||!saved} onChange={event=>{const next=event.target.value;if(isSpeechProvider(next)){change({ttsProvider:next,ttsVoice:defaultSpeechVoiceFor(next)});setBrowse(false);setQuery('');}}}><option value="kokoro">Kokoro · Local (recommended)</option><option value="openai">OpenAI · Cloud</option><option value="gemini">Gemini · Cloud</option></Select></div>
        <p id="ai-tts-description">{provider==='kokoro'?'AI-generated speech runs locally on your CPU. No API key or API charges.':`AI-generated speech sends selected text to ${provider==='openai'?'OpenAI':'Google'}. An API credential is required and API charges apply.`}</p>
        {provider==='kokoro'?<p id="ai-tts-model-status" role="status">{modelError?'Error checking local speech model.':localSpeech?.ready?'Ready · Local speech model':localSpeech?'Setup required · Local speech model':'Checking · Local speech model'} <button type="button" className="button" onClick={()=>setView('model')}>Local model setup</button></p>:null}
        <div className="ai-setting-row"><label htmlFor="ai-tts-voice">Voice</label><Select id="ai-tts-voice" value={draft.ttsVoice} disabled={busy||!saved} onChange={event=>{if(isSpeechVoice(event.target.value,provider))change({ttsVoice:event.target.value});}}>{voices.map(voice=><option key={voice} value={voice}>{voice[0]!.toUpperCase()+voice.slice(1)}{retainedSelection&&voice===draft.ttsVoice?' (selected; outside search)':voice===defaultSpeechVoiceFor(provider)?' (default)':''}</option>)}</Select></div>
        <button type="button" className="button" aria-expanded={browse} onClick={()=>{setBrowse(current=>!current);setQuery('');}}>{browse?'Show suggested voices':'Browse all voices'}</button>
        {browse&&<><div className="ai-setting-row"><label htmlFor="voice-search">Search voices</label><input id="voice-search" type="search" value={query} onChange={event=>setQuery(event.target.value)}/></div>{matches.length===0&&<p role="status">No matching voices. Your selected voice is kept.</p>}</>}
      </>}
      {(view==='overview'||view==='narration')&&<NarrationSettings value={draft.narration} onChange={narration=>change({narration})} provider={provider} voice={draft.ttsVoice} vaultId={vaultId} disabled={busy||!saved} previewEnabled={active} view={view==='overview'?'overview':'detail'}/>}
      {view==='overview'&&<div className="intelligence-actions"><button type="button" className="button" onClick={()=>setView('narration')}>Narration & pronunciation</button><button type="button" className="button" onClick={()=>setView('cache')}>Audio cache</button></div>}
      {view==='cache'&&<><h4>Audio cache</h4><p>Generated recordings are cached for 7 days, then automatically deleted to free disk space. Each provider, voice and narration selection uses separate saved audio. Switching back can reuse its saved audio.</p><p>Preview samples are temporary and do not change saved recordings or defaults.</p></>}
      {view==='model'&&<div className="local-speech-model" aria-busy={modelBusy}><h4>Local model setup</h4><p role="status">{modelBusy?'Preparing local speech model…':localSpeech?.ready?'Kokoro model ready for local speech.':'Download the Kokoro model to use Speak. Model files are stored locally and excluded from Git.'}</p>{localSpeech&&!localSpeech.ready&&<><p>Missing model files: {localSpeech.missingFiles.join(', ')}</p><button type="button" className="button" disabled={modelBusy} onClick={()=>void prepareModel(true)}>Download Kokoro model</button>{localSpeech.downloadCommand&&<details><summary>Manual model setup</summary><code>{localSpeech.downloadCommand}</code></details>}</>}{modelError&&<InlineNotice tone="error" title={modelError} announcement="assertive"/>}<button type="button" className="button" disabled={modelBusy} onClick={()=>void prepareModel()}>Retry model check</button><p>Speech model: <code>{speechModelFor(provider)}</code></p></div>}
      <div className="intelligence-actions"><button className="button" disabled={busy||!changed}>Save voice preferences</button></div>
    </form>
    {message&&<InlineNotice tone="error" title={message} announcement="assertive"/>}
    <FormNotice message={success} occurrence={successOccurrence} onDismiss={()=>setSuccess('')}/>
  </section>;
}
