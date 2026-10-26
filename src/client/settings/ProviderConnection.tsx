import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {api,request} from '../api';
import type {PdfProcessingCapabilities} from '../knowledge/SourcePdfProcessing';
import {getLocale} from '../i18n';
import {geminiApiKeyMaxLength,type SpeechCredentialStatus} from '../../shared/intelligence';

type ConnectionState='ready'|'setup-required'|'checking'|'error';
const stateLabels:Record<ConnectionState,string>={ready:'Ready','setup-required':'Setup required',checking:'Checking…',error:'Error'};

/** Shared, write-only connection management. Never reads a stored credential. */
export function ProviderConnection({provider,onChange}:{provider:'openai'|'gemini';onChange?:(status:SpeechCredentialStatus)=>void}) {
  const label=provider==='openai'?'OpenAI':'Gemini',id=useId();
  const [status,setStatus]=useState<SpeechCredentialStatus|null>(null),[state,setState]=useState<ConnectionState>('checking');
  const [documents,setDocuments]=useState<PdfProcessingCapabilities|null>(null);
  useEffect(()=>{const controller=new AbortController();setDocuments(null);void request<PdfProcessingCapabilities>('source-ingestion/capabilities','GET',undefined,undefined,controller.signal).then(setDocuments).catch(()=>{});return()=>controller.abort();},[provider,status?.configured]);
  const documentProvider=documents?.providers.find(item=>item.provider===provider);
  const [key,setKey]=useState(''),[days,setDays]=useState(30),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const revision=useRef(0),mounted=useRef(false),onChangeRef=useRef(onChange);
  onChangeRef.current=onChange;
  useEffect(()=>{
    mounted.current=true;const current=++revision.current;
    setStatus(null);setState('checking');setKey('');setMessage('');setBusy(false);
    void (provider==='openai'?api.intelligence():api.geminiCredential()).then(value=>{
      if(!mounted.current||current!==revision.current)return;
      const next={configured:value.configured,expiresAt:value.expiresAt};setStatus(next);setState(next.configured?'ready':'setup-required');onChangeRef.current?.(next);
    }).catch(()=>{if(mounted.current&&current===revision.current){setState('error');setMessage('Secure credential storage is unavailable. Check this server’s configured secret store and try again.');}});
    return()=>{mounted.current=false;revision.current++;};
  },[provider]);
  async function perform(action:'save'|'remove'|'validate'|'refresh') {
    if(busy)return;
    const enteredKey=key.trim(),current=++revision.current;setKey('');setBusy(true);setMessage('');setState('checking');
    try {
      let next:SpeechCredentialStatus;
      if(action==='validate') {
        if(provider==='openai')await api.validateIntelligence();else await api.validateGeminiCredential();
        next=await (provider==='openai'?api.intelligence():api.geminiCredential());
      } else if(action==='refresh')next=await (provider==='openai'?api.intelligence():api.geminiCredential());
      else if(action==='remove')next=await (provider==='openai'?api.removeIntelligence():api.removeGeminiCredential());
      else next=await (provider==='openai'?api.saveIntelligence(enteredKey,days):api.saveGeminiCredential(enteredKey,days));
      if(!mounted.current||current!==revision.current)return;
      const safeStatus={configured:next.configured,expiresAt:next.expiresAt};setStatus(safeStatus);setState(next.configured?'ready':'setup-required');onChangeRef.current?.(safeStatus);
      setMessage(action==='validate'?'Connection validated.':action==='save'?'Credential saved.':action==='remove'?'Saved credential removed from Noema.':'Connection status refreshed.');
      if(action==='save'||action==='remove')window.dispatchEvent(new Event('noema:tts-preferences'));
    }catch(error){
      if(!mounted.current||current!==revision.current)return;
      setState('error');const text=error instanceof Error?error.message:'Could not update the connection.';
      setMessage(enteredKey?text.split(enteredKey).join('[redacted]'):text);
    }finally{if(mounted.current&&current===revision.current)setBusy(false);}
  }
  function submit(event:FormEvent){event.preventDefault();void perform('save');}
  return <section className="provider-connection" aria-label={label+' connection'} aria-busy={busy}>
    <div className="ai-setting-row"><strong>{label}</strong><span role="status" data-connection-state={state}>{stateLabels[state]}</span></div>
    <p>Available across all vaults. Credentials stay on the server in its configured secret store (macOS Keychain or explicitly configured server credentials); search indexing is configured separately for each vault.</p>
    {documents&&<div className="section-hint" aria-label="PDF document capabilities"><p>PDF ingestion: {!documents.enabled?'development capability disabled':documentProvider?.available?'credential configured; account model access is checked when a request starts':'provider credential unavailable'}.</p><p>Local PDF extraction: {documents.localExtraction?'available':'unavailable on this server'}. PDF page rendering and admission are checked before use.</p>{documents.enabled&&!!documentProvider?.models.length&&<p>Verified document models: {documentProvider.models.map(model=>model.id).join(', ')}. Writing, speech and embedding models remain separate choices.</p>}</div>}
    <details className="settings-advanced ai-key-settings" onToggle={event=>{if(!event.currentTarget.open)setKey('');}}>
      <summary>Manage {label} connection</summary>
      {status?.configured&&status.expiresAt&&<p>Credential expires {new Date(status.expiresAt).toLocaleString(getLocale())}.</p>}
      <form onSubmit={submit} autoComplete="off">
        <div className="ai-setting-row"><label htmlFor={id+'-key'}>{status?.configured?'Replacement API key':'API key'}</label><input id={id+'-key'} type="password" value={key} onChange={event=>setKey(event.target.value)} autoComplete="new-password" spellCheck={false} autoCapitalize="none" maxLength={provider==='openai'?503:geminiApiKeyMaxLength} required disabled={busy}/></div>
        <div className="ai-setting-row"><label htmlFor={id+'-days'}>Key lifetime in Noema (days)</label><input id={id+'-days'} type="number" min={1} max={365} step={1} required value={days} disabled={busy} onChange={event=>setDays(Number(event.target.value))}/></div>
        <p>Saving makes no provider request. {provider==='openai'?'Validation sends a short synthetic text request to OpenAI using the saved writing model; API charges may apply.':'Validation checks Gemini model access without generating speech or sending note text.'} Expiry stops use in Noema; revoke the key with {label} to disable it everywhere.</p>
        <div className="intelligence-actions"><button className="button" disabled={busy||!key.trim()}>{status?.configured?'Replace key':'Add key'}</button><button type="button" className="button" disabled={busy||!status?.configured} onClick={()=>void perform('validate')}>Validate connection</button><button type="button" className="button danger" disabled={busy||!status?.configured} onClick={()=>void perform('remove')}>Remove key</button><button type="button" className="button" disabled={busy} onClick={()=>void perform('refresh')}>Check setup</button></div>
      </form>
    </details>
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}
