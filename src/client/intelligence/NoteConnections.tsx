import {useEffect,useId,useMemo,useState} from 'react';
import {blockPageLinks,pageTitleKey} from '../../shared/page-links';
import type {Page,PageSummary} from '../../shared/domain';
import {api} from '../api';
import {Icon} from '../components/Icon';

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
  const outgoingIds=new Set(outgoing.flatMap(link=>link.targets.map(target=>target.id)));
  const incomingIds=new Set(!loading&&!error?backlinks.map(source=>source.id):[]);
  const incomingOnly=backlinks.filter(source=>!outgoingIds.has(source.id));
  const linkCount=outgoing.reduce((count,link)=>count+Math.max(1,link.targets.length),0)+incomingOnly.length;
  return <section className="knowledge-note-links" aria-labelledby={id+'-links'}>
      <div className="knowledge-section-heading"><h2 id={id+'-links'}>Links</h2>{!loading&&!error&&<span className="knowledge-count">{linkCount}</span>}</div>
      <ul className="knowledge-note-link-list">{outgoing.map(link=><li key={'outgoing-'+pageTitleKey(link.title)}>
        {link.targets.length?link.targets.map(target=><button key={target.id} type="button" disabled={inactive} onClick={()=>onOpenPage(target.id)}><LinkDirectionIcon direction={incomingIds.has(target.id)?'bidirectional':'outgoing'}/><span>{target.title}{link.targets.length>1&&<small>Updated {new Date(target.updated_at).toLocaleString()}</small>}</span></button>):<div className="knowledge-missing-link"><LinkDirectionIcon direction="outgoing"/><span>{link.title}<small>Note not found in this vault</small></span></div>}
        {!!link.aliases.size&&<small className="knowledge-link-alias">Shown as: {[...link.aliases].join(', ')}</small>}
      </li>)}{!loading&&!error&&incomingOnly.map(source=><li key={'incoming-'+source.id}><button type="button" disabled={inactive} onClick={()=>onOpenPage(source.id)}><LinkDirectionIcon direction="incoming"/><span>{source.title||'Untitled'}</span></button></li>)}</ul>
      {loading?<p className="section-hint" role="status">Loading incoming links…</p>:error?<p className="section-hint" role="alert">{error} <button type="button" className="summary-toggle" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>:!outgoing.length&&!backlinks.length&&<p className="section-hint">No links yet. Link to another note with [[Page title]].</p>}
    </section>;
}

function LinkDirectionIcon({direction}:{direction:'incoming'|'outgoing'|'bidirectional'}) {
  const label=direction==='bidirectional'?'Incoming and outgoing links':direction==='outgoing'?'Outgoing link':'Incoming link';
  return <span className="knowledge-link-direction" role="img" aria-label={label} title={label}><Icon name={'page-'+direction}/></span>;
}
