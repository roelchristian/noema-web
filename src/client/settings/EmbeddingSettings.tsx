import { useEffect, useState, type FormEvent } from 'react';
import type { Vault } from '../../shared/domain';
import type { EmbeddingSettings as Preferences, EmbeddingStatus, SemanticSearchResults } from '../../shared/embeddings';
import { api } from '../api';

export function EmbeddingSettings({vault,onOpenPage}: {vault: Vault | null; onOpenPage: (vaultId:string,pageId:string)=>Promise<void>}) {
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
  function open(pageId:string) {void onOpenPage(vaultId!,pageId).catch(reason=>setError(reason instanceof Error?reason.message:'Could not open note.'));}
  const changed=!!status&&(settings.automatic!==status.settings.automatic||settings.minCharacters!==status.settings.minCharacters);
  const jobs=status?.jobs.filter(job=>jobView==='queue'?job.status==='queued'||job.status==='running':job.status!=='queued'&&job.status!=='running')??[];
  return <section className="settings-section embedding-settings" aria-labelledby="embedding-heading">
    <h3 id="embedding-heading">Semantic search & embeddings</h3>
    <p>Create and persist note embeddings in the backend for semantic search. Settings and activity apply to {vault?.name||'the current vault'}.</p>
    {!vault||vault.locked?<p>Unlock a vault to configure embeddings and search its notes.</p>:<>
      {loading&&<p role="status">Loading embeddings…</p>}
      {status&&<>
        <div className="intelligence-status">{status.model} · {status.dimensions.toLocaleString()} dimensions<small>{status.counts.indexed} current · {status.counts.missing} missing · {status.counts.stale} stale · {status.counts.ineligible} ineligible</small></div>
        {!status.configured&&<p className="embedding-notice">Save an OpenAI API key above before processing embeddings or searching. Settings can be saved now.</p>}
        <form onSubmit={save}>
          <label className="embedding-toggle"><input type="checkbox" checked={settings.automatic} disabled={busy} onChange={event=>setSettings(current=>({...current,automatic:event.target.checked}))}/><span>Automatically create embeddings when eligible notes are saved</span></label>
          <label htmlFor="embedding-minimum">Minimum note characters</label>
          <input id="embedding-minimum" type="number" min={20} max={2000} step={1} required value={settings.minCharacters} disabled={busy} onChange={event=>setSettings(current=>({...current,minCharacters:Number(event.target.value)}))}/>
          <p>Eligibility is checked on saved note text. Empty, trashed, and short notes are excluded. Notes whose title and body exceed {status.maxBytes.toLocaleString()} UTF-8 bytes are excluded. Changed eligible notes are queued again; unchanged notes keep their saved embedding.</p>
          <button className="button" disabled={busy||!changed}>Save embedding settings</button>
        </form>
        <div className="embedding-backfill">
          <h4>Index existing notes</h4><p>Use saved criteria to queue notes in this vault. Active jobs are deduplicated.</p>
          <div className="intelligence-actions">
            <button className="button" disabled={busy||changed||!status.counts.missing} onClick={()=>void perform(async()=>{const result=await api.enqueueEmbeddings(vaultId!,'missing');return `Queued ${result.queued} notes; skipped ${result.skipped}.`;})}>Queue missing ({status.counts.missing})</button>
            <button className="button" disabled={busy||changed||!status.counts.eligible} onClick={()=>void perform(async()=>{const result=await api.enqueueEmbeddings(vaultId!,'eligible');return `Queued ${result.queued} notes; skipped ${result.skipped}.`;})}>Queue eligible / stale</button>
          </div>
          {changed&&<p>Save your criteria before indexing existing notes.</p>}
          <details className="embedding-eligibility"><summary>Note eligibility ({status.notes.length})</summary><ul>{status.notes.map(note=><li key={note.pageId}><button className="ai-activity-link" onClick={()=>open(note.pageId)}>{note.title||'Untitled'}</button><small>{note.state} · {note.reason}</small></li>)}</ul>{!status.notes.length&&<p>No saved notes in this vault.</p>}</details>
        </div>
        <div className="embedding-search">
          <h4>Search by meaning</h4><p>Search queries are embedded with the same model and compared with current saved note embeddings.</p>
          <form onSubmit={event=>void search(event)}><label className="sr-only" htmlFor="semantic-search">Semantic search query</label><input id="semantic-search" type="search" value={query} maxLength={2000} placeholder="Find notes about an idea…" onChange={event=>setQuery(event.target.value)} disabled={searchBusy}/><button className="button primary" disabled={searchBusy||!query.trim()||!status.configured||!status.counts.indexed}>{searchBusy?'Searching…':'Search'}</button></form>
          {!status.counts.indexed&&<p>Index eligible notes to start searching.</p>}
          {results&&<div aria-live="polite"><p>{results.results.length} results · similarity is a ranking score</p><ul className="embedding-results">{results.results.map(result=><li key={result.id}><button onClick={()=>open(result.id)}><strong>{result.title||'Untitled'}</strong><small>Similarity {result.score.toFixed(3)} · updated {new Date(result.updated_at).toLocaleDateString()}</small></button></li>)}</ul>{!results.results.length&&<p>No indexed notes match this search.</p>}</div>}
        </div>
        <div className="embedding-activity">
          <h4>Queue & history</h4><p>Activity refreshes every 5 seconds. Latest {status.jobs.length} jobs, including timestamps, attempts, token usage, and failure logs.</p>
          <div className="embedding-job-tabs" role="group" aria-label="Embedding activity view"><button className="button" aria-pressed={jobView==='queue'} onClick={()=>setJobView('queue')}>Queue ({status.counts.queued+status.counts.running})</button><button className="button" aria-pressed={jobView==='history'} onClick={()=>setJobView('history')}>History / logs</button><button className="button" disabled={busy} onClick={()=>void perform(async()=> 'Activity refreshed.')}>Refresh</button></div>
          <ul className="embedding-job-list">{jobs.map(job=><li key={job.id}><div className="embedding-job-heading"><span>{job.pageId?<button className="ai-activity-link" onClick={()=>open(job.pageId!)}>{job.title||'Untitled'}</button>:job.title||'Unavailable note'}</span><span className={'ai-activity-status '+job.status}>{job.status}</span></div><small>Queued {new Date(job.createdAt).toLocaleString()} · {job.attempts} attempts · {job.reason}{job.tokens!==null?` · ${job.tokens.toLocaleString()} tokens`:''}</small>{job.startedAt&&<small>Started {new Date(job.startedAt).toLocaleString()}{job.finishedAt?` · finished ${new Date(job.finishedAt).toLocaleString()}`:''}</small>}{job.status==='queued'&&<small>Next attempt {new Date(job.nextAttemptAt).toLocaleString()}</small>}{job.error&&<p className="embedding-job-error">{job.error}</p>}{(job.status==='failed'||job.status==='interrupted')&&<button className="button" disabled={busy||!job.pageId} onClick={()=>void perform(async()=>{const result=await api.retryEmbedding(vaultId!,job.id);return result.queued?'Job queued for another attempt.':'No job needed: this note is already indexed, ineligible, or queued.';})}>Retry</button>}</li>)}</ul>
          {!jobs.length&&<p>{jobView==='queue'?'No pending embedding jobs.':'No completed activity yet. Index notes or enable automatic embeddings to begin.'}</p>}
        </div>
        <p className="intelligence-note">Embeddings are saved locally in this vault. Indexing sends eligible note text to OpenAI, and searches send your query. API usage may incur charges.</p>
      </>}
      {error&&<p role="alert" className="embedding-job-error">{error}</p>}
      <p role="status" aria-live="polite">{busy?'Working…':message}</p>
    </>}
  </section>;
}
