import {PersonaComparisonStudio} from './PersonaComparisonStudio';
import {InlineNotice} from '../notifications/InlineNotice';
import {useEffect,useState,type FormEvent} from 'react';
import {api} from '../api';
import {Select} from '../components/Select';
import {FormNotice,useFormNotice} from '../notifications/FormNotice';
import {ProviderConnection} from './ProviderConnection';
import {aiPersonas,defaultPersonaId,defaultPersonaExpression,type PersonaExpression,type BuiltinPersonaId} from '../../shared/ai-personas';
import {defaultPageEnrichmentPreferences,intelligenceModels,maxManualRequestsPerMinute,type AIPreferences,type ReasoningEffort} from '../../shared/intelligence';

/** AI owns only its category's draft. Credential changes never replace it. */
export function IntelligenceSettings({active=true}:{active?:boolean}={}) {
  const [draft,setDraft]=useState<AIPreferences|null>(null),[saved,setSaved]=useState<AIPreferences|null>(null);
  const [connectionReady,setConnectionReady]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [view,setView]=useState<'overview'|'style'|'enrichment'|'advanced'|'connections'>('overview');
  const [success,setSuccess,occurrence]=useFormNotice();
  useEffect(()=>{
    if(!active||draft)return;
    let current=true;
    void api.intelligence().then(value=>{if(current){setConnectionReady(value.configured);const next:AIPreferences={model:value.model,reasoningEffort:value.reasoningEffort,personaId:(value.personaId??defaultPersonaId) as BuiltinPersonaId,personaExpression:value.personaExpression??defaultPersonaExpression,manualRequestsPerMinute:value.manualRequestsPerMinute,pageEnrichment:value.pageEnrichment??{...defaultPageEnrichmentPreferences}};setDraft(next);setSaved(next);setError('');}}).catch(()=>{if(current)setError('Could not load AI preferences. Reopen Settings or retry.');});
    return()=>{current=false;};
  },[active,draft,retry]);
  const changed=!!draft&&JSON.stringify(draft)!==JSON.stringify(saved);
  async function save(event:FormEvent){
    event.preventDefault();if(!draft||busy)return;
    const submitted=draft;setBusy(true);setError('');setSuccess('');
    try{const value=await api.saveAIPreferences(submitted);const next:AIPreferences={model:value.model,reasoningEffort:value.reasoningEffort,personaId:value.personaId,personaExpression:value.personaExpression??defaultPersonaExpression,manualRequestsPerMinute:value.manualRequestsPerMinute,pageEnrichment:value.pageEnrichment};setDraft(next);setSaved(next);setSuccess('AI preferences saved.');window.dispatchEvent(new Event('noema:persona-preferences'));}
    catch(reason){setError(reason instanceof Error?reason.message:'Could not save AI preferences.');}finally{setBusy(false);}
  }
  function patch(value:Partial<AIPreferences>){setDraft(current=>current?{...current,...value}:current);}
  const enrichment=draft?.pageEnrichment??defaultPageEnrichmentPreferences;
  function modelControl(background=false){const selection=background?enrichment:draft!;return <><div className="ai-setting-row"><label htmlFor={background?'ai-enrichment-model':'ai-model'}>{background?'Page enrichment model':'Writing model'}</label><Select id={background?'ai-enrichment-model':'ai-model'} value={selection.model} disabled={busy} onChange={event=>{const model=intelligenceModels.find(option=>option.id===event.target.value)!;const reasoningEffort=model.efforts.includes(selection.reasoningEffort)?selection.reasoningEffort:model.efforts.includes('none')?'none':'low';patch(background?{pageEnrichment:{model:model.id,reasoningEffort}}:{model:model.id,reasoningEffort});}}>{intelligenceModels.map(model=><option key={model.id} value={model.id}>{model.label}</option>)}</Select></div>{(background||view==='advanced')&&<div className="ai-setting-row"><label htmlFor={background?'ai-enrichment-reasoning':'ai-reasoning'}>Reasoning effort</label><Select id={background?'ai-enrichment-reasoning':'ai-reasoning'} value={selection.reasoningEffort} disabled={busy} onChange={event=>{const reasoningEffort=event.target.value as ReasoningEffort;patch(background?{pageEnrichment:{...enrichment,reasoningEffort}}:{reasoningEffort});}}>{intelligenceModels.find(model=>model.id===selection.model)?.efforts.map(effort=><option key={effort}>{effort}</option>)}</Select></div>}</>;}
  return <section className="settings-section intelligence-settings" aria-labelledby="intelligence-heading">
    <h3 id="intelligence-heading">AI</h3>
    {view==='overview'&&<p>Writing and search send relevant note text and queries to OpenAI. API charges apply.</p>}
    {view!=='overview'&&<button className="button settings-back" type="button" onClick={()=>setView('overview')}>Back to AI</button>}
    {view==='overview'&&<div className="settings-overview-row"><span><strong>OpenAI</strong><small>{connectionReady===null?'Checking…':connectionReady?'Ready':'Setup required'} · available across all vaults</small></span><button className="button" onClick={()=>setView('connections')}>Manage connections</button></div>}
    {view==='connections'&&<><ProviderConnection provider="openai" onChange={value=>setConnectionReady(value.configured)}/><ProviderConnection provider="gemini"/></>}
    {draft&&<form className="ai-preferences-form" onSubmit={save}>
      {view==='overview'&&<><h4>Writing assistance</h4><div className="settings-overview-row"><span><strong>Writing style</strong><small>{aiPersonas.find(persona=>persona.id===(draft.personaId??defaultPersonaId))?.name}</small></span><button className="button" type="button" onClick={()=>setView('style')}>Choose writing style</button></div>{modelControl()}<h4>Background processing</h4><div className="settings-overview-row"><span><strong>Page enrichment</strong><small>Automatic titles, summaries and classification</small></span><button className="button" type="button" onClick={()=>setView('enrichment')}>Configure enrichment</button></div><button className="button" type="button" onClick={()=>setView('advanced')}>Advanced AI settings</button></>}
      {view==='style'&&<><div className="ai-setting-row"><label htmlFor="ai-persona-expression">Persona expression</label><Select id="ai-persona-expression" value={draft.personaExpression??defaultPersonaExpression} disabled={busy} onChange={event=>patch({personaExpression:event.target.value as PersonaExpression})}><option value="subtle">Subtle</option><option value="expressive">Expressive</option><option value="immersive">Immersive</option></Select></div><p>Expression shapes rhetorical method and organisation. Evidence, language, mathematical meaning and task purpose remain protected.</p><fieldset className="ai-personas"><legend>Writing style</legend><p>Style for generated prose, shared across vaults. Factual standards stay independent.</p>{aiPersonas.map(persona=><label className="ai-persona-card" key={persona.id}><input type="radio" name="ai-persona" value={persona.id} checked={(draft.personaId??defaultPersonaId)===persona.id} disabled={busy} onChange={()=>patch({personaId:persona.id as BuiltinPersonaId})}/><span><strong>{persona.name}</strong><span>{persona.description}</span><small>Illustrative profile sample: “{persona.sample}”</small></span></label>)}</fieldset><PersonaComparisonStudio active={active} modelSettings={{model:draft.model,reasoningEffort:draft.reasoningEffort}} expression={draft.personaExpression??defaultPersonaExpression} disabled={busy} onChoose={(personaId,personaExpression)=>patch({personaId,personaExpression})}/></>}
      {view==='enrichment'&&<><h4>Page enrichment</h4>{modelControl(true)}<p>Used for page titles, subjects, language and summaries. Higher effort may take longer and cost more.</p></>}
      {view==='advanced'&&<><h4>Advanced AI settings</h4>{modelControl()}<p>Higher effort may take longer and cost more.</p><div className="ai-setting-row"><label htmlFor="ai-manual-request-limit">Manual AI requests per minute</label><input id="ai-manual-request-limit" type="number" min={1} max={maxManualRequestsPerMinute} step={1} required value={draft.manualRequestsPerMinute||''} disabled={busy} onChange={event=>patch({manualRequestsPerMinute:Number(event.target.value)})}/></div><p>Shared across vaults; excludes background tasks.</p></>}
      <div className="intelligence-actions"><button className="button" disabled={busy||!changed}>Save AI preferences</button></div>
    </form>}
    {!draft&&!error&&<p role="status">Loading AI preferences…</p>}
    {error&&<InlineNotice tone="error" title={error} announcement="assertive" actions={!draft&&<button className="button" onClick={()=>setRetry(value=>value+1)}>Retry</button>}/>}
    <FormNotice message={success} occurrence={occurrence} onDismiss={()=>setSuccess('')}/>
  </section>;
}
