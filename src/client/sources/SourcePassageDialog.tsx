import {useState, type FormEvent} from 'react';
import type {PageSummary, SourceReference} from '../../shared/domain';
import {Modal, ModalHeader} from '../components/Modal';
import {Select} from '../components/Select';

export function SourcePassageDialog({reference, pages, annotate, onSave, onClose}: {
  reference:SourceReference; pages:PageSummary[]; annotate:boolean;
  onSave:(pageId:string, annotation:string)=>Promise<void>; onClose:()=>void;
}) {
  const [pageId,setPageId]=useState(''),[annotation,setAnnotation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();if(busy)return;
    setBusy(true);setError('');
    try {await onSave(pageId,annotation.trim());onClose();}
    catch(error){setError(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);}
  }
  return <Modal titleId="source-passage-title" onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}>
    <ModalHeader titleId="source-passage-title" closeDisabled={busy}>{annotate?'Annotate passage':'Add passage to page'}</ModalHeader>
    <blockquote className="source-passage-preview">{reference.excerpt}</blockquote>
    <label>Destination<Select value={pageId} disabled={busy} onChange={event=>setPageId(event.target.value)}><option value="">New note</option>{pages.map(page=><option key={page.id} value={page.id}>{page.title||'Untitled'}</option>)}</Select></label>
    <label>{annotate?'Annotation':'Annotation (optional)'}<textarea autoFocus={annotate} required={annotate} maxLength={16000} rows={4} value={annotation} disabled={busy} onChange={event=>setAnnotation(event.target.value)}/></label>
    <p>The passage and its citation will be saved in the note. The source stays read-only.</p>
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy||annotate&&!annotation.trim()}>{busy?'Saving…':'Add to page'}</button></div>
  </form></Modal>;
}
