import {t as uiText} from '../i18n';
import {useEffect,useState} from 'react';
import type {Entity} from '../../shared/domain';
import type {SourceLifecycle} from '../../shared/source-lifecycle';
import {api} from '../api';
import {Modal,ModalHeader} from '../components/Modal';

export function SourceLifecycleDialog({vaultId,source,onUpdated,onClose}:{vaultId:string;source:Entity;onUpdated:()=>Promise<void>;onClose:()=>void}) {
  const [state,setState]=useState<SourceLifecycle|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;
    void api.sourceLifecycle(vaultId,source.id).then(value=>{if(active)setState(value);}).catch(error=>{if(active)setError(String(error));});
    return()=>{active=false;};
  },[vaultId,source.id,attempt]);
  async function change(action:'archive'|'restore'|'delete') {
    setBusy(true);setError('');
    try {
      const result=await api.changeSourceLifecycle(vaultId,source.id,action,confirmation);
      if('id' in result){setState(result);setConfirmation('');}
      await onUpdated();
      onClose();
    }catch(error){setError(error instanceof Error?error.message:String(error));setAttempt(value=>value+1);}
    finally{setBusy(false);}
  }
  return <Modal className="confirmation-dialog source-lifecycle-dialog" titleId="source-lifecycle-title" onClose={()=>{if(!busy)onClose();}}>
    <ModalHeader titleId="source-lifecycle-title" closeDisabled={busy}>{uiText("Manage source")}</ModalHeader>
    <p><strong>{state?.name??source.name}</strong></p>
    {!state&&<p role="status">{uiText("Checking linked pages…")}</p>}
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    {state&&<>
      <p>{state.archivedAt?uiText("This source is archived. Restore it to return it to the active library."):uiText("Archive this source to hide it from the active library. Its original file, highlights, and metadata are kept, and you can restore it later.")}</p>
      <p role="status">{state.linkedPageCount}{" " + uiText("linked") + " "}{state.linkedPageCount===1?uiText("page"):uiText("pages")}{" " + uiText("(including Trash).")}</p>
      {state.blockedReason&&<p role="status">{state.blockedReason}</p>}
      {state.archivedAt&&!state.blockedReason&&<>
        <p>{uiText("Permanent deletion cannot be undone. It removes the source, highlights, metadata, and entity connections. Original files are scheduled for cleanup after 24 hours. Export a vault backup first if you need a copy.")}</p>
        <label>{uiText("Type the exact source name to permanently delete it")}<input autoComplete="off" value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)}/></label>
      </>}
    </>}
    <div className="dialog-actions">
      <button type="button" autoFocus className="button" disabled={busy} onClick={onClose}>{uiText("Cancel")}</button>
      {!state&&error&&<button type="button" className="button" onClick={()=>{setError('');setAttempt(value=>value+1);}}>{uiText("Retry")}</button>}
      {state&&(state.archivedAt?<>
        <button type="button" className="button" disabled={busy} onClick={()=>void change('restore')}>{uiText("Restore source")}</button>
        <button type="button" className="button is-danger" disabled={busy||!!state.blockedReason||confirmation!==state.name} onClick={()=>void change('delete')}>{uiText("Delete permanently")}</button>
      </>:<button type="button" className="button" disabled={busy||!!state.blockedReason} onClick={()=>void change('archive')}>{uiText("Archive source")}</button>)}
    </div>
  </Modal>;
}
