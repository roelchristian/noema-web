import {useEffect,useState,type FormEvent} from 'react';
import {api} from '../api';
import {SuccessNotice,useSuccessNotice} from '../components/SuccessNotice';
import {getLocale} from '../i18n';
import {geminiApiKeyMaxLength,type SpeechCredentialStatus} from '../../shared/intelligence';

/** Write-only credential form: the key lives only in transient component memory. */
export function GeminiSpeechKey() {
  const [success,setSuccess,successOccurrence]=useSuccessNotice();
  const [status,setStatus]=useState<SpeechCredentialStatus|null>(null),[key,setKey]=useState(''),[days,setDays]=useState(30),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let active=true;void api.geminiCredential().then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setMessage('Secure Gemini key storage is unavailable. Unlock your macOS login keychain and try again.');});return()=>{active=false;};},[]);
  async function change(remove=false) {
    const value=key.trim();setKey('');setBusy(true);setMessage('');setSuccess('');
    try {
      setStatus(await (remove?api.removeGeminiCredential():api.saveGeminiCredential(value,days)));
      window.dispatchEvent(new Event('noema:tts-preferences'));
      setSuccess(remove?'Saved Gemini key removed from Noema.':'Gemini key saved.');
    }catch(error){setMessage(error instanceof Error?error.message:'Could not update the Gemini key.');}finally{setBusy(false);}
  }
  function submit(event:FormEvent){event.preventDefault();void change();}
  return <details className="settings-advanced ai-key-settings">
    <summary>Gemini speech API key</summary>
    <p>A separate Gemini key is required for Gemini speech. Stored in macOS Keychain and shared across vaults.</p>
    <p role="status">{status?.configured?<>Gemini key saved · expires {new Date(status.expiresAt!).toLocaleString(getLocale())}</>:'No active Gemini API key'}</p>
    <form onSubmit={submit} autoComplete="off">
      <div className="ai-setting-row"><label htmlFor="gemini-key">{status?.configured?'Replacement Gemini API key':'Gemini API key'}</label><input id="gemini-key" type="password" autoComplete="new-password" spellCheck={false} autoCapitalize="none" maxLength={geminiApiKeyMaxLength} value={key} disabled={busy} required onChange={event=>setKey(event.target.value)}/></div>
      <div className="ai-setting-row"><label htmlFor="gemini-key-lifetime">Key lifetime in Noema (days)</label><input id="gemini-key-lifetime" type="number" min={1} max={365} step={1} value={days} disabled={busy} required onChange={event=>setDays(Number(event.target.value))}/></div>
      <p>Expiry stops use in Noema. Revoke the key in Google AI Studio to disable it everywhere. Saving a key makes no provider request.</p>
      <div className="intelligence-actions"><button className="button primary" disabled={busy||!key.trim()}>{status?.configured?'Replace Gemini key':'Save Gemini key'}</button><button type="button" className="button danger" disabled={busy||!status?.configured} onClick={()=>void change(true)}>Remove Gemini key</button></div>
    </form>
    {message&&<p role="status" aria-live="polite">{message}</p>}
    <SuccessNotice inline message={success} occurrence={successOccurrence} onDismiss={()=>setSuccess('')}/>
  </details>;
}
