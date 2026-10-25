import {useEffect,useId,useRef,useState,type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import type {ChatThread} from '../../shared/chat';
import {ChatTitle} from './ChatTitle';
import {Icon} from '../components/Icon';
interface Props {thread:ChatThread;selected:boolean;disabled:boolean;revealed:boolean;animate:boolean;time:string;exactTime?:string;onSelect:()=>void;onReveal:(open:boolean)=>void;onDelete:()=>void}
const scopeLabels={vault:'',page:'Page',source:'Source',entity:'Entity',folder:'Folder'};
const revealWidth=76;
export function ChatThreadRow({thread,selected,disabled,revealed,animate,time,exactTime,onSelect,onReveal,onDelete}:Props) {
 const [offset,setOffset]=useState<number|null>(null);
 const gesture=useRef<{id:number;x:number;y:number;base:number;offset:number;locked:boolean;cancelled:boolean}|null>(null),suppressClick=useRef(false);
 const title=thread.title||'Untitled conversation';
 const tooltipId=useId(),[tooltip,setTooltip]=useState<{left:number;top:number}|null>(null);
 function showDetails(element:HTMLElement){
  const rect=element.getBoundingClientRect(),width=Math.min(280,window.innerWidth-24);
  setTooltip({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:Math.max(12,Math.min(rect.bottom+6,window.innerHeight-110))});
 }
 useEffect(()=>{
  if(!tooltip)return;
  const close=()=>setTooltip(null);
  window.addEventListener('scroll',close,true);window.addEventListener('resize',close);
  return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);};
 },[tooltip]);
 return <li className="chat-thread-swipe" data-revealed={revealed} data-dragging={offset!==null} style={{'--chat-swipe-offset':`${offset??(revealed?revealWidth:0)}px`} as CSSProperties}
  onPointerEnter={event=>{if(event.pointerType!=='touch')showDetails(event.currentTarget);}}
  onPointerLeave={()=>setTooltip(null)}
  onFocus={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))showDetails(event.currentTarget);}}
  onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setTooltip(null);}}
  onPointerDown={event=>{
   setTooltip(null);
   suppressClick.current=false;
   if(disabled||event.button!==0||(event.target as Element).closest('.chat-thread-actions-toggle,.chat-thread-delete'))return;
   gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,base:revealed?revealWidth:0,offset:revealed?revealWidth:0,locked:false,cancelled:false};
  }}
  onPointerMove={event=>{
   const current=gesture.current;if(!current||current.id!==event.pointerId||current.cancelled)return;
   const dx=event.clientX-current.x,dy=event.clientY-current.y;
   if(!current.locked){if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){current.cancelled=true;return;}if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy)*1.2)return;current.locked=true;event.currentTarget.setPointerCapture?.(event.pointerId);}
   event.preventDefault();current.offset=Math.max(0,Math.min(revealWidth,current.base+dx));setOffset(current.offset);
  }}
  onPointerUp={event=>{const current=gesture.current;if(!current||current.id!==event.pointerId)return;gesture.current=null;if(current.locked){suppressClick.current=true;onReveal(current.offset>revealWidth/2);}setOffset(null);}}
  onPointerCancel={()=>{gesture.current=null;setOffset(null);}}
  onClickCapture={event=>{if(suppressClick.current&&event.detail>0){event.preventDefault();event.stopPropagation();suppressClick.current=false;}}}
  onKeyDown={event=>{if(event.key==='Escape'){setTooltip(null);onReveal(false);event.currentTarget.querySelector<HTMLButtonElement>('.chat-thread-actions-toggle')?.focus();}}}>
  <div className="chat-thread-action" aria-hidden={!revealed}><button type="button" className="chat-thread-delete" aria-label={`Delete ${title}`} disabled={disabled||!revealed} tabIndex={revealed?0:-1} onClick={onDelete}><Icon name="trash"/><span>Delete</span></button></div>
  <div className="chat-thread-surface">
   <button type="button" className="chat-thread" aria-describedby={tooltip?tooltipId:undefined} data-thread-id={thread.id} aria-current={selected?'page':undefined} disabled={disabled} onClick={()=>{onReveal(false);onSelect();}}><span className="chat-thread-title"><ChatTitle title={title} animate={animate}/></span></button>
   <button type="button" className="chat-thread-actions-toggle" aria-label={`Actions for ${title}`} aria-expanded={revealed} disabled={disabled} onClick={()=>onReveal(!revealed)}><Icon name="more"/></button>
  </div>
  {tooltip&&createPortal(<div id={tooltipId} className="chat-thread-tooltip" role="tooltip" style={tooltip}><span>{title}</span><div>{thread.scope.kind!=='vault'&&<span>{scopeLabels[thread.scope.kind]} · </span>}<time dateTime={thread.updatedAt} title={exactTime}>{time}{exactTime?' · '+exactTime:''}</time></div></div>,document.body)}
 </li>;
}
