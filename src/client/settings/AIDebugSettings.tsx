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
    <h3 id="ai-debug-heading">AI debug mode</h3>
    <p>Store full request bodies, provider responses, errors, and timestamped stream events in the local activity log. This includes note text sent to OpenAI. API keys and authorization headers are excluded.</p>
    <div className="display-options" role="group" aria-label="AI debug mode">
      <button type="button" disabled={!ready||busy} aria-pressed={!enabled} onClick={()=>void change(false)}>Off</button>
      <button type="button" disabled={!ready||busy} aria-pressed={enabled} onClick={()=>void change(true)}>On</button>
    </div>
    <p className="display-hint">Applies to new AI requests across this app. Open payloads in the activity log to follow responses live. Turning this off keeps existing traces; Clear activity deletes them.</p>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
