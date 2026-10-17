import {useEffect,useState,type FormEvent} from 'react';
import type {Vault,VaultDeletionPreview,VaultDeletionConfirmation} from '../../shared/domain';
import {ApiError} from '../api';
import {Modal} from '../components/Modal';

export function DeleteVaultDialog({vault,onPreview,onExport,onDelete,onClose}:{vault:Vault;onPreview:()=>Promise<VaultDeletionPreview>;onExport:()=>Promise<{blob:Blob;filename:string}>;onDelete:(confirmation:VaultDeletionConfirmation)=>Promise<void>;onClose:()=>void}) {
  const [preview,setPreview]=useState<VaultDeletionPreview|null>(null),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
  const [name,setName]=useState(''),[passphrase,setPassphrase]=useState(''),[acknowledged,setAcknowledged]=useState(false);
  const [busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[error,setError]=useState(''),[needsRefresh,setNeedsRefresh]=useState(false),[backupStarted,setBackupStarted]=useState(false);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setName('');setPassphrase('');setAcknowledged(false);setNeedsRefresh(false);
    void onPreview().then(result=>{if(active)setPreview(result);}).catch(error=>{if(active)setError(error instanceof Error?error.message:'Could not load vault contents.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[vault.id,version]);
  const working=busy||exporting;
  const ready=!!preview&&preview.canDelete&&!loading&&!working&&!needsRefresh&&name===preview.vault.name&&acknowledged&&(!preview.vault.protected||!!passphrase);
  async function submit(event:FormEvent) {
    event.preventDefault();if(!ready||!preview)return;setBusy(true);setError('');
    try{await onDelete({name,fingerprint:preview.fingerprint,acknowledged,passphrase:preview.vault.protected?passphrase:undefined});onClose();}
    catch(error){setError(error instanceof Error?error.message:'Could not delete the vault.');if(error instanceof ApiError&&error.status===409){setNeedsRefresh(true);setAcknowledged(false);}setPassphrase('');}
    finally{setBusy(false);}
  }
  async function downloadBackup() {
    setExporting(true);setError('');
    try {
      const {blob,filename}=await onExport(),url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);setBackupStarted(true);
    }catch(error){setError(error instanceof Error?error.message:'Could not download a backup.');}
    finally{setExporting(false);}
  }
  return <Modal className="delete-vault-dialog" titleId="delete-vault-title" onClose={()=>{if(!working)onClose();}}><form onSubmit={submit}>
    <span className="dialog-eyebrow">Permanent deletion</span>
    <h2 id="delete-vault-title">Delete “{vault.name}”?</h2>
    <p id="delete-vault-warning">This permanently deletes this vault and everything in it, including notes in Trash, knowledge entities, saved AI results, organization, and original attachments. There is no Undo. Other vaults are kept.</p>
    {loading&&<p role="status">Saving pending edits and checking vault contents…</p>}
    {!loading&&preview&&<>
      <dl className="vault-deletion-counts" aria-label="Vault contents">{[
        ['Notes',preview.counts.notes],['Notes in Trash',preview.counts.trashedNotes],['Knowledge entities',preview.counts.entities],['Original files and uploads',preview.counts.sourceFiles],['Images and uploads',preview.counts.images],['Folders',preview.counts.folders],['Collections',preview.counts.collections],
      ].map(([label,count])=><div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
      {preview.blockers.map(blocker=><p key={blocker} className="vault-deletion-blocker" role="status">{blocker}</p>)}
      <div className="vault-deletion-backup"><strong>Keep a backup before deleting</strong><p>A .noemabkp file can be imported as a new vault later. Backups include attached originals; unattached uploads are excluded. Backup files are not password encrypted.</p><button type="button" className="button" disabled={working} onClick={()=>void downloadBackup()}>{exporting?'Preparing backup…':backupStarted?'Download backup again':'Download vault backup'}</button>{backupStarted&&<p role="status">Backup download started. Keep the file before continuing.</p>}</div>
      {preview.canDelete&&<>
        <label htmlFor="delete-vault-name">Type <strong>{preview.vault.name}</strong> to confirm<input id="delete-vault-name" autoComplete="off" spellCheck={false} maxLength={200} value={name} disabled={working||needsRefresh} aria-describedby="delete-vault-warning" onChange={event=>setName(event.target.value)}/></label>
        {preview.vault.protected&&<label htmlFor="delete-vault-passphrase">Confirm vault passphrase<input id="delete-vault-passphrase" type="password" autoComplete="current-password" maxLength={500} value={passphrase} disabled={working||needsRefresh} onChange={event=>setPassphrase(event.target.value)}/></label>}
        <label className="vault-deletion-ack"><input type="checkbox" checked={acknowledged} disabled={working||needsRefresh} onChange={event=>setAcknowledged(event.target.checked)}/><span>I have a backup or accept permanently losing this vault and its contents.</span></label>
      </>}
    </>}
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="button" autoFocus disabled={working} onClick={onClose}>Cancel</button><button type="button" className="button" disabled={working||loading} onClick={()=>setVersion(value=>value+1)}>Refresh contents</button><button className="button danger" disabled={!ready}>{busy?'Deleting vault…':'Delete permanently'}</button></div>
  </form></Modal>;
}
