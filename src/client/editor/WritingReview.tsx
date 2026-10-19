import {reviewTextEdits} from '../../shared/review-diff';
import {useEffect,useRef,useState} from 'react';
import type {Entity,Segment} from '../../shared/domain';
import {entityMentionName} from '../../shared/domain';
import {Icon} from '../components/Icon';
import {reviewEditedSegments,type WritingReviewChange} from './writing-review';

function correctionDiff(original:string,replacement:string){
  let offset=0;
  const chunks=reviewTextEdits(original,replacement).map((edit,index)=>{
    const prefix=original.slice(offset,edit.start);offset=edit.end;
    return <span key={index}>{prefix}<del>{original.slice(edit.start,edit.end)}</del><ins>{edit.replacement}</ins></span>;
  });
  return <>{chunks}{original.slice(offset)}</>;
}

/** A suggestion lives beside its source block, outside the editable document. */
export function WritingReview({loading,error,change,entities,remaining=0,stale=false,onAccept,onDismiss,onAcceptAll,onClose}:{loading?:boolean;error?:string;change?:WritingReviewChange;entities:Entity[];remaining?:number;stale?:boolean;onAccept:(change:WritingReviewChange,ids?:string[])=>string|null;onDismiss:()=>void;onAcceptAll?:()=>void;onClose:()=>void}){
  const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    if(loading||error||change)return;
    const timer=setTimeout(()=>close.current(),3000);
    return ()=>clearTimeout(timer);
  },[loading,error,change]);
  const [acceptError,setAcceptError]=useState('');
  const [excluded,setExcluded]=useState<Set<string>>(()=>new Set());
  const selectedIds=change?.edits.filter(edit=>!excluded.has(edit.id)).map(edit=>edit.id)??[];
  const text=(segments:Segment[])=>segments.map(segment=>segment.entityId?segment.mentionText??entityMentionName(entities.find(entity=>entity.id===segment.entityId))??'':segment.text??'').join('');
  return <aside className={'writing-review-inline'+(change?' has-suggestion':!loading&&!error?' is-complete':'')} contentEditable={false} aria-label="AI writing review" aria-busy={loading||undefined} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}}>
    {change?<>
      <div className="writing-review-diff" aria-label={`Suggested correction for ${change.scope==='span'?'highlighted text':'this block'}`}>{correctionDiff(text(change.selected),text(reviewEditedSegments(change.selected,change.edits.filter(edit=>!excluded.has(edit.id)))))}</div>
      <div className="writing-review-actions">
        <button type="button" className="writing-review-accept" disabled={stale||!selectedIds.length} onClick={()=>setAcceptError(onAccept(change,selectedIds)??'')}><Icon name="check"/>{selectedIds.length===change.edits.length?'Accept':`Accept selected (${selectedIds.length})`}</button>
        {(change.edits.length>1||excluded.size>0)&&<details className="writing-review-pick"><summary>Choose edits ({change.edits.length})</summary><div>
          <div className="writing-review-pick-actions"><button type="button" disabled={stale} onClick={()=>setExcluded(new Set())}>Select all</button><button type="button" disabled={stale} onClick={()=>setExcluded(new Set(change.edits.map(edit=>edit.id)))}>Clear selection</button></div>
          {change.edits.map(edit=><label key={edit.id}><input type="checkbox" checked={!excluded.has(edit.id)} disabled={stale} onChange={event=>{const checked=event.target.checked;setExcluded(current=>{const next=new Set(current);if(checked)next.delete(edit.id);else next.add(edit.id);return next;});}}/><span><span className="writing-review-edit-context">{change.selected[edit.segmentIndex]?.text?.slice(Math.max(0,edit.start-24),edit.start)}</span><del>{change.selected[edit.segmentIndex]?.text?.slice(edit.start,edit.end)}</del><ins>{edit.replacement}</ins><span className="writing-review-edit-context">{change.selected[edit.segmentIndex]?.text?.slice(edit.end,edit.end+24)}</span></span></label>)}
        </div></details>}
        <details><summary>Why</summary><div>{change.reasons.map((reason,index)=><p key={index}>{reason}</p>)}</div></details>
        {remaining>1&&<><span className="writing-review-count">{remaining} suggestions</span><button type="button" onClick={onAcceptAll}>Accept all</button><button type="button" onClick={onClose}>Dismiss all</button></>}
        <button type="button" className="writing-review-dismiss" aria-label="Dismiss suggestion" title="Dismiss suggestion" onClick={onDismiss}><Icon name="close"/></button>
      </div>
      {(stale||acceptError)&&<p className="writing-review-error" role="status">{stale?'Text changed. Select it again to review.':acceptError}</p>}
    </>:<div className="writing-review-status"><span role={error?'alert':'status'}>{loading?<><span className="scan-spinner" aria-hidden="true"/> Reviewing…</>:error||'No changes suggested.'}</span><button type="button" aria-label="Dismiss review" title="Dismiss review" onClick={onClose}><Icon name="close"/></button></div>}
  </aside>;
}
