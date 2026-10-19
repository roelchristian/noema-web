import {useState} from 'react';
import type {Entity,Segment} from '../../shared/domain';
import {entityMentionName} from '../../shared/domain';
import {Modal,ModalHeader} from '../components/Modal';
import type {WritingReviewChange} from './writing-review';

export function WritingReview({loading,error,changes,entities,onAccept,onClose}:{loading:boolean;error:string;changes:WritingReviewChange[];entities:Entity[];onAccept:(change:WritingReviewChange)=>string|null;onClose:()=>void}){
  const [resolved,setResolved]=useState<Record<string,string>>({});
  const [errors,setErrors]=useState<Record<string,string>>({});
  const text=(segments:Segment[])=>segments.map(segment=>segment.entityId?segment.mentionText??entityMentionName(entities.find(entity=>entity.id===segment.entityId))??'':segment.text??'').join('');
  function accept(change:WritingReviewChange){
    const error=onAccept(change);
    if(error)setErrors(current=>({...current,[change.blockId]:error}));
    else {setResolved(current=>({...current,[change.blockId]:'Accepted'}));setErrors(current=>({...current,[change.blockId]:''}));}
  }
  const pending=changes.filter(change=>!resolved[change.blockId]);
  return <Modal titleId="writing-review-title" className="writing-review-modal" onClose={onClose}>
    <ModalHeader titleId="writing-review-title">Review with AI</ModalHeader>
    <div className="writing-review-body" aria-busy={loading}>
      <p>Spelling, punctuation, grammar, and clearer phrasing. Review each correction or accept it directly.</p>
      {loading&&<p role="status"><span className="scan-spinner" aria-hidden="true"/> Reviewing selected text…</p>}
      {error&&<p role="alert">{error}</p>}
      {!loading&&!error&&!changes.length&&<p role="status">No corrections suggested.</p>}
      {!!pending.length&&<button type="button" className="primary" onClick={()=>pending.forEach(accept)}>Accept all corrections</button>}
      <div className="writing-review-list">{changes.map((change,index)=><article key={change.blockId} className="writing-review-card">
        <header><strong>{change.scope==='span'?'Highlighted span':'Block'} {index+1}</strong>{resolved[change.blockId]&&<span role="status">{resolved[change.blockId]}</span>}</header>
        <p className="writing-review-text">{text(change.replacement)}</p>
        <details><summary>Review correction</summary>
          <div className="writing-review-comparison"><div><h3>Original</h3><p className="writing-review-text">{text(change.selected)}</p></div><div><h3>Suggested</h3><p className="writing-review-text">{text(change.replacement)}</p></div></div>
          {change.reasons.map((reason,i)=><p key={i}>{reason}</p>)}
        </details>
        {errors[change.blockId]&&<p role="alert">{errors[change.blockId]}</p>}
        {!resolved[change.blockId]&&<footer><button type="button" className="primary" onClick={()=>accept(change)}>Accept correction</button><button type="button" onClick={()=>setResolved(current=>({...current,[change.blockId]:'Dismissed'}))}>Dismiss</button></footer>}
      </article>)}</div>
      {!loading&&!!changes.length&&!pending.length&&<p role="status">All suggestions reviewed.</p>}
    </div>
  </Modal>;
}
