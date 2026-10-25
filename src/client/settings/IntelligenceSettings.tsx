import {PersonaComparisonStudio} from './PersonaComparisonStudio';
import {InlineNotice} from '../notifications/InlineNotice';
import {useEffect,useImperativeHandle,useState,type Ref} from 'react';
import {api} from '../api';
import {Icon} from '../components/Icon';
import {Select} from '../components/Select';
import {FormNotice,useFormNotice} from '../notifications/FormNotice';
import {ProviderConnection} from './ProviderConnection';
import {aiPersonas,defaultPersonaId,defaultPersonaExpression,type PersonaExpression,type BuiltinPersonaId} from '../../shared/ai-personas';
import {defaultPageEnrichmentPreferences,intelligenceModels,maxManualRequestsPerMinute,type AIPreferences,type ReasoningEffort} from '../../shared/intelligence';

export type AISettingsHandle={save:()=>Promise<boolean>};

/** AI owns only its category's draft. Credential changes never replace it. */
export function IntelligenceSettings({active=true,ref,onDirtyChange}:{active?:boolean;ref?:Ref<AISettingsHandle>;onDirtyChange?:(changed:boolean)=>void}={}) {
  const [draft,setDraft]=useState<AIPreferences|null>(null),[saved,setSaved]=useState<AIPreferences|null>(null);
  const [connectionReady,setConnectionReady]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [view,setView]=useState<'overview'|'style'|'connections'>('overview');
  const [success,setSuccess,occurrence]=useFormNotice();
  useEffect(()=>{
    if(!active||draft)return;
    let current=true;
    void api.intelligence().then(value=>{if(current){setConnectionReady(value.configured);const next:AIPreferences={model:value.model,reasoningEffort:value.reasoningEffort,personaId:(value.personaId??defaultPersonaId) as BuiltinPersonaId,personaExpression:value.personaExpression??defaultPersonaExpression,manualRequestsPerMinute:value.manualRequestsPerMinute,pageEnrichment:value.pageEnrichment??{...defaultPageEnrichmentPreferences}};setDraft(next);setSaved(next);setError('');}}).catch(()=>{if(current)setError('Could not load AI preferences. Reopen Settings or retry.');});
    return()=>{current=false;};
  },[active,draft,retry]);
  const changed=!!draft&&JSON.stringify(draft)!==JSON.stringify(saved);
  useEffect(()=>{onDirtyChange?.(changed);},[changed,onDirtyChange]);
  useImperativeHandle(ref,()=>({save}));
  async function save():Promise<boolean>{
    if(busy)return false;
    if(!draft||!changed)return true;
    if(!Number.isInteger(draft.manualRequestsPerMinute)||draft.manualRequestsPerMinute<1||draft.manualRequestsPerMinute>maxManualRequestsPerMinute){setView('overview');setError(`Enter a whole number from 1 to ${maxManualRequestsPerMinute} for manual AI requests per minute.`);return false;}
    const submitted=draft;setBusy(true);setError('');setSuccess('');
    try{const value=await api.saveAIPreferences(submitted);const next:AIPreferences={model:value.model,reasoningEffort:value.reasoningEffort,personaId:value.personaId,personaExpression:value.personaExpression??defaultPersonaExpression,manualRequestsPerMinute:value.manualRequestsPerMinute,pageEnrichment:value.pageEnrichment};setDraft(next);setSaved(next);setSuccess('AI preferences saved.');window.dispatchEvent(new Event('noema:persona-preferences'));return true;}
    catch(reason){setError(reason instanceof Error?reason.message:'Could not save AI preferences.');return false;}finally{setBusy(false);}
  }
  function patch(value:Partial<AIPreferences>){setDraft(current=>current?{...current,...value}:current);}
  const enrichment=draft?.pageEnrichment??defaultPageEnrichmentPreferences;
  function modelControl(background=false){const selection=background?enrichment:draft!;return <><div className="ai-setting-row"><label htmlFor={background?'ai-enrichment-model':'ai-model'}>{background?'Page enrichment model':'Writing model'}</label><Select id={background?'ai-enrichment-model':'ai-model'} value={selection.model} disabled={busy} onChange={event=>{const model=intelligenceModels.find(option=>option.id===event.target.value)!;const reasoningEffort=model.efforts.includes(selection.reasoningEffort)?selection.reasoningEffort:model.efforts.includes('none')?'none':'low';patch(background?{pageEnrichment:{model:model.id,reasoningEffort}}:{model:model.id,reasoningEffort});}}>{intelligenceModels.map(model=><option key={model.id} value={model.id}>{model.label}</option>)}</Select></div><div className="ai-setting-row"><label htmlFor={background?'ai-enrichment-reasoning':'ai-reasoning'}>Reasoning effort</label><Select id={background?'ai-enrichment-reasoning':'ai-reasoning'} value={selection.reasoningEffort} disabled={busy} onChange={event=>{const reasoningEffort=event.target.value as ReasoningEffort;patch(background?{pageEnrichment:{...enrichment,reasoningEffort}}:{reasoningEffort});}}>{intelligenceModels.find(model=>model.id===selection.model)?.efforts.map(effort=><option key={effort}>{effort}</option>)}</Select></div></>;}
  const persona=aiPersonas.find(persona=>persona.id===(draft?.personaId??defaultPersonaId));
  return <section className="settings-section intelligence-settings ai-settings" aria-labelledby="intelligence-heading" aria-busy={busy}>
    <header className="ai-settings-heading"><span className="ai-settings-mark"><Icon name="sparkles"/></span><div><h3 id="intelligence-heading">AI preferences</h3><p>Choose how AI writes and works in the background.</p></div></header>
    {error&&<InlineNotice tone="error" title={error} announcement="assertive" actions={!draft&&<button className="button" onClick={()=>setRetry(value=>value+1)}>Retry</button>}/>}
    {view!=='overview'&&<button className="button settings-back" type="button" onClick={()=>setView('overview')}><Icon name="arrow-left"/>Back to AI</button>}
    {view==='overview'&&<div className="ai-connection-card">
      <span className="ai-card-icon"><Icon name="lock"/></span><div><strong>OpenAI connection</strong><small>Shared across your vaults</small></div>
      <span className="ai-connection-badge" data-ready={connectionReady===true} role="status">{connectionReady===null?'Checking…':connectionReady?'Connected':'Setup required'}</span>
      <button className="button" type="button" onClick={()=>setView('connections')}>{connectionReady?'Manage connections':'Set up connection'}</button>
    </div>}
    {view==='connections'&&<><h4>Provider connections</h4><p>Add or update the credentials used for AI and cloud speech.</p><ProviderConnection provider="openai" onChange={value=>setConnectionReady(value.configured)}/><ProviderConnection provider="gemini"/></>}
    {draft&&<form className="ai-preferences-form" onSubmit={event=>{event.preventDefault();void save();}}>
      {view==='overview'&&<>
        <section className="ai-preference-card" aria-labelledby="ai-writing-heading">
          <div className="ai-card-heading"><span className="ai-card-icon"><Icon name="compose"/></span><div><h4 id="ai-writing-heading">Writing assistance</h4><p>Shape how AI helps you write and develop ideas.</p></div></div>
          {modelControl()}
          <div className="ai-style-summary"><div><span>Writing style</span><strong>{persona?.name}</strong><p>{persona?.description}</p></div><button className="button" type="button" disabled={busy} onClick={()=>setView('style')}>Choose writing style<Icon name="chevron"/></button></div>
        </section>
        <section className="ai-preference-card" aria-labelledby="ai-enrichment-heading">
          <div className="ai-card-heading"><span className="ai-card-icon"><Icon name="page"/></span><div><h4 id="ai-enrichment-heading">Page enrichment</h4><p>Titles, summaries, subjects and language, handled in the background.</p></div></div>
          {modelControl(true)}
          <p className="ai-field-hint">Higher reasoning effort may take longer and cost more.</p>
        </section>
        <details className="ai-preference-card ai-advanced"><summary><Icon name="sliders"/><span>Advanced preferences<small>Request limits and usage controls</small></span></summary>
          <div className="ai-setting-row"><label htmlFor="ai-manual-request-limit">Manual AI requests per minute</label><input id="ai-manual-request-limit" type="number" min={1} max={maxManualRequestsPerMinute} step={1} required value={draft.manualRequestsPerMinute||''} disabled={busy} onChange={event=>patch({manualRequestsPerMinute:Number(event.target.value)})}/></div><p className="ai-field-hint">Shared across vaults; excludes background tasks.</p>
        </details>
        <p className="ai-privacy-note"><Icon name="info"/><span>Writing and search send relevant note text and queries to OpenAI. API charges apply.</span></p>
      </>}
      {view==='style'&&<><h4>Find your writing style</h4><p>Choose a voice for generated prose, then try a comparison below.</p><div className="ai-setting-row"><label htmlFor="ai-persona-expression">Persona expression</label><Select id="ai-persona-expression" value={draft.personaExpression??defaultPersonaExpression} disabled={busy} onChange={event=>patch({personaExpression:event.target.value as PersonaExpression})}><option value="subtle">Subtle</option><option value="expressive">Expressive</option><option value="immersive">Immersive</option></Select></div><p>Expression shapes rhetorical method and organisation. Evidence, language, mathematical meaning and task purpose remain protected.</p><fieldset className="ai-personas"><legend>Writing style</legend><p>Style for generated prose, shared across vaults. Factual standards stay independent.</p>{aiPersonas.map(persona=><label className="ai-persona-card" key={persona.id}><input type="radio" name="ai-persona" value={persona.id} checked={(draft.personaId??defaultPersonaId)===persona.id} disabled={busy} onChange={()=>patch({personaId:persona.id as BuiltinPersonaId})}/><span><strong>{persona.name}</strong><span>{persona.description}</span><small>Illustrative profile sample: “{persona.sample}”</small></span></label>)}</fieldset><PersonaComparisonStudio active={active} modelSettings={{model:draft.model,reasoningEffort:draft.reasoningEffort}} expression={draft.personaExpression??defaultPersonaExpression} disabled={busy} onChoose={(personaId,personaExpression)=>patch({personaId,personaExpression})}/></>}
    </form>}
    {!draft&&!error&&<p role="status">Loading AI preferences…</p>}
    <FormNotice message={success} occurrence={occurrence} onDismiss={()=>setSuccess('')}/>
  </section>;
}
