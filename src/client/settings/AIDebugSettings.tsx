import {t as uiText} from '../i18n';
import { useEffect, useState } from 'react';
import { api } from '../api';

export function AIDebugSettings() {
  const [enabled,setEnabled]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    void api.aiDebugSettings().then(value=>{if(active){setEnabled(value.enabled);setReady(true);}}).catch(()=>{if(active)setError('Could not load AI debug settings.');});
    return()=>{active=false;};
  },[]);
  async function change(value:boolean) {
    setBusy(true);setError('');
    try {setEnabled((await api.saveAIDebugSettings(value)).enabled);}
    catch(error){setError(error instanceof Error?error.message:'Could not save debug settings.');}
    finally{setBusy(false);}
  }
  return <section className="settings-section" aria-labelledby="ai-debug-heading">
    <h3 id="ai-debug-heading">{uiText("AI debug mode")}</h3>
    <p>{uiText("Save full AI requests and responses locally, including note text. API keys are excluded.")}</p>
    <div className="display-options" role="group" aria-label={uiText("AI debug mode")}>
      <button type="button" disabled={!ready||busy} aria-pressed={!enabled} onClick={()=>void change(false)}>{uiText("Off")}</button>
      <button type="button" disabled={!ready||busy} aria-pressed={enabled} onClick={()=>void change(true)}>{uiText("On")}</button>
    </div>
    <p className="display-hint">{uiText("Applies to new requests across vaults. Use Clear activity to delete saved traces.")}</p>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
