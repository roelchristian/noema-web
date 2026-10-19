import {useEffect,useId,useState} from 'react';
import type {Page} from '../../shared/domain';
import type {RelatedNote} from '../../shared/embeddings';
import {api} from '../api';
import {watchSuggestions} from './suggestion-refresh';
import {Icon} from '../components/Icon';
import {TitleText} from '../components/TitleText';

export function RelatedNotes({page,onOpenPage,inactive=false}:{page:Page;onOpenPage:(id:string)=>void;inactive?:boolean}) {
  const id=useId();
  const [notes,setNotes]=useState<RelatedNote[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(inactive)return;
    const controller=new AbortController();setLoading(true);setError('');
    const stop=watchSuggestions(page.vault_id,page.id,async()=>{
      try {
        const items=await api.relatedNotes(page.vault_id,page.id,controller.signal);
        if(controller.signal.aborted)return false;
        setNotes(items);setError('');return true;
      } catch(reason) {
        if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Could not load related notes.');
        return false;
      } finally {if(!controller.signal.aborted)setLoading(false);}
    },reason=>{if(!controller.signal.aborted){setError(reason instanceof Error?reason.message:'Could not load related notes.');setLoading(false);}});
    return()=>{controller.abort();stop();};
  },[page.vault_id,page.id,page.revision,inactive,retry]);
  return <section className="knowledge-note-links knowledge-related-notes" aria-labelledby={id+'-heading'}>
    <div className="knowledge-section-heading"><h2 id={id+'-heading'}><Icon name="lightbulb"/>Related notes<span className="knowledge-count">{notes.length}</span></h2></div>
    {notes.length>0&&<ul className="page-sources-list" aria-label="Related notes">{notes.map(note=><li className="page-sources-row" key={note.pageId}>
      <button type="button" className="page-sources-open" disabled={inactive} onClick={()=>onOpenPage(note.pageId)} title={note.excerpt}>
        <span className="page-sources-copy"><span className="page-sources-name"><TitleText text={note.title||'Untitled'}/></span><span className="related-note-excerpt">{note.excerpt}</span></span><Icon name="chevron"/>
      </button>
    </li>)}</ul>}
    {error?<p className="section-hint" role="alert">{error} <button type="button" className="summary-toggle" disabled={inactive} onClick={()=>setRetry(value=>value+1)}>Retry</button></p>:!notes.length&&<p className="section-hint" role="status">{loading?'Finding related notes…':'No related notes yet. Connections will appear here as your library grows.'}</p>}
  </section>;
}
