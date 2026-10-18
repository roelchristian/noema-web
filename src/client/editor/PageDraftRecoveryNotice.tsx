import {useState} from 'react';
import type {Entity, Page, PageSummary} from '../../shared/domain';
import type {PageDraftRecovery} from '../state/workspace';
import type {PageDraftEntry} from '../state/page-draft-journal';
import {Modal} from '../components/Modal';
import {Select} from '../components/Select';
import {ReadOnlyPageBlocks} from './ReadOnlyPageBlocks';

export function PageDraftRecoveryNotice({recovery,page,entities,pages,onRestore,onDiscard}: {
  recovery:PageDraftRecovery; page:Page; entities:Entity[]; pages:PageSummary[];
  onRestore:(entry:PageDraftEntry)=>Promise<void>; onDiscard:()=>Promise<void>;
}) {
  const [open,setOpen]=useState(false), [index,setIndex]=useState(0), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const entry=recovery.drafts[Math.min(index,recovery.drafts.length-1)];
  if(!entry)return null;
  return <>
    <div className="page-persistence-notice" role="status">
      <span>An unsaved draft of “{recovery.title || 'Untitled'}” needs review{page.editLocked?' after unlocking this page':': the saved page has changed'}.</span>
      <button type="button" onClick={()=>setOpen(true)}>Review draft</button>
    </div>
    {open&&<Modal className="page-draft-recovery-dialog" titleId="page-draft-recovery-title" onClose={()=>{if(!busy)setOpen(false);}} dismissOnBackdrop>
      <h2 id="page-draft-recovery-title">Recover unfinished work</h2>
      <p>Review the draft below. Restoring it replaces this page’s current contents and queues a new save. Any save failure will remain visible above the page.</p>
      {recovery.drafts.length>1&&<label>Recovered draft<Select value={index} disabled={busy} onChange={event=>setIndex(Number(event.target.value))}>{recovery.drafts.map((draft,i)=><option key={draft.id} value={i}>{new Date(draft.updatedAt).toLocaleString()} · {draft.snapshot.title || 'Untitled'}</option>)}</Select></label>}
      <p>Draft from {new Date(entry.updatedAt).toLocaleString()} · based on revision {entry.baseRevision}</p>
      <section className="page-draft-preview" aria-label="Recovered draft preview">
        <h3>{entry.snapshot.title || 'Untitled'}</h3>
        <ReadOnlyPageBlocks blocks={entry.snapshot.blocks} entities={entities} pages={pages} vaultId={page.vault_id} onOpenEntity={()=>{}} onOpenPage={()=>{}}/>
      </section>
      {error&&<p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="button" disabled={busy} onClick={()=>{setBusy(true);setError('');void onDiscard().then(()=>setOpen(false)).catch(reason=>setError(reason instanceof Error?reason.message:String(reason))).finally(()=>setBusy(false));}}>Discard recovered drafts</button>
        <button type="button" className="button" disabled={busy} onClick={()=>setOpen(false)}>Keep for later</button>
        <button type="button" className="button primary" disabled={busy||!!page.editLocked} onClick={()=>{setBusy(true);setError('');void onRestore(entry).then(()=>setOpen(false)).catch(reason=>setError(reason instanceof Error?reason.message:String(reason))).finally(()=>setBusy(false));}}>{busy?'Restoring…':'Restore this draft'}</button>
      </div>
    </Modal>}
  </>;
}
