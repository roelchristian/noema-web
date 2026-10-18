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
  const links=outgoing.flatMap(link=>{
    const aliases=!!link.aliases.size&&<small className="knowledge-link-alias">Shown as: {[...link.aliases].join(', ')}</small>;
    return link.targets.length?link.targets.map(target=><li key={'page-'+target.id}>
      <button type="button" disabled={inactive} onClick={()=>onOpenPage(target.id)}><LinkDirectionIcon direction={incomingIds.has(target.id)?'bidirectional':'outgoing'}/><span>{target.title}{link.targets.length>1&&<small>Updated {new Date(target.updated_at).toLocaleString()}</small>}</span></button>
      {aliases}
    </li>):[<li key={'missing-'+pageTitleKey(link.title)}><div className="knowledge-missing-link"><LinkDirectionIcon direction="outgoing"/><span>{link.title}<small>Note not found in this vault</small></span></div>{aliases}</li>];
  });
  if(!loading&&!error)links.push(...incomingOnly.map(source=><li key={'page-'+source.id}><button type="button" disabled={inactive} onClick={()=>onOpenPage(source.id)}><LinkDirectionIcon direction="incoming"/><span>{source.title||'Untitled'}</span></button></li>));
  const paginationKey=JSON.stringify([page.vault_id,page.id]);
  const [pagination,setPagination]=useState({key:paginationKey,index:0});
  const pageSize=10;
  const pageCount=Math.max(1,Math.ceil(links.length/pageSize));
  const pageIndex=pagination.key===paginationKey?Math.min(pagination.index,pageCount-1):0;
  if(pagination.key!==paginationKey||pagination.index!==pageIndex)setPagination({key:paginationKey,index:pageIndex});
  const pageStart=pageIndex*pageSize;
  if(!loading&&!error&&!links.length)return null;
  return <section className="knowledge-note-links" aria-labelledby={id+'-links'}>
      <div className="knowledge-section-heading"><h2 id={id+'-links'}><Icon name="page-bidirectional"/>Links{!loading&&!error&&<span className="knowledge-count">{links.length}</span>}</h2></div>
      <ul id={id+'-list'} className="knowledge-note-link-list">{links.slice(pageStart,pageStart+pageSize)}</ul>
      {pageCount>1&&<nav className="knowledge-entity-pagination" aria-label="Links pagination">
        <span role="status" aria-live="polite" aria-atomic="true">{pageStart+1}–{Math.min(pageStart+pageSize,links.length)} of {links.length}</span>
        <button type="button" className="pagination-previous" aria-label="Previous links" title="Previous page" aria-controls={id+'-list'} disabled={inactive||pageIndex===0} onClick={()=>setPagination({key:paginationKey,index:pageIndex-1})}><Icon name="chevron"/></button>
        <button type="button" aria-label="Next links" title="Next page" aria-controls={id+'-list'} disabled={inactive||pageIndex===pageCount-1} onClick={()=>setPagination({key:paginationKey,index:pageIndex+1})}><Icon name="chevron"/></button>
      </nav>}
      {loading?<p className="section-hint" role="status">Loading links…</p>:error?<p className="section-hint" role="alert">{error} <button type="button" className="summary-toggle" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>:null}
    </section>;
}

function LinkDirectionIcon({direction}:{direction:'incoming'|'outgoing'|'bidirectional'}) {
  const label=direction==='bidirectional'?'Incoming and outgoing links':direction==='outgoing'?'Outgoing link':'Incoming link';
  return <span className="knowledge-link-direction" role="img" aria-label={label} title={label}><Icon name={'page-'+direction}/></span>;
}
