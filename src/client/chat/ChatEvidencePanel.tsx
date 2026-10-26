import {useEffect,useId,useRef,useState} from 'react';
import type {ChatEvidence} from '../../shared/chat';
import {Icon} from '../components/Icon';
import {chatEvidenceLabel,clampEvidenceWidth,groupChatEvidence,sameChatEvidence} from './chat-evidence';

interface Props {
 evidence:ChatEvidence[];selected:ChatEvidence|null;mobile:boolean;verifying:boolean;
 onInspect:(evidence:ChatEvidence,trigger:HTMLElement)=>void;
 onOpenOriginal:(evidence:ChatEvidence,trigger:HTMLElement)=>void;
 onShowIndex:()=>void;onClose:()=>void;
}
/** Receives only recorded evidence; the workspace verifies each passage before selecting or opening it. */
export function ChatEvidencePanel({evidence,selected,mobile,verifying,onInspect,onOpenOriginal,onShowIndex,onClose}:Props) {
 const panel=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null),dragCleanup=useRef<(()=>void)|null>(null);
 const [width,setWidth]=useState(360),headingId=useId();
 const groups=groupChatEvidence(evidence);
 const availableWidth=()=>{const workspace=panel.current?.closest<HTMLElement>('.chat-workspace');return workspace?workspace.clientWidth-(workspace.querySelector<HTMLElement>('.chat-history-pane')?.getBoundingClientRect().width??0):window.innerWidth;};
 useEffect(()=>{close.current?.focus();return()=>dragCleanup.current?.();},[]);
 useEffect(()=>{
  if(!mobile)return;
  const previous=document.body.style.overflow;document.body.style.overflow='hidden';
  return()=>{document.body.style.overflow=previous;};
 },[mobile]);
 useEffect(()=>{
  if(mobile)return;
  const workspace=panel.current?.closest<HTMLElement>('.chat-workspace');
  if(!workspace)return;
  const resize=()=>{const next=clampEvidenceWidth(width,availableWidth());workspace.style.setProperty('--chat-evidence-width',next+'px');if(next!==width)setWidth(next);};
  resize();window.addEventListener('resize',resize);
  const observer=typeof window.ResizeObserver==='function'?new window.ResizeObserver(resize):null;
  observer?.observe(workspace);const history=workspace.querySelector<HTMLElement>('.chat-history-pane');if(history)observer?.observe(history);
  return()=>{observer?.disconnect();window.removeEventListener('resize',resize);workspace.style.removeProperty('--chat-evidence-width');};
 },[width,mobile]);
 function resizeWidth(next:number){setWidth(clampEvidenceWidth(next,availableWidth()));}
 return <><button className="chat-evidence-backdrop" aria-label="Close evidence" tabIndex={-1} onClick={onClose}/><aside ref={panel} className="chat-evidence" role={mobile?'dialog':undefined} aria-modal={mobile?true:undefined} aria-labelledby={headingId} tabIndex={-1} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
  if(event.key==='Tab'&&mobile){const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'));if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}}
 }}>
 {!mobile&&<div className="chat-evidence-resize" role="separator" aria-orientation="vertical" aria-label="Resize evidence panel" aria-valuemin={260} aria-valuemax={Math.min(640,Math.max(260,(availableWidth())-340))} aria-valuenow={width} tabIndex={0} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();resizeWidth(event.key==='Home'?260:event.key==='End'?640:width+(event.key==='ArrowLeft'?24:-24));}}} onPointerDown={event=>{
  if(event.button!==0)return;event.preventDefault();dragCleanup.current?.();
  const startX=event.clientX,startWidth=panel.current?.getBoundingClientRect().width??width;
  const move=(next:PointerEvent)=>resizeWidth(startWidth+startX-next.clientX);
  const done=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',done);window.removeEventListener('pointercancel',done);dragCleanup.current=null;};
  dragCleanup.current=done;window.addEventListener('pointermove',move);window.addEventListener('pointerup',done);window.addEventListener('pointercancel',done);
 }}/>}
 <header><h2 id={headingId}>Evidence{!selected&&` · ${evidence.length} references`}</h2><button ref={close} type="button" className="chat-icon" aria-label="Close evidence panel" onClick={onClose}><Icon name="close"/></button></header>
 {verifying&&<p role="status" className="chat-muted">Checking the evidence revision…</p>}
 {selected?<div className="chat-evidence-detail"><button className="chat-evidence-index-link" type="button" onClick={()=>{onShowIndex();close.current?.focus();}}><Icon name="arrow-left"/>All {evidence.length} references</button><span className="chat-evidence-kind">{chatEvidenceLabel(selected)}</span><h3>{selected.title}</h3><p className="chat-muted">{selected.id} · {selected.locator}</p>{selected.status!=='current'&&<p className="chat-error" role="status">{selected.status==='deleted'?'This material is no longer available.':'This material has changed since the answer. The quotation below is the saved evidence.'}</p>}<blockquote>{selected.excerpt}</blockquote>{selected.revision!==undefined&&<p className="chat-muted">Recorded revision {selected.revision}</p>}<button type="button" className="button" disabled={selected.status!=='current'||verifying} onClick={event=>onOpenOriginal(selected,event.currentTarget)}>Open in original</button></div>:<p className="chat-muted">Recorded passages grouped by material. Choose a passage to verify its current revision and inspect the saved quotation.</p>}
 <nav className="chat-evidence-list" aria-label="References in this answer">{groups.map(group=><section className="chat-evidence-group" key={group.key}><h3>{group.title}<small>{group.kind==='source'?'Source':group.kind==='note'?'Note':'Structured entity'} · {group.items.length} {group.items.length===1?'passage':'passages'}</small></h3>{group.items.map((item,index)=><button key={item.id+':'+item.fingerprint+':'+index} type="button" aria-current={sameChatEvidence(selected,item)?'true':undefined} onClick={event=>onInspect(item,event.currentTarget)}><strong>{item.id} · {item.locator||'Recorded passage'}</strong><small>{chatEvidenceLabel(item)}{item.status!=='current'?' · '+item.status:''}</small><span className="chat-evidence-preview">{item.excerpt}</span></button>)}</section>)}</nav>
 </aside></>;
}
