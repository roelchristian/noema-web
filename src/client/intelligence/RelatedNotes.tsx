import {t as uiText} from '../i18n';
import {memo,useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import type {Page,PageSummary} from '../../shared/domain';
import type {RelatedNote} from '../../shared/embeddings';
import {ApiError,api} from '../api';
import {requestSuggestionCheck,watchSuggestions} from './suggestion-refresh';
import {Icon} from '../components/Icon';
import {TitleText} from '../components/TitleText';

type Props={page:Page;pages?:PageSummary[];onOpenPage:(id:string)=>void;inactive?:boolean};
// Identity isolation also holds for callers that do not supply a React key.
export function RelatedNotes(props:Props) {
  return <RelatedNotesContent key={JSON.stringify([props.page.vault_id,props.page.id])} {...props}/>;
}
export function sameRelatedNotes(a:RelatedNote[],b:RelatedNote[]) {
  return a.length===b.length&&a.every((note,index)=>{
    const other=b[index]!;
    return note.pageId===other.pageId&&(note.title||'Untitled')===(other.title||'Untitled')&&note.excerpt===other.excerpt;
  });
}
const RelatedNoteList=memo(function RelatedNoteList({notes,onOpenPage}:{notes:RelatedNote[];onOpenPage:(id:string)=>void}) {
  return <ul className="page-sources-list" aria-label={uiText("Related notes")}>{notes.map(note=><li className="page-sources-row" key={note.pageId}>
    <button type="button" className="page-sources-open" onClick={()=>onOpenPage(note.pageId)} title={note.excerpt}>
      <span className="page-sources-copy"><span className="page-sources-name"><TitleText text={note.title||'Untitled'}/></span><span className="related-note-excerpt">{note.excerpt}</span></span><Icon name="chevron"/>
    </button>
  </li>)}</ul>;
});
function RelatedNotesContent({page,pages,onOpenPage,inactive=false}:Props) {
  const id=useId();
  const openPage=useRef(onOpenPage);openPage.current=onOpenPage;
  const open=useCallback((pageId:string)=>openPage.current(pageId),[]);
  const [results,setNotes]=useState<RelatedNote[]>([]);
  const notes=useMemo(()=>{
    if(!pages)return results;
    const available=new Set(pages.map(item=>item.id)),next=results.filter(note=>available.has(note.pageId));
    return next.length===results.length?results:next;
  },[results,pages]);
  const currentNotes=useRef(notes);currentNotes.current=notes;
  const revision=useRef(page.revision);revision.current=page.revision;
  const [loaded,setLoaded]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(inactive)return;
    const controller=new AbortController();
    const failed=(reason:unknown)=>{
      if(controller.signal.aborted)return;
      if(reason instanceof ApiError&&(reason.status===403||reason.status===404||reason.status===423))setNotes([]);
      setError(reason instanceof Error?reason.message:'Could not load related notes.');setLoading(false);
    };
    const stop=watchSuggestions(page.vault_id,page.id,async()=>{
      const requestedRevision=revision.current;
      setLoading(true);setError('');
      try {
        const result=await api.relatedNotesState(page.vault_id,page.id,currentNotes.current.map(note=>note.pageId),controller.signal);
        if(controller.signal.aborted||revision.current!==requestedRevision)return false;
        setNotes(previous=>{
          // An incomplete ranking cannot erase or reorder the displayed list.
          const next=result.pending&&previous.length?previous.filter(note=>result.retainedPageIds.includes(note.pageId)):result.notes;
          return sameRelatedNotes(previous,next)?previous:next;
        });
        setLoaded(true);setError('');setLoading(result.pending);return true;
      } catch(reason) {if(revision.current===requestedRevision)failed(reason);return false;}
    },failed);
    return()=>{controller.abort();stop();};
  },[page.vault_id,page.id,inactive,retry]);
  useEffect(()=>{requestSuggestionCheck(page.vault_id,page.id);},[page.vault_id,page.id,page.revision,retry]);
  if(inactive)return null;
  return <section className="knowledge-note-links knowledge-related-notes" aria-labelledby={id+'-heading'}>
    <div className="knowledge-section-heading"><h2 id={id+'-heading'}><Icon name="lightbulb"/>{uiText("Related notes")}<span className="knowledge-count">{notes.length}</span></h2>
    {loading&&loaded&&<span className="related-notes-updating" role="status" aria-label={uiText("Updating related notes…")} title={uiText("Updating related notes…")}><Icon name="refresh"/></span>}</div>
    {notes.length>0&&<RelatedNoteList notes={notes} onOpenPage={open}/>}
    {error?<p className="section-hint" role={notes.length?'status':'alert'}>{error} <button type="button" className="summary-toggle" disabled={inactive} onClick={()=>setRetry(value=>value+1)}>{uiText("Retry")}</button></p>:!notes.length&&<p className="section-hint" role="status">{!loaded&&loading?uiText("Finding related notes…"):uiText("No related notes yet. Connections will appear here as your library grows.")}</p>}
  </section>;
}
