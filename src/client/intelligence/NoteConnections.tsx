import {useEffect,useId,useMemo,useState} from 'react';
import {blockPageLinks,pageTitleKey} from '../../shared/page-links';
import type {Page,PageSummary} from '../../shared/domain';
import {api} from '../api';
import {PageIcon} from '../components/PageIcon';

export function NoteConnections({page,pages,onOpenPage,inactive=false}:{page:Page;pages:PageSummary[];onOpenPage:(id:string)=>void;inactive?:boolean}) {
  const id=useId();
  const [backlinks,setBacklinks]=useState<PageSummary[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const catalogKey=JSON.stringify(pages.map(note=>[note.id,note.title,note.updated_at]));
  useEffect(()=>{
    if(inactive)return;
    const controller=new AbortController();setLoading(true);setError('');
    void api.pageBacklinks(page.vault_id,page.id,controller.signal).then(items=>{
      if(!controller.signal.aborted){setBacklinks(items);setLoading(false);}
    }).catch(error=>{if(!controller.signal.aborted){setError(error instanceof Error?error.message:'Could not load backlinks.');setLoading(false);}});
    return()=>controller.abort();
  },[page.vault_id,page.id,page.title,page.revision,catalogKey,retry,inactive]);
  const outgoing=useMemo(()=>{
    const groups=new Map<string,{title:string;aliases:Set<string>;targets:PageSummary[]}>();
    for(const link of blockPageLinks(page.blocks)) {
      const key=pageTitleKey(link.title);
      let group=groups.get(key);
      if(!group){group={title:link.title,aliases:new Set(),targets:pages.filter(note=>pageTitleKey(note.title)===key)};groups.set(key,group);}
      if(link.label!==link.title)group.aliases.add(link.label);
    }
    return [...groups.values()];
  },[page.blocks,pages]);
  return <>
    <section className="knowledge-note-links" aria-labelledby={id+'-outgoing'}>
      <div className="knowledge-section-heading"><h2 id={id+'-outgoing'}>Outgoing links</h2><span className="knowledge-count">{outgoing.length}</span></div>
      {outgoing.length?<ul className="knowledge-note-link-list">{outgoing.map(link=><li key={pageTitleKey(link.title)}>
        {link.targets.length?link.targets.map(target=><button key={target.id} type="button" disabled={inactive} onClick={()=>onOpenPage(target.id)}><PageIcon icon={target.icon}/><span>{target.title}{link.targets.length>1&&<small>Updated {new Date(target.updated_at).toLocaleString()}</small>}</span></button>):<div className="knowledge-missing-link"><span>{link.title}</span><small>Note not found in this vault</small></div>}
        {!!link.aliases.size&&<small className="knowledge-link-alias">Shown as: {[...link.aliases].join(', ')}</small>}
      </li>)}</ul>:<p className="section-hint">Link to another note with [[Page title]].</p>}
    </section>
    <section className="knowledge-note-links" aria-labelledby={id+'-backlinks'} aria-busy={loading}>
      <div className="knowledge-section-heading"><h2 id={id+'-backlinks'}>Backlinks</h2>{!loading&&!error&&<span className="knowledge-count">{backlinks.length}</span>}</div>
      {loading?<p className="section-hint" role="status">Loading backlinks…</p>:error?<p className="section-hint" role="alert">{error} <button type="button" className="summary-toggle" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>:backlinks.length?<ul className="knowledge-note-link-list">{backlinks.map(source=><li key={source.id}><button type="button" disabled={inactive} onClick={()=>onOpenPage(source.id)}><PageIcon icon={source.icon}/><span>{source.title||'Untitled'}</span></button></li>)}</ul>:<p className="section-hint">No other notes link to this page yet.</p>}
    </section>
  </>;
}
