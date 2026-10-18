import {useState,type FormEvent} from 'react';
import type {Page} from '../../shared/domain';
import {Modal,ModalHeader} from '../components/Modal';

export function PageEditLockDialog({page,onChange,onClose}: {page:Page;onChange:(locked:boolean,password?:string)=>Promise<void>;onClose:()=>void}) {
  const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const unlocking=!!page.editLocked;
  async function submit(event:FormEvent) {
    event.preventDefault();if(busy)return;
    if (!unlocking && password!==confirmation) {setError('The passwords do not match.');return;}
    setBusy(true);setError('');
    try {await onChange(!unlocking,password);onClose();}
    catch(error){setError(error instanceof Error?error.message:'Could not change the editing lock.');}
    finally{setBusy(false);setPassword('');setConfirmation('');}
  }
  return <Modal className="confirmation-dialog page-edit-lock-dialog" titleId="page-edit-lock-title" onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}>
    <ModalHeader titleId="page-edit-lock-title" closeDisabled={busy}>{unlocking?'Unlock editing':'Set editing password'}</ModalHeader>
    <p>{unlocking ? 'Enter this page’s password to make changes.' : 'The page stays readable. Use this password to unlock editing.'}</p>
    <label htmlFor="page-edit-password">Password<input id="page-edit-password" type="password" autoComplete={unlocking?'current-password':'new-password'} minLength={unlocking?undefined:4} maxLength={500} required autoFocus disabled={busy} value={password} onChange={event=>setPassword(event.target.value)}/></label>
    {!unlocking&&<label htmlFor="page-edit-password-confirm">Confirm password<input id="page-edit-password-confirm" type="password" autoComplete="new-password" minLength={4} maxLength={500} required disabled={busy} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>}
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="button confirmation-cancel" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy?'Saving…':unlocking?'Unlock editing':'Lock editing'}</button></div>
  </form></Modal>;
}
