import {t as uiText} from '../i18n';
import {useState,type FormEvent} from 'react';
import {Modal,ModalHeader} from '../components/Modal';

export function VaultBackupDialog({action,vaultName,onExport,onImport,onClose}:{action:'export'|'import';vaultName?:string;onExport:()=>Promise<{blob:Blob;filename:string}>;onImport:(file:File,name?:string)=>Promise<void>;onClose:()=>void}) {
  const [file,setFile]=useState<File|null>(null),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const importing=action==='import';
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try {
      if(importing) {
        if(!file)throw new Error('Choose a .noemabkp backup.');
        await onImport(file,name.trim()||undefined);
      } else {
        const {blob,filename}=await onExport(),url=URL.createObjectURL(blob);
        const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
      }
      onClose();
    }catch(error){setError(error instanceof Error?error.message:'Could not complete the vault backup.');}
    finally{setBusy(false);}
  }
  return <Modal titleId="vault-backup-title" onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}>
    <ModalHeader titleId="vault-backup-title" closeDisabled={busy}>{importing?uiText("Import vault"):uiText("Export vault backup")}</ModalHeader>
    <p>{importing?uiText("Restore a .noemabkp file into a new vault. Your existing vaults are kept."):uiText("Download “{value0}” as one compressed .noemabkp file, including its notes, entities, organization, saved AI results, and images.",{value0: vaultName})}</p>
    {importing?<>
      <label>{uiText("Backup file")}<input autoFocus type="file" accept=".noemabkp" required disabled={busy} onChange={event=>{setFile(event.target.files?.[0]??null);setError('');}}/></label>
      <label>{uiText("New vault name (optional)")}<input maxLength={200} value={name} placeholder={uiText("Use the name in the backup")} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
      <p className="section-hint">{uiText("Imported vaults start unlocked. You can lock the new vault after import. Maximum backup size: 128 MB.")}</p>
    </>:<p className="section-hint">{uiText("Pending edits are saved first. Backups are not password encrypted.")}</p>}
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    {busy&&<p role="status">{importing?uiText("Restoring vault…"):uiText("Preparing download…")}</p>}
    <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>{uiText("Cancel")}</button><button className="button primary" disabled={busy||importing&&!file}>{busy?uiText("Working…"):importing?uiText("Import vault"):uiText("Download backup")}</button></div>
  </form></Modal>;
}
