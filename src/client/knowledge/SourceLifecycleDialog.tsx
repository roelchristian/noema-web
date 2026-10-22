import {t as uiText} from '../i18n';
import {useEffect,useState} from 'react';
import type {Entity} from '../../shared/domain';
import type {EntityImpact} from '../../shared/entity-lifecycle';
import {api} from '../api';
import {Modal,ModalHeader} from '../components/Modal';

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
  return <Modal className="confirmation-dialog source-lifecycle-dialog" titleId="source-lifecycle-title" onClose={()=>{if(!busy)onClose();}}>
    <ModalHeader titleId="source-lifecycle-title" closeDisabled={busy}>{source.type==='source'?uiText("Manage source"):uiText("Manage entity")}</ModalHeader>
    <p><strong>{state?.name??source.name}</strong></p>
    {!state&&<p role="status">{uiText("Checking linked pages…")}</p>}
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    {state&&<>
      <p>{state.archivedAt?'This identity is archived. Restore it to return it to active discovery.':'Archive this identity to retire it from active use. You can restore it later.'}</p>
      <p role="status">{state.counts.activePages} active pages · {state.counts.trashedPages} pages in Trash · {state.counts.blockReferences} block references</p>
      <p>{state.counts.properties} properties · {state.counts.incomingProperties} incoming properties · {state.counts.relationships} relationships · {state.counts.attachments} attachments · {state.counts.citations} citations · {state.counts.highlights} highlights · {state.counts.readingNotes} reading notes · {state.counts.bookmarks} bookmarks · {state.counts.pendingSourceDrafts} pending source drafts</p>
      <p><strong>Remains accessible</strong></p><ul>{state.remainsAccessible.map(item=><li key={item}>{item}</li>)}</ul>
      <p><strong>Hidden by default</strong></p><ul>{state.hiddenByDefault.map(item=><li key={item}>{item}</li>)}</ul>
      <details><summary>Saved references and unsaved drafts</summary><p>{state.draftPolicy}</p></details>
      {source.type==='source'&&state.archivedAt&&state.deleteBlockedReason&&<p role="status">Permanent deletion remains blocked: {state.deleteBlockedReason}</p>}
      {source.type==='source'&&state.archivedAt&&!state.deleteBlockedReason&&<>
        <p>{uiText("Permanent deletion cannot be undone. It removes the source, highlights, metadata, and entity connections. Original files are scheduled for cleanup after 24 hours. Export a vault backup first if you need a copy.")}</p>
        <label>{uiText("Type the exact source name to permanently delete it")}<input autoComplete="off" value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)}/></label>
      </>}
    </>}
    <div className="dialog-actions">
      <button type="button" autoFocus className="button" disabled={busy} onClick={onClose}>{uiText("Cancel")}</button>
      {!state&&error&&<button type="button" className="button" onClick={()=>{setError('');setAttempt(value=>value+1);}}>{uiText("Retry")}</button>}
      {state&&(state.archivedAt?<>
        <button type="button" className="button" disabled={busy} onClick={()=>void change('restore')}>{source.type==='source'?uiText("Restore source"):uiText("Restore entity")}</button>
        {source.type==='source'&&<button type="button" className="button is-danger" disabled={busy||!!state.deleteBlockedReason||confirmation!==state.name} onClick={()=>void change('delete')}>{uiText("Delete permanently")}</button>}
      </>:<button type="button" className="button" disabled={busy} onClick={()=>void change('archive')}>{source.type==='source'?uiText("Archive source"):uiText("Archive entity")}</button>)}
    </div>
  </Modal>;
}
