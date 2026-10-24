import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {TitleText} from '../components/TitleText';
import {useEffect,useId,useMemo,useState,useRef} from 'react';
import {blockPageLinks,pageTitleKey,resolvePageLink} from '../../shared/page-links';
import type {Page,PageSummary,PagePageAssociation} from '../../shared/domain';
import {api} from '../api';
import {Icon} from '../components/Icon';

export function NoteConnections({page,pages,onOpenPage,inactive=false}:{page:Page;pages:PageSummary[];onOpenPage:(id:string)=>void;inactive?:boolean}) {
  const id=useId();
  const [backlinks,setBacklinks]=useState<PageSummary[]>([]);
  const [associations,setAssociations]=useState<PagePageAssociation[]>([]);
  const [pending,setPending]=useState(false),[undo,setUndo]=useState<PagePageAssociation|null>(null);
  const context=page.vault_id+':'+page.id,current=useRef({context,version:0}),busy=useRef<object|null>(null);if(current.current.context!==context)current.current={context,version:0};
  const owner=current.current;
  const [associationContext,setAssociationContext]=useState(context);
  async function mutate(work:()=>Promise<PagePageAssociation[]>,removed?:PagePageAssociation) {
    if(busy.current===owner)return;busy.current=owner;++owner.version;setPending(true);setError('');
    try {const items=await work();if(current.current===owner){setAssociations(items);setUndo(removed??null);setLoading(false);}}
    catch(value){if(current.current===owner)setError(String(value));}
    finally{++owner.version;if(busy.current===owner)busy.current=null;if(current.current===owner)setPending(false);}
  }
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const refresh=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.vaultId===page.vault_id&&detail?.pageId===page.id)setRetry(value=>value+1);};window.addEventListener('noema:page-connections-changed',refresh);return()=>window.removeEventListener('noema:page-connections-changed',refresh);},[page.vault_id,page.id]);
  const catalogKey=JSON.stringify(pages.map(note=>[note.id,note.title,note.updated_at]));
  useEffect(()=>{
    if(inactive)return;
    const readVersion=owner.version;const controller=new AbortController();setLoading(true);setError('');if(associationContext!==context){setUndo(null);setPending(false);setAssociationContext(context);setAssociations([]);}
    void Promise.all([api.pageBacklinks(page.vault_id,page.id,controller.signal),api.pageAssociations(page.vault_id,page.id,controller.signal)]).then(([items,associated])=>{
      if(!controller.signal.aborted){if(readVersion===owner.version){setBacklinks(items);setAssociations(associated);}setLoading(false);}
    }).catch(error=>{if(!controller.signal.aborted){if(readVersion===owner.version)setError(error instanceof Error?error.message:'Could not load backlinks.');setLoading(false);}});
    return()=>controller.abort();
  },[page.vault_id,page.id,page.title,page.revision,catalogKey,retry,inactive]);
  const outgoing=useMemo(()=>{
    const groups=new Map<string,{title:string;aliases:Set<string>;targets:PageSummary[]}>();
    for(const link of blockPageLinks(page.blocks)) {
      const candidates=resolvePageLink(link,pages);
      const key=candidates.length===1?candidates[0]!.id:link.pageId??pageTitleKey(link.title);
      let group=groups.get(key);
      if(!group){group={title:link.title,aliases:new Set(),targets:candidates.length===1?candidates:[]};groups.set(key,group);}
      if(link.label!==link.title)group.aliases.add(link.label);
    }
    return [...groups.values()];
  },[page.blocks,pages]);
  const outgoingIds=new Set(outgoing.flatMap(link=>link.targets.map(target=>target.id)));
  const incomingIds=new Set(!loading&&!error?backlinks.map(source=>source.id):[]);
  const associatedIds=new Set((associationContext===context?associations:[]).map(item=>item.id));
  const incomingOnly=backlinks.filter(source=>!outgoingIds.has(source.id)&&!associatedIds.has(source.id));
  const links=outgoing.flatMap(link=>{
    const aliases=!!link.aliases.size&&<small className="knowledge-link-alias">{uiText("Shown as:") + " "}{[...link.aliases].join(', ')}</small>;
    return link.targets.length?link.targets.filter(target=>!associatedIds.has(target.id)).map(target=><li key={'page-'+target.id}>
      <button type="button" disabled={inactive} onClick={()=>onOpenPage(target.id)}><LinkDirectionIcon direction={incomingIds.has(target.id)?'bidirectional':'outgoing'}/><span><TitleText text={target.title}/>{target.archived_at&&<small>Archived</small>}{link.targets.length>1&&<small>{uiText("Updated") + " "}{new Date(target.updated_at).toLocaleString(getLocale())}</small>}</span></button>
      {aliases}
    </li>):[<li key={'missing-'+pageTitleKey(link.title)}><div className="knowledge-missing-link"><LinkDirectionIcon direction="outgoing"/><span><TitleText text={link.title}/><small>{uiText(resolvePageLink({title:link.title},pages).length>1?"Ambiguous title · choose the destination in the editor":"Note not found in this vault")}</small></span></div>{aliases}</li>];
  });
  if(associationContext===context)links.unshift(...associations.map(target=><li key={'page-'+target.id}>
    <button type="button" disabled={inactive} onClick={()=>onOpenPage(target.id)}><LinkDirectionIcon direction={incomingIds.has(target.id)?'bidirectional':'outgoing'}/><span><TitleText text={target.title}/><small>{['Associated',outgoingIds.has(target.id)?'Inline link':'',incomingIds.has(target.id)?'Incoming link':'',target.pinned?'Featured':''].filter(Boolean).join(' · ')}</small>{target.annotation&&<small>{target.annotation}</small>}</span></button>
    <details><summary>Connection options</summary><form onSubmit={event=>{event.preventDefault();const annotation=(event.currentTarget.elements.namedItem('annotation') as HTMLTextAreaElement).value;void mutate(()=>api.associatePages(page.vault_id,page.id,target.id,{annotation}));}}><label>Association note<textarea name="annotation" defaultValue={target.annotation} maxLength={2000} disabled={inactive||pending}/></label><button type="submit" disabled={inactive||pending}>Save note</button></form>
    <button type="button" disabled={inactive||pending} onClick={()=>void mutate(()=>api.associatePages(page.vault_id,page.id,target.id,{pinned:!target.pinned}))}>{target.pinned?'Unfeature':'Feature'}</button>
    <button type="button" disabled={inactive||pending} onClick={()=>void mutate(()=>api.removePageAssociation(page.vault_id,page.id,target.id),target)}>Remove association</button></details>
  </li>));
  if(!loading&&!error)links.push(...incomingOnly.map(source=><li key={'page-'+source.id}><button type="button" disabled={inactive} onClick={()=>onOpenPage(source.id)}><LinkDirectionIcon direction="incoming"/><span><TitleText text={source.title||'Untitled'}/>{source.archived_at&&<small>Archived</small>}</span></button></li>));
  const paginationKey=JSON.stringify([page.vault_id,page.id]);
  const [pagination,setPagination]=useState({key:paginationKey,index:0});
  const pageSize=10;
  const pageCount=Math.max(1,Math.ceil(links.length/pageSize));
  const pageIndex=pagination.key===paginationKey?Math.min(pagination.index,pageCount-1):0;
  if(pagination.key!==paginationKey||pagination.index!==pageIndex)setPagination({key:paginationKey,index:pageIndex});
  const pageStart=pageIndex*pageSize;
  if(!loading&&!error&&!links.length&&!undo)return null;
  return <section className="knowledge-note-links" aria-labelledby={id+'-links'}>
      <div className="knowledge-section-heading"><h2 id={id+'-links'}><Icon name="page-bidirectional"/>{uiText("Connections")}{!loading&&!error&&<span className="knowledge-count">{links.length}</span>}</h2></div>
      {undo&&<p role="status">Association removed. <button type="button" disabled={inactive||pending} onClick={()=>void mutate(()=>api.associatePages(page.vault_id,page.id,undo.id,{pinned:undo.pinned,annotation:undo.annotation}))}>Undo</button></p>}
      <ul id={id+'-list'} className="knowledge-note-link-list">{links.slice(pageStart,pageStart+pageSize)}</ul>
      {pageCount>1&&<nav className="knowledge-entity-pagination" aria-label={uiText("Links pagination")}>
        <span role="status" aria-live="polite" aria-atomic="true">{pageStart+1}–{Math.min(pageStart+pageSize,links.length)}{" " + uiText("of") + " "}{links.length}</span>
        <button type="button" className="pagination-previous" aria-label={uiText("Previous links")} title={uiText("Previous page")} aria-controls={id+'-list'} disabled={inactive||pageIndex===0} onClick={()=>setPagination({key:paginationKey,index:pageIndex-1})}><Icon name="chevron"/></button>
        <button type="button" aria-label={uiText("Next links")} title={uiText("Next page")} aria-controls={id+'-list'} disabled={inactive||pageIndex===pageCount-1} onClick={()=>setPagination({key:paginationKey,index:pageIndex+1})}><Icon name="chevron"/></button>
      </nav>}
      {loading?<p className="section-hint" role="status">{uiText("Loading links…")}</p>:error?<p className="section-hint" role="alert">{error} <button type="button" className="summary-toggle" onClick={()=>setRetry(value=>value+1)}>{uiText("Retry")}</button></p>:null}
    </section>;
}

function LinkDirectionIcon({direction}:{direction:'incoming'|'outgoing'|'bidirectional'}) {
  const label=direction==='bidirectional'?'Incoming and outgoing links':direction==='outgoing'?'Outgoing link':'Incoming link';
  return <span className="knowledge-link-direction" role="img" aria-label={label} title={label}><Icon name={'page-'+direction}/></span>;
}
