import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {TitleText} from '../components/TitleText';
import {useState} from 'react';
import type {Entity, Page, PageSummary} from '../../shared/domain';
import type {PageDraftRecovery} from '../state/workspace';
import type {PageDraftEntry} from '../state/page-draft-journal';
import {Modal,ModalHeader} from '../components/Modal';
import {Select} from '../components/Select';
import {ReadOnlyPageBlocks} from './ReadOnlyPageBlocks';
import {InlineNotice} from '../notifications/InlineNotice';

export function PageDraftRecoveryNotice({recovery,page,entities,pages,onRestore,onDiscard}: {
  recovery:PageDraftRecovery; page:Page; entities:Entity[]; pages:PageSummary[];
  onRestore:(entry:PageDraftEntry)=>Promise<void>; onDiscard:()=>Promise<void>;
}) {
  const [open,setOpen]=useState(false), [index,setIndex]=useState(0), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const entry=recovery.drafts[Math.min(index,recovery.drafts.length-1)];
  if(!entry)return null;
  return <>
    <InlineNotice id="page-draft-recovery-notice" tone="warning" title={uiText("An unsaved draft of “")+(recovery.title || uiText("Untitled"))+uiText("” needs review")+(page.editLocked?uiText(" after unlocking this page"):uiText(": the saved page has changed"))+'.'} actions={<button type="button" onClick={()=>setOpen(true)}>{uiText("Review draft")}</button>}/>
    {open&&<Modal className="page-draft-recovery-dialog" titleId="page-draft-recovery-title" onClose={()=>{if(!busy)setOpen(false);}} dismissOnBackdrop>
      <ModalHeader titleId="page-draft-recovery-title" closeDisabled={busy}>{uiText("Recover unfinished work")}</ModalHeader>
      <p>{uiText("Review the draft below. Restoring it replaces this page’s current contents and queues a new save. Any save failure will remain visible above the page.")}</p>
      {recovery.drafts.length>1&&<label>{uiText("Recovered draft")}<Select value={index} disabled={busy} onChange={event=>setIndex(Number(event.target.value))}>{recovery.drafts.map((draft,i)=><option key={draft.id} value={i}>{new Date(draft.updatedAt).toLocaleString(getLocale())} · {draft.snapshot.title || uiText("Untitled")}</option>)}</Select></label>}
      <p>{uiText("Draft from") + " "}{new Date(entry.updatedAt).toLocaleString(getLocale())}{" " + uiText("· based on revision") + " "}{entry.baseRevision}</p>
      <section className="page-draft-preview" aria-label={uiText("Recovered draft preview")}>
        <h3><TitleText text={entry.snapshot.title || 'Untitled'}/></h3>
        <ReadOnlyPageBlocks blocks={entry.snapshot.blocks} entities={entities} pages={pages} vaultId={page.vault_id} onOpenEntity={()=>{}} onOpenPage={()=>{}}/>
      </section>
      {error&&<InlineNotice tone="error" title={error} announcement="assertive"/>}
      <div className="dialog-actions">
        <button type="button" className="button" disabled={busy} onClick={()=>{setBusy(true);setError('');void onDiscard().then(()=>setOpen(false)).catch(reason=>setError(reason instanceof Error?reason.message:String(reason))).finally(()=>setBusy(false));}}>{uiText("Discard recovered drafts")}</button>
        <button type="button" className="button" disabled={busy} onClick={()=>setOpen(false)}>{uiText("Keep for later")}</button>
        <button type="button" className="button primary" disabled={busy||!!page.editLocked} onClick={()=>{setBusy(true);setError('');void onRestore(entry).then(()=>setOpen(false)).catch(reason=>setError(reason instanceof Error?reason.message:String(reason))).finally(()=>setBusy(false));}}>{busy?uiText("Restoring…"):uiText("Restore this draft")}</button>
      </div>
    </Modal>}
  </>;
}
