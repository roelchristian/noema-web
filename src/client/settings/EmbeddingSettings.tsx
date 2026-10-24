import {SuccessNotice} from '../components/SuccessNotice';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {defaultPageIndexPolicy} from '../../shared/embeddings';
import type {PageReference} from '../../shared/embeddings';
import { useEffect, useState, type FormEvent } from 'react';
import type { SourceReference, Vault } from '../../shared/domain';
import type { EmbeddingSettings as Preferences, EmbeddingStatus, SemanticSearchResults } from '../../shared/embeddings';
import { api } from '../api';

export function EmbeddingSettings({vault,onOpenPage,onOpenEntity,onOpenPassage}: {vault: Vault | null; onOpenPassage:(vaultId:string,reference:SourceReference)=>Promise<void>; onOpenPage: (vaultId:string,pageId:string,reference?:PageReference)=>Promise<void>; onOpenEntity: (vaultId:string,entityId:string)=>Promise<void>}) {
  const [status,setStatus]=useState<EmbeddingStatus|null>(null);
  const [settings,setSettings]=useState<Preferences>({automatic:false,minCharacters:100});
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [query,setQuery]=useState(''),[results,setResults]=useState<SemanticSearchResults|null>(null),[searchBusy,setSearchBusy]=useState(false);
  const [jobView,setJobView]=useState<'queue'|'history'>('queue');
  const vaultId=vault?.id;
  useEffect(()=>{
    if(!vaultId||vault.locked){setLoading(false);return;}
    let active=true,inFlight=false;
    async function refresh(initial=false) {
      if(inFlight)return;
      inFlight=true;
      try {const next=await api.embeddings(vaultId!);if(active){setStatus(next);if(initial)setSettings(next.settings);setError('');}}
      catch(reason){if(active)setError(reason instanceof Error?reason.message:'Could not load embedding activity.');}
      finally{inFlight=false;if(active)setLoading(false);}
    }
    void refresh(true);
    const timer=window.setInterval(()=>void refresh(),5000);
    return()=>{active=false;window.clearInterval(timer);};
  },[vaultId,vault?.locked]);
  async function perform(work:()=>Promise<string>) {
    setBusy(true);setError('');setMessage('');
    try {setMessage(await work());if(vaultId)setStatus(await api.embeddings(vaultId));}
    catch(reason){setError(reason instanceof Error?reason.message:'Request failed.');}
    finally{setBusy(false);}
  }
  function save(event:FormEvent) {event.preventDefault();void perform(async()=>{await api.saveEmbeddingSettings(vaultId!,settings);return 'Embedding settings saved for this vault.';});}
  async function search(event:FormEvent) {
    event.preventDefault();setSearchBusy(true);setError('');setResults(null);
    try {setResults(await api.semanticSearch(vaultId!,query.trim()));}
    catch(reason){setError(reason instanceof Error?reason.message:'Search failed.');}
    finally{setSearchBusy(false);}
  }
  function open(id:string,kind:'page'|'entity'='page') {void (kind==='entity'?onOpenEntity(vaultId!,id):onOpenPage(vaultId!,id)).catch(reason=>setError(reason instanceof Error?reason.message:'Could not open note.'));}
  const changed=!!status&&(settings.automatic!==status.settings.automatic||settings.minCharacters!==status.settings.minCharacters||JSON.stringify(settings.pagePolicy??defaultPageIndexPolicy)!==JSON.stringify(status.settings.pagePolicy??defaultPageIndexPolicy));
  const jobs=status?.jobs.filter(job=>jobView==='queue'?job.status==='queued'||job.status==='running':job.status!=='queued'&&job.status!=='running')??[];
  return <section className="settings-section embedding-settings" aria-labelledby="embedding-heading">
    <h3 id="embedding-heading">{uiText("Semantic search & embeddings")}</h3>
    <p>{uiText("Find pages and sources by meaning in") + " "}{vault?.name||uiText("the current vault")}.</p>
    {!vault||vault.locked?<p>{uiText("Unlock a vault to configure embeddings and search its pages and sources.")}</p>:<>
      {loading&&<p role="status">{uiText("Loading embeddings…")}</p>}
      {status&&<>
        <div className="intelligence-status">{status.model} · {status.dimensions.toLocaleString(getLocale())}{" " + uiText("dimensions")}<small>{status.counts.indexed}{" " + uiText("current ·") + " "}{status.counts.partial??0}{" " + uiText("partially indexed ·") + " "}{status.counts.missing}{" " + uiText("missing ·") + " "}{status.counts.stale}{" " + uiText("stale ·") + " "}{status.counts.ineligible}{" " + uiText("ineligible")}</small></div>
        {!status.configured&&<p className="embedding-notice">{uiText("Add an OpenAI API key above to index and search.")}</p>}
        <form onSubmit={save}>
          <label className="embedding-toggle"><input type="checkbox" checked={settings.automatic} disabled={busy} onChange={event=>setSettings(current=>({...current,automatic:event.target.checked}))}/><span>{uiText("Automatically index new and updated content")}</span></label>
          <label htmlFor="embedding-minimum">{uiText("Minimum content length (characters)")}</label>
          <input id="embedding-minimum" type="number" min={20} max={2000} step={1} required value={settings.minCharacters} disabled={busy} onChange={event=>setSettings(current=>({...current,minCharacters:Number(event.target.value)}))}/>
          <p>{uiText("Skip empty, trashed, or short content. Pages and sources are indexed in passages as needed.")}</p>
          <details><DisclosureSummary>{uiText("Adaptive Page indexing")}</DisclosureSummary><p>{uiText("Thresholds use tokens. Hysteresis prevents repeated strategy changes while editing.")}</p>{([
            ['smallTokens','Small Page token threshold',100,4000],['mediumTokens','Medium Page token threshold',801,50000],['targetTokens','Passage target tokens',100,2000],['overlapTokens','Passage overlap tokens',0,999],['hysteresisTokens','Threshold hysteresis tokens',0,1999],['debounceMs','Re-index debounce (milliseconds)',5000,15000]
          ] as const).map(([key,label,min,max])=><label key={key}>{label}<input type="number" min={min} max={max} required disabled={busy} value={(settings.pagePolicy??defaultPageIndexPolicy)[key]} onChange={event=>setSettings(current=>({...current,pagePolicy:{...defaultPageIndexPolicy,...current.pagePolicy,[key]:Number(event.target.value)}}))}/></label>)}</details>
          <button className="button" disabled={busy||!changed}>{uiText("Save embedding settings")}</button>
        </form>
        <div className="embedding-backfill">
          <h4>{uiText("Index existing pages and sources")}</h4><p>{uiText("Queue content using your saved criteria.")}</p>
          <div className="intelligence-actions">
            <button className="button" disabled={busy||changed||!status.counts.missing} onClick={()=>void perform(async()=>{const result=await api.enqueueEmbeddings(vaultId!,'missing');return `Queued ${result.queued} items; skipped ${result.skipped}.`;})}>{uiText("Queue missing (")}{status.counts.missing})</button>
            <button className="button" disabled={busy||changed||!status.counts.eligible} onClick={()=>void perform(async()=>{const result=await api.enqueueEmbeddings(vaultId!,'eligible');return `Queued ${result.queued} items; skipped ${result.skipped}.`;})}>{uiText("Queue eligible / stale")}</button>
          </div>
          {changed&&<p>{uiText("Save your criteria before indexing existing notes.")}</p>}
          <details className="embedding-eligibility"><DisclosureSummary>{uiText("Content eligibility (")}{status.notes.length})</DisclosureSummary><ul>{status.notes.map(note=><li key={(note.kind??'page')+':'+note.pageId}><button className="ai-activity-link" onClick={()=>open(note.pageId,note.kind)}>{note.title||uiText("Untitled")}</button><small>{note.indexingStatus??note.state}{note.strategy?` · ${note.strategy}`:''} · {note.reason}{note.totalPassages!==undefined?uiText(" · {value0}/{value1} {value2} indexed",{value0: note.indexedPassages??0,value1: note.totalPassages,value2: note.kind==='page'?'segments':'passages'}):null}</small></li>)}</ul>{!status.notes.length&&<p>{uiText("No saved pages or sources in this vault.")}</p>}</details>
        </div>
        <div className="embedding-search">
          <h4>{uiText("Search by meaning")}</h4>
          <form onSubmit={event=>void search(event)}><label className="sr-only" htmlFor="semantic-search">{uiText("Semantic search query")}</label><input id="semantic-search" type="search" value={query} maxLength={2000} placeholder={uiText("Find pages or sources about an idea…")} onChange={event=>setQuery(event.target.value)} disabled={searchBusy}/><button className="button primary" disabled={searchBusy||!query.trim()||!status.configured||!(status.counts.indexed+(status.counts.partial??0))}>{searchBusy?uiText("Searching…"):uiText("Search")}</button></form>
          {!(status.counts.indexed+(status.counts.partial??0))&&<p>{uiText("Index eligible pages or sources to start searching.")}</p>}
          {results&&<div aria-live="polite"><p>{results.results.length}{" " + uiText("results · similarity is a ranking score")}</p><ul className="embedding-results">{results.results.map(result=><li key={result.passageId??result.id}><button onClick={()=>{if(result.reference)void onOpenPassage(vaultId!,result.reference).catch(reason=>setError(String(reason)));else if(result.pageReference)void onOpenPage(vaultId!,result.id,result.pageReference).catch(reason=>setError(String(reason)));else open(result.id,result.kind);}}><strong>{result.title||uiText("Untitled")}</strong><small>{uiText("Similarity") + " "}{result.score.toFixed(3)}{" " + uiText("· updated") + " "}{new Date(result.updated_at).toLocaleDateString(getLocale())}</small></button></li>)}</ul>{!results.results.length&&<p>{uiText("No indexed pages or sources match this search.")}</p>}</div>}
        </div>
        <div className="embedding-activity">
          <h4>{uiText("Queue & history")}</h4><p>{uiText("Latest") + " "}{status.jobs.length}{" " + uiText("jobs. Refreshes automatically.")}</p>
          <div className="embedding-job-tabs" role="group" aria-label={uiText("Embedding activity view")}><button className="button" aria-pressed={jobView==='queue'} onClick={()=>setJobView('queue')}>{uiText("Queue (")}{status.counts.queued+status.counts.running})</button><button className="button" aria-pressed={jobView==='history'} onClick={()=>setJobView('history')}>{uiText("History / logs")}</button><button className="button" disabled={busy} onClick={()=>void perform(async()=> 'Activity refreshed.')}>{uiText("Refresh")}</button></div>
          <ul className="embedding-job-list">{jobs.map(job=><li key={job.id}><div className="embedding-job-heading"><span>{(job.pageId||job.sourceId)?<button className="ai-activity-link" onClick={()=>open(job.sourceId??job.pageId!,job.sourceId?'entity':'page')}>{job.title||uiText("Untitled")}</button>:job.title||uiText("Unavailable note")}</span><span className={'ai-activity-status '+job.status}>{uiText(job.status)}</span></div><small>{uiText("Queued") + " "}{new Date(job.createdAt).toLocaleString(getLocale())} · {job.attempts}{" " + uiText("attempts ·") + " "}{job.reason}{job.passageId?uiText(" · Passage embedding"):job.segmentId?uiText(" · Page segment embedding"):''}{job.tokens!==null?uiText(" · {value0} tokens",{value0: job.tokens.toLocaleString(getLocale())}):''}</small>{job.startedAt&&<small>{uiText("Started") + " "}{new Date(job.startedAt).toLocaleString(getLocale())}{job.finishedAt?uiText(" · finished {value0}",{value0: new Date(job.finishedAt).toLocaleString(getLocale())}):''}</small>}{job.status==='queued'&&<small>{uiText("Next attempt") + " "}{new Date(job.nextAttemptAt).toLocaleString(getLocale())}</small>}{job.error&&<p className="embedding-job-error">{job.error}</p>}{(job.status==='failed'||job.status==='interrupted')&&<button className="button" disabled={busy||(!job.pageId&&!job.sourceId)} onClick={()=>void perform(async()=>{const result=await api.retryEmbedding(vaultId!,job.id);return result.queued?'Job queued for another attempt.':'No job needed: this note is already indexed, ineligible, or queued.';})}>{uiText("Retry")}</button>}</li>)}</ul>
          {!jobs.length&&<p>{jobView==='queue'?uiText("No pending embedding jobs."):uiText("No completed activity yet. Index content or enable automatic embeddings to begin.")}</p>}
        </div>
        <p className="intelligence-note">{uiText("Indexing sends content to OpenAI; searches send your query. Embeddings are stored in this vault. API charges apply.")}</p>
      </>}
      {error&&<p role="alert" className="embedding-job-error">{error}</p>}
      {busy?<p role="status">{uiText("Working…")}</p>:<SuccessNotice inline message={message} onDismiss={()=>setMessage('')}/>}
    </>}
  </section>;
}
