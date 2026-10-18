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
    <h3 id="embedding-heading">Semantic search & embeddings</h3>
    <p>Create and persist page and source embeddings in the backend for semantic search. Settings and activity apply to {vault?.name||'the current vault'}.</p>
    {!vault||vault.locked?<p>Unlock a vault to configure embeddings and search its pages and sources.</p>:<>
      {loading&&<p role="status">Loading embeddings…</p>}
      {status&&<>
        <div className="intelligence-status">{status.model} · {status.dimensions.toLocaleString()} dimensions<small>{status.counts.indexed} current · {status.counts.partial??0} partially indexed · {status.counts.missing} missing · {status.counts.stale} stale · {status.counts.ineligible} ineligible</small></div>
        {!status.configured&&<p className="embedding-notice">Save an OpenAI API key above before processing embeddings or searching. Settings can be saved now.</p>}
        <form onSubmit={save}>
          <label className="embedding-toggle"><input type="checkbox" checked={settings.automatic} disabled={busy} onChange={event=>setSettings(current=>({...current,automatic:event.target.checked}))}/><span>Automatically create embeddings when eligible pages or sources change</span></label>
          <label htmlFor="embedding-minimum">Minimum content characters</label>
          <input id="embedding-minimum" type="number" min={20} max={2000} step={1} required value={settings.minCharacters} disabled={busy} onChange={event=>setSettings(current=>({...current,minCharacters:Number(event.target.value)}))}/>
          <p>Eligibility is checked on saved page and extracted source text. Empty, trashed, and short content are excluded. Pages adapt from one embedding to sections and passages as they grow, without a whole-Page size limit. Sources are split into overlapping passages covering the full extracted text. Passage embeddings resume independently after interruptions. Changed eligible notes are queued again; unchanged notes keep their saved embedding.</p>
          <details><summary>Adaptive Page indexing</summary><p>Thresholds use tokens. Hysteresis prevents repeated strategy changes while editing.</p>{([
            ['smallTokens','Small Page token threshold',100,4000],['mediumTokens','Medium Page token threshold',801,50000],['targetTokens','Passage target tokens',100,2000],['overlapTokens','Passage overlap tokens',0,999],['hysteresisTokens','Threshold hysteresis tokens',0,1999],['debounceMs','Re-index debounce (milliseconds)',5000,15000]
          ] as const).map(([key,label,min,max])=><label key={key}>{label}<input type="number" min={min} max={max} required disabled={busy} value={(settings.pagePolicy??defaultPageIndexPolicy)[key]} onChange={event=>setSettings(current=>({...current,pagePolicy:{...defaultPageIndexPolicy,...current.pagePolicy,[key]:Number(event.target.value)}}))}/></label>)}</details>
          <button className="button" disabled={busy||!changed}>Save embedding settings</button>
        </form>
        <div className="embedding-backfill">
          <h4>Index existing pages and sources</h4><p>Use saved criteria to queue pages and sources in this vault. Active jobs are deduplicated.</p>
          <div className="intelligence-actions">
            <button className="button" disabled={busy||changed||!status.counts.missing} onClick={()=>void perform(async()=>{const result=await api.enqueueEmbeddings(vaultId!,'missing');return `Queued ${result.queued} items; skipped ${result.skipped}.`;})}>Queue missing ({status.counts.missing})</button>
            <button className="button" disabled={busy||changed||!status.counts.eligible} onClick={()=>void perform(async()=>{const result=await api.enqueueEmbeddings(vaultId!,'eligible');return `Queued ${result.queued} items; skipped ${result.skipped}.`;})}>Queue eligible / stale</button>
          </div>
          {changed&&<p>Save your criteria before indexing existing notes.</p>}
          <details className="embedding-eligibility"><summary>Content eligibility ({status.notes.length})</summary><ul>{status.notes.map(note=><li key={(note.kind??'page')+':'+note.pageId}><button className="ai-activity-link" onClick={()=>open(note.pageId,note.kind)}>{note.title||'Untitled'}</button><small>{note.indexingStatus??note.state}{note.strategy?` · ${note.strategy}`:''} · {note.reason}{note.totalPassages!==undefined?` · ${note.indexedPassages??0}/${note.totalPassages} ${note.kind==='page'?'segments':'passages'} indexed`:null}</small></li>)}</ul>{!status.notes.length&&<p>No saved pages or sources in this vault.</p>}</details>
        </div>
        <div className="embedding-search">
          <h4>Search by meaning</h4><p>Search queries are embedded with the same model and compared with current saved page and source embeddings.</p>
          <form onSubmit={event=>void search(event)}><label className="sr-only" htmlFor="semantic-search">Semantic search query</label><input id="semantic-search" type="search" value={query} maxLength={2000} placeholder="Find pages or sources about an idea…" onChange={event=>setQuery(event.target.value)} disabled={searchBusy}/><button className="button primary" disabled={searchBusy||!query.trim()||!status.configured||!(status.counts.indexed+(status.counts.partial??0))}>{searchBusy?'Searching…':'Search'}</button></form>
          {!(status.counts.indexed+(status.counts.partial??0))&&<p>Index eligible pages or sources to start searching.</p>}
          {results&&<div aria-live="polite"><p>{results.results.length} results · similarity is a ranking score</p><ul className="embedding-results">{results.results.map(result=><li key={result.passageId??result.id}><button onClick={()=>{if(result.reference)void onOpenPassage(vaultId!,result.reference).catch(reason=>setError(String(reason)));else if(result.pageReference)void onOpenPage(vaultId!,result.id,result.pageReference).catch(reason=>setError(String(reason)));else open(result.id,result.kind);}}><strong>{result.title||'Untitled'}</strong><small>Similarity {result.score.toFixed(3)} · updated {new Date(result.updated_at).toLocaleDateString()}</small></button></li>)}</ul>{!results.results.length&&<p>No indexed pages or sources match this search.</p>}</div>}
        </div>
        <div className="embedding-activity">
          <h4>Queue & history</h4><p>Activity refreshes every 5 seconds. Latest {status.jobs.length} jobs, including timestamps, attempts, token usage, and failure logs.</p>
          <div className="embedding-job-tabs" role="group" aria-label="Embedding activity view"><button className="button" aria-pressed={jobView==='queue'} onClick={()=>setJobView('queue')}>Queue ({status.counts.queued+status.counts.running})</button><button className="button" aria-pressed={jobView==='history'} onClick={()=>setJobView('history')}>History / logs</button><button className="button" disabled={busy} onClick={()=>void perform(async()=> 'Activity refreshed.')}>Refresh</button></div>
          <ul className="embedding-job-list">{jobs.map(job=><li key={job.id}><div className="embedding-job-heading"><span>{(job.pageId||job.sourceId)?<button className="ai-activity-link" onClick={()=>open(job.sourceId??job.pageId!,job.sourceId?'entity':'page')}>{job.title||'Untitled'}</button>:job.title||'Unavailable note'}</span><span className={'ai-activity-status '+job.status}>{job.status}</span></div><small>Queued {new Date(job.createdAt).toLocaleString()} · {job.attempts} attempts · {job.reason}{job.passageId?' · Passage embedding':job.segmentId?' · Page segment embedding':''}{job.tokens!==null?` · ${job.tokens.toLocaleString()} tokens`:''}</small>{job.startedAt&&<small>Started {new Date(job.startedAt).toLocaleString()}{job.finishedAt?` · finished ${new Date(job.finishedAt).toLocaleString()}`:''}</small>}{job.status==='queued'&&<small>Next attempt {new Date(job.nextAttemptAt).toLocaleString()}</small>}{job.error&&<p className="embedding-job-error">{job.error}</p>}{(job.status==='failed'||job.status==='interrupted')&&<button className="button" disabled={busy||(!job.pageId&&!job.sourceId)} onClick={()=>void perform(async()=>{const result=await api.retryEmbedding(vaultId!,job.id);return result.queued?'Job queued for another attempt.':'No job needed: this note is already indexed, ineligible, or queued.';})}>Retry</button>}</li>)}</ul>
          {!jobs.length&&<p>{jobView==='queue'?'No pending embedding jobs.':'No completed activity yet. Index content or enable automatic embeddings to begin.'}</p>}
        </div>
        <p className="intelligence-note">Embeddings are saved locally in this vault. Indexing sends eligible page and source text to OpenAI, and searches send your query. API usage may incur charges.</p>
      </>}
      {error&&<p role="alert" className="embedding-job-error">{error}</p>}
      <p role="status" aria-live="polite">{busy?'Working…':message}</p>
    </>}
  </section>;
}
