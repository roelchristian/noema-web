import type {WritingAction} from '../../shared/editor-review';
import {personaIdentityName,type PersonaIdentity} from '../../shared/ai-personas';
import {t as uiText} from '../i18n';
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
export function WritingReview({action,persona,loading,error,change,entities,remaining=0,stale=false,onAccept,onDismiss,onAcceptAll,onClose}:{action?:WritingAction;persona?:PersonaIdentity;loading?:boolean;error?:string;change?:WritingReviewChange;entities:Entity[];remaining?:number;stale?:boolean;onAccept:(change:WritingReviewChange,ids?:string[])=>string|null;onDismiss:()=>void;onAcceptAll?:()=>void;onClose:()=>void}){
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
  return <aside className={'writing-review-inline'+(change?' has-suggestion':!loading&&!error?' is-complete':'')} contentEditable={false} aria-label={uiText("AI writing review")} aria-busy={loading||undefined} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}}>
    <p>{action==='rewrite'?'Rewrite with Persona':action==='recast'?'Recast':action==='refine'?'Refine':'Proofread'}{persona&&` · ${personaIdentityName(persona)} · v${persona.version}${persona.expression?` · ${persona.expression}`:''}`}</p>
    {change?<>
      <details><summary>Before and after</summary><p><strong>Before: </strong>{text(change.selected)}</p><p><strong>After: </strong>{text(reviewEditedSegments(change.selected,change.edits.filter(edit=>!excluded.has(edit.id))))}</p></details>
      <div className="writing-review-diff" aria-label={uiText("Suggested correction for {value0}",{value0: change.scope==='span'?'highlighted text':'this block'})}>{correctionDiff(text(change.selected),text(reviewEditedSegments(change.selected,change.edits.filter(edit=>!excluded.has(edit.id)))))}</div>
      <div className="writing-review-actions">
        <button type="button" className="writing-review-accept" disabled={stale||!selectedIds.length} onClick={()=>setAcceptError(onAccept(change,selectedIds)??'')}><Icon name="check"/>{selectedIds.length===change.edits.length?uiText("Accept"):uiText("Accept selected ({value0})",{value0: selectedIds.length})}</button>
        {(change.edits.length>1||excluded.size>0)&&<details className="writing-review-pick"><summary>{uiText("Choose edits (")}{change.edits.length})</summary><div>
          <div className="writing-review-pick-actions"><button type="button" disabled={stale} onClick={()=>setExcluded(new Set())}>{uiText("Select all")}</button><button type="button" disabled={stale} onClick={()=>setExcluded(new Set(change.edits.map(edit=>edit.id)))}>{uiText("Clear selection")}</button></div>
          {change.edits.map(edit=><label key={edit.id}><input type="checkbox" checked={!excluded.has(edit.id)} disabled={stale} onChange={event=>{const checked=event.target.checked;setExcluded(current=>{const next=new Set(current);if(checked)next.delete(edit.id);else next.add(edit.id);return next;});}}/><span><span className="writing-review-edit-context">{change.selected[edit.segmentIndex]?.text?.slice(Math.max(0,edit.start-24),edit.start)}</span><del>{change.selected[edit.segmentIndex]?.text?.slice(edit.start,edit.end)}</del><ins>{edit.replacement}</ins><span className="writing-review-edit-context">{change.selected[edit.segmentIndex]?.text?.slice(edit.end,edit.end+24)}</span></span></label>)}
        </div></details>}
        <details><summary>{uiText("Why")}</summary><div>{change.reasons.map((reason,index)=><p key={index}>{reason}</p>)}</div></details>
        {remaining>1&&<><span className="writing-review-count">{remaining}{" " + uiText("suggestions")}</span><button type="button" onClick={onAcceptAll}>{uiText("Accept all")}</button><button type="button" onClick={onClose}>{uiText("Dismiss all")}</button></>}
        <button type="button" className="writing-review-dismiss" aria-label={uiText("Dismiss suggestion")} title={uiText("Dismiss suggestion")} onClick={onDismiss}><Icon name="close"/></button>
      </div>
      {(stale||acceptError)&&<p className="writing-review-error" role="status">{stale?uiText("Text changed. Select it again to review."):acceptError}</p>}
    </>:<div className="writing-review-status"><span role={error?'alert':'status'}>{loading?<><span className="scan-spinner" aria-hidden="true"/>{" " + uiText("Reviewing…")}</>:error||uiText("No changes suggested.")}</span><button type="button" aria-label={uiText("Dismiss review")} title={uiText("Dismiss review")} onClick={onClose}><Icon name="close"/></button></div>}
  </aside>;
}
