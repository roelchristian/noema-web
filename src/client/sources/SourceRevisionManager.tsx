import {sourceRevisionLabels} from './source-revision-labels';
import {useId,useState} from 'react';
import {sourceEditorialRevisionLimit,sourceRevisionLimit,type SourceReprocessingSummary} from '../../shared/source-reprocessing';
import {Modal,ModalHeader} from '../components/Modal';
import {ConfirmDialog} from '../components/ConfirmDialog';
import {Icon} from '../components/Icon';
import {getLocale,t as uiText} from '../i18n';
import './source-reprocessing-workspace.css';

type Props={revisions:SourceReprocessingSummary[];busy:boolean;creating:boolean;readingId:string;preferredId:string;onDelete:(id:string)=>Promise<void>;onContinue:()=>void;onClose:()=>void};
export function SourceRevisionManager({revisions,busy,creating,readingId,preferredId,onDelete,onContinue,onClose}:Props){
 const titleId=useId(),[deleting,setDeleting]=useState<SourceReprocessingSummary|null>(null);
 const versionLabels=sourceRevisionLabels(revisions);
 const full=revisions.length>=sourceEditorialRevisionLimit,total=revisions.length+1;
 const deletionsNeeded=revisions.length-sourceEditorialRevisionLimit+1;
 const statusLabels={completed:'Completed',failed:'Failed',interrupted:'Interrupted',running:'Processing',queued:'Queued'};
 const statusTones={completed:'success',failed:'danger',interrupted:'warning',running:'info',queued:'info'} as const;
 return <>
  <Modal className="confirmation-dialog source-revision-manager" titleId={titleId} onClose={()=>{if(!busy)onClose();}}>
   <ModalHeader titleId={titleId} closeDisabled={busy}>{full?uiText(total>sourceRevisionLimit?'Version limit exceeded ({value0} of {value1} max revisions)':'Version limit reached ({value0} of {value1} max revisions)',{value0:total,value1:sourceRevisionLimit}):uiText('Manage revisions')}</ModalHeader>
   <p>{uiText('You can keep up to {value0} versions, including the original.',{value0:sourceRevisionLimit})}{full&&<> {uiText(deletionsNeeded===1?'Delete {value0} editorial revision to continue.':'Delete {value0} editorial revisions to continue.',{value0:deletionsNeeded})}</>}</p>
   <ul className="source-revision-list" aria-label={uiText('Source versions')}>
    <li><div className="source-revision-summary"><strong>{uiText('Original processed')}</strong><small>{uiText('Always retained')}{!preferredId?' · '+uiText('Preferred'):''}</small></div><span className="source-revision-protected">{uiText('Original')}</span></li>
    {revisions.map(item=>{
     const active=item.status==='queued'||item.status==='running';
     return <li key={item.id}><div className="source-revision-summary"><strong>{versionLabels.get(item.id)} · {new Date(item.createdAt).toLocaleString(getLocale())}</strong><span className="source-revision-state" data-status={statusTones[item.status]}>{uiText(statusLabels[item.status])}</span>{readingId===item.id&&<small>{uiText('Reading')}</small>}{preferredId===item.id&&<small>{uiText('Preferred')}</small>}</div><button type="button" className="source-activity-icon-action" title={uiText(active?'Stop processing before deleting this revision.':'Delete revision')} disabled={busy||active} aria-label={uiText('Delete revision from {value0}',{value0:new Date(item.createdAt).toLocaleString(getLocale())})} onClick={()=>setDeleting(item)}><Icon name="trash"/></button></li>;
    })}
   </ul>
   <div className="dialog-actions"><button type="button" className="button confirmation-cancel" disabled={busy} onClick={onClose}>{uiText(creating?'Cancel':'Done')}</button>{creating&&<button type="button" className="button primary" disabled={busy||full} onClick={onContinue}>{uiText('Continue to new revision')}</button>}</div>
  </Modal>
  {deleting&&<ConfirmDialog title={uiText('Delete editorial revision?')} description={uiText('This permanently deletes the selected revision, its corrections, and its processing report. The original source and other revisions are retained.')} action={uiText('Delete revision')} danger onConfirm={()=>onDelete(deleting.id)} onClose={()=>setDeleting(null)}/>}
 </>;
}
