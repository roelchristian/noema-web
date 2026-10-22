import {t as uiText} from '../i18n';
import { useEffect, useState } from 'react';
import type {AIDebugSettings as DebugSettings} from '../../shared/intelligence';
import { api } from '../api';

export function AIDebugSettings() {
  const [settings,setSettings]=useState<DebugSettings>({enabled:false}),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    let active=true;
    void api.aiDebugSettings().then(value=>{if(active){setSettings(value);setReady(true);}}).catch(()=>{if(active)setError('Could not load AI debug settings.');});
    return()=>{active=false;};
  },[]);
  const fullActive=settings.enabled&&settings.mode==='full'&&!!settings.fullUntil&&Date.parse(settings.fullUntil)>now;
  useEffect(()=>{
    if(!fullActive)return;
    const timer=setTimeout(()=>setNow(Date.now()),Math.max(1,Date.parse(settings.fullUntil!)-Date.now()));
    return()=>clearTimeout(timer);
  },[fullActive,settings.fullUntil]);
  async function change(enabled:boolean,fullTraceMinutes?:number) {
    setBusy(true);setError('');
    try {setSettings(await api.saveAIDebugSettings(enabled,fullTraceMinutes));setNow(Date.now());}
    catch(error){setError(error instanceof Error?error.message:'Could not save debug settings.');}
    finally{setBusy(false);}
  }
  return <section className="settings-section" aria-labelledby="ai-debug-heading">
    <h3 id="ai-debug-heading">{uiText("AI debug mode")}</h3>
    <p>{uiText("Compact diagnostics save request sizes, timings, stream summaries and limited output excerpts locally. API keys and embedding vectors are excluded.")}</p>
    <div className="display-options" role="group" aria-label={uiText("AI debug mode")}>
      <button type="button" disabled={!ready||busy} aria-pressed={!settings.enabled} onClick={()=>void change(false)}>{uiText("Off")}</button>
      <button type="button" disabled={!ready||busy} aria-pressed={settings.enabled&&!fullActive} onClick={()=>void change(true,0)}>{uiText("Compact")}</button>
    </div>
    <p className="display-hint">{uiText("Applies to new requests across vaults. Debug traces expire after 30 days. Activity and token usage remain available for one year; trace cleanup preserves usage totals.")}</p>
    <details><summary>{uiText("Full trace diagnostic session")}</summary>
      <p>{uiText("Full traces can include private note text, prompts and provider output. Capture is bounded and may be truncated. Enable only while reproducing an issue.")}</p>
      {fullActive&&<p role="status">{uiText("Full capture enabled until")} {new Date(settings.fullUntil!).toLocaleTimeString()}.</p>}
      <button className="button" type="button" disabled={!ready||busy} onClick={()=>void change(true,fullActive?0:15)}>{uiText(fullActive?"Stop full capture":"Capture full traces for 15 minutes")}</button>
    </details>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
