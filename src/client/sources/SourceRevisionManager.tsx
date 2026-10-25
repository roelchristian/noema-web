import {useId,useState} from 'react';
import {sourceEditorialRevisionLimit,sourceRevisionLimit,type SourceReprocessingSummary} from '../../shared/source-reprocessing';
import {Modal,ModalHeader} from '../components/Modal';
import {ConfirmDialog} from '../components/ConfirmDialog';
import {getLocale,t as uiText} from '../i18n';
import './source-reprocessing-workspace.css';

type Props={revisions:SourceReprocessingSummary[];busy:boolean;creating:boolean;readingId:string;preferredId:string;onDelete:(id:string)=>Promise<void>;onContinue:()=>void;onClose:()=>void};
export function SourceRevisionManager({revisions,busy,creating,readingId,preferredId,onDelete,onContinue,onClose}:Props){
 const titleId=useId(),[deleting,setDeleting]=useState<SourceReprocessingSummary|null>(null);
 const full=revisions.length>=sourceEditorialRevisionLimit,total=revisions.length+1;
 return <>
  <Modal className="source-revision-manager" titleId={titleId} onClose={()=>{if(!busy)onClose();}}>
   <ModalHeader titleId={titleId} closeDisabled={busy}>{uiText(creating&&full?'Revision limit reached':'Manage revisions')}</ModalHeader>
   <p>{uiText('Keep up to {value0} versions, including the original.',{value0:sourceRevisionLimit})} <strong>{total} / {sourceRevisionLimit}</strong></p>
   {creating&&full&&<p role="status">{uiText(revisions.length===sourceEditorialRevisionLimit?'Delete one editorial revision to make room before continuing.':'Delete {value0} editorial revisions to make room before continuing.',{value0:revisions.length-sourceEditorialRevisionLimit+1})}</p>}
   <ul className="source-revision-list" aria-label={uiText('Source versions')}>
    <li><div><strong>{uiText('Original processed')}</strong><small>{uiText('Always retained')}{!preferredId?' · '+uiText('Preferred'):''}</small></div><span className="source-revision-protected">{uiText('Original')}</span></li>
    {revisions.map(item=>{
     const active=item.status==='queued'||item.status==='running';
     return <li key={item.id}><div><strong>{uiText('Editorial revision')} · {new Date(item.createdAt).toLocaleString(getLocale())}</strong><small>{uiText(item.status)}{readingId===item.id?' · '+uiText('Reading'):''}{preferredId===item.id?' · '+uiText('Preferred'):''}</small>{active&&<small>{uiText('Stop processing before deleting this revision.')}</small>}</div><button type="button" className="button small is-danger" disabled={busy||active} aria-label={uiText('Delete revision from {value0}',{value0:new Date(item.createdAt).toLocaleString(getLocale())})} onClick={()=>setDeleting(item)}>{uiText('Delete')}</button></li>;
    })}
   </ul>
   <div className="dialog-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>{uiText(creating?'Cancel':'Done')}</button>{creating&&<button type="button" className="button primary" disabled={busy||full} onClick={onContinue}>{uiText('Continue to new revision')}</button>}</div>
  </Modal>
  {deleting&&<ConfirmDialog title={uiText('Delete editorial revision?')} description={uiText('This permanently deletes the selected revision, its corrections, and its processing report. The original source and other revisions are retained.')} action={uiText('Delete revision')} danger onConfirm={()=>onDelete(deleting.id)} onClose={()=>setDeleting(null)}/>}
 </>;
}
