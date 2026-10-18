import {useState, type FormEvent} from 'react';
import type {Organization} from '../../shared/domain';
import {api} from '../api';
import {Modal,ModalHeader} from '../components/Modal';
import {Select} from '../components/Select';

export function FolderCollectionDialog({vaultId,data,folderId='',collectionId='',onChanged,onClose}: {
  vaultId:string;data:Organization;folderId?:string;collectionId?:string;onChanged:(data:Organization)=>void;onClose:()=>void;
}) {
  const [folder,setFolder]=useState(folderId || data.folders[0]?.id || '');
  const [collection,setCollection]=useState(collectionId || data.collections[0]?.id || '');
  const [mode,setMode]=useState<'linked'|'pages'>('linked');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  function folderPath(id:string):string {
    const current=data.folders.find(item=>item.id===id);
    return current ? (current.parent_id ? folderPath(current.parent_id)+' / ' : '')+current.name : '';
  }
  async function submit(event:FormEvent) {
    event.preventDefault();if(busy||!folder||!collection)return;
    setBusy(true);setError('');
    try {onChanged(await api.organize(vaultId,'folder-memberships',{folder_id:folder,collection_id:collection,mode}));onClose();}
    catch(error){setError(error instanceof Error?error.message:'Could not add this folder.');}
    finally{setBusy(false);}
  }
  return <Modal className="confirmation-dialog folder-collection-dialog" titleId="folder-collection-title" onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}>
    <ModalHeader titleId="folder-collection-title" closeDisabled={busy}>Add folder to collection</ModalHeader>
    <label htmlFor="collection-folder">Folder<Select id="collection-folder" value={folder} disabled={busy} onChange={event=>setFolder(event.target.value)}>{data.folders.map(item=><option key={item.id} value={item.id}>{folderPath(item.id)}</option>)}</Select></label>
    <label htmlFor="folder-collection">Collection<Select id="folder-collection" value={collection} disabled={busy} onChange={event=>setCollection(event.target.value)}>{data.collections.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
    <fieldset className="folder-collection-modes" disabled={busy}><legend>Include as</legend>
      <label><input type="radio" name="folder-collection-mode" checked={mode==='linked'} onChange={()=>setMode('linked')}/><span>Linked folder <small className="folder-collection-suggestion">Suggested</small><small>Keep the folder and its subfolders together. Future additions appear automatically.</small></span></label>
      <label><input type="radio" name="folder-collection-mode" checked={mode==='pages'} onChange={()=>setMode('pages')}/><span>Current pages only<small>Add pages from this folder and its subfolders individually. Future folder additions won’t be added automatically.</small></span></label>
    </fieldset>
    <p>Pages keep their original folder locations.</p>
    {!data.folders.length&&<p>Create a folder first.</p>}
    {!data.collections.length&&<p>Create a collection first.</p>}
    {error&&<p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="button confirmation-cancel" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy||!folder||!collection}>{busy?'Adding…':mode==='linked'?'Link folder':'Add current pages'}</button></div>
  </form></Modal>;
}
