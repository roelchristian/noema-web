import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Folder,Organization} from '../../shared/domain';
import {api} from '../api';
import {Modal,ModalHeader} from '../components/Modal';
import {Select} from '../components/Select';
import {folderBreadcrumbs} from './breadcrumbs';

export function FolderDialog({vaultId,data,folder,parentId='',onChanged,onClose}:{vaultId:string;data:Organization;folder?:Folder;parentId?:string;onChanged:(data:Organization)=>void;onClose:()=>void}) {
  const active=useRef(true),currentVault=useRef(vaultId);currentVault.current=vaultId;
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const [name,setName]=useState(folder?.name??''),[description,setDescription]=useState(folder?.description??'');
  const [parent,setParent]=useState(folder?.parent_id??parentId),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();if(busy||!name.trim())return;setBusy(true);setError('');
    try {const result=await api.organize(vaultId,'folders'+(folder?'/'+folder.id:''),{name,description,parent_id:parent||null},folder?'PUT':'POST');if(active.current&&currentVault.current===vaultId){onChanged(result);onClose();}}
    catch(error){if(active.current&&currentVault.current===vaultId)setError(error instanceof Error?error.message:'Could not save folder.');}
    finally{if(active.current&&currentVault.current===vaultId)setBusy(false);}
  }
  const parents=data.folders.filter(candidate=>!folder||!folderBreadcrumbs(data.folders,candidate.id).some(crumb=>crumb.target?.folder===folder.id));
  return <Modal className="folder-definition-dialog" titleId="folder-definition-title" onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}><ModalHeader titleId="folder-definition-title" closeDisabled={busy}>{folder?'Edit folder':'New folder'}</ModalHeader><label>Name<input autoFocus required maxLength={200} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label><label className="container-description-field">Description <small>Optional</small><textarea aria-label="Description" maxLength={2000} rows={2} value={description} disabled={busy} placeholder="What belongs in this folder?" onChange={event=>setDescription(event.target.value)}/></label><label>Parent folder<Select value={parent} disabled={busy} onChange={event=>setParent(event.target.value)}><option value="">Workspace root</option>{parents.map(candidate=><option key={candidate.id} value={candidate.id}>{folderBreadcrumbs(data.folders,candidate.id).map(crumb=>crumb.label).join(' / ')}</option>)}</Select></label>{error&&<p className="dialog-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy||!name.trim()}>{busy?'Saving…':'Save'}</button></div></form></Modal>;
}
