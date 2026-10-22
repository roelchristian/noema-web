import {t as uiText} from '../i18n';
import {useEffect,useState} from 'react';
import type {Entity} from '../../shared/domain';
import type {EntityImpact} from '../../shared/entity-lifecycle';
import {api} from '../api';
import {Modal,ModalHeader} from '../components/Modal';
import {Icon} from '../components/Icon';

export function SourceLifecycleDialog({vaultId,source,onUpdated,onClose}:{vaultId:string;source:Entity;onUpdated:()=>Promise<void>;onClose:()=>void}) {
  const [state,setState]=useState<EntityImpact|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;setState(null);
    void api.sourceLifecycle(vaultId,source.id).then(value=>{if(active)setState(value);}).catch(error=>{if(active)setError(String(error));});
    return()=>{active=false;};
  },[vaultId,source.id,attempt]);
  async function change(action:'archive'|'restore'|'delete') {
    setBusy(true);setError('');
    try {
      const result=await api.changeSourceLifecycle(vaultId,source.id,action,confirmation,state?.version);
      if('id' in result){setState(result);setConfirmation('');}
      await onUpdated();
      onClose();
    }catch(error){setError(error instanceof Error?error.message:String(error));setAttempt(value=>value+1);}
    finally{setBusy(false);}
  }
  const archived = state ? !!state.archivedAt : !!source.archived_at;
  const counts = state ? [
    [uiText("Active pages"), state.counts.activePages],
    [uiText("Pages in Trash"), state.counts.trashedPages],
    [uiText("Block references"), state.counts.blockReferences],
  ] as const : [];
  const savedDetails = state ? [
    [uiText("Properties"), state.counts.properties],
    [uiText("Incoming properties"), state.counts.incomingProperties],
    [uiText("Relationships"), state.counts.relationships],
    [uiText("Attachments"), state.counts.attachments],
    [uiText("Citations"), state.counts.citations],
    [uiText("Highlights"), state.counts.highlights],
    [uiText("Reading notes"), state.counts.readingNotes],
    [uiText("Bookmarks"), state.counts.bookmarks],
    [uiText("Pending source drafts"), state.counts.pendingSourceDrafts],
  ] as const : [];
  return <Modal className="confirmation-dialog source-lifecycle-dialog" titleId="source-lifecycle-title" onClose={()=>{if(!busy)onClose();}}>
    <ModalHeader titleId="source-lifecycle-title" leading={<Icon name={archived?'undo':'archive'}/>} closeDisabled={busy}>{source.type==='source'?uiText("Manage source"):uiText("Manage entity")}</ModalHeader>
    <div className="lifecycle-identity"><span className="lifecycle-identity-icon"><Icon name={source.type}/></span><div><h3>{state?.name??source.name}</h3><span>{archived?uiText("Archived"):uiText("Active")}</span></div></div>
    {!state&&<p className="lifecycle-loading" role="status">{uiText("Checking linked pages…")}</p>}
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    {state&&<>
      <p className="lifecycle-description">{archived?uiText("Restore to include this item in your library, search, and linking suggestions again."):uiText("Set this item aside without losing its connections. You can restore it at any time.")}</p>
      <section className="lifecycle-impact" aria-label={uiText("Linked references")}>
        <h3>{uiText("Linked references")}</h3>
        <dl className="lifecycle-counts">{counts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </section>
      <div className="lifecycle-policies">
        <section><h3><Icon name="check"/>{uiText("Remains accessible")}</h3><ul>{state.remainsAccessible.map(item=><li key={item}>{uiText(item)}</li>)}</ul></section>
        <section><h3><Icon name="archive"/>{uiText("Hidden while archived")}</h3><ul>{state.hiddenByDefault.map(item=><li key={item}>{uiText(item)}</li>)}</ul></section>
      </div>
      <details className="lifecycle-details"><summary>{uiText("Saved references and unsaved drafts")}</summary>
        <dl className="lifecycle-saved-counts">{savedDetails.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p>{uiText(state.draftPolicy)}</p>
      </details>
      {source.type==='source'&&archived&&<details className="lifecycle-details lifecycle-delete"><summary>{uiText("Permanent deletion")}</summary>
        {state.deleteBlockedReason?<p role="status">{uiText("Permanent deletion remains blocked:")} {state.deleteBlockedReason}</p>:<>
          <p>{uiText("Permanent deletion cannot be undone. It removes the source, highlights, metadata, and entity connections. Original files are scheduled for cleanup after 24 hours. Export a vault backup first if you need a copy.")}</p>
          <label>{uiText("Type the exact source name to permanently delete it")}<input autoComplete="off" value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)}/></label>
          <button type="button" className="button confirmation-action is-danger" disabled={busy||confirmation!==state.name} onClick={()=>void change('delete')}><Icon name="trash"/>{uiText("Delete permanently")}</button>
        </>}
      </details>}
    </>}
    <div className="dialog-actions">
      <button type="button" autoFocus className="button confirmation-cancel" disabled={busy} onClick={onClose}>{uiText("Cancel")}</button>
      {!state&&error&&<button type="button" className="button" onClick={()=>{setError('');setAttempt(value=>value+1);}}>{uiText("Retry")}</button>}
      {state&&<button type="button" className="button primary" disabled={busy} onClick={()=>void change(archived?'restore':'archive')}><Icon name={archived?'undo':'archive'}/>{busy?uiText("Working…"):archived?(source.type==='source'?uiText("Restore source"):uiText("Restore entity")):(source.type==='source'?uiText("Archive source"):uiText("Archive entity"))}</button>}
    </div>
  </Modal>;
}
