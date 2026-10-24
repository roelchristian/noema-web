import {useEffect,useRef,useState,type ReactNode} from 'react';
import {t as uiText} from '../i18n';

/** Transient confirmations share one timer and pause while being interacted with. */
export function SuccessNotice({message,onDismiss,action,inline=false,dismissLabel=uiText('Dismiss notification')}:{message:string;onDismiss:()=>void;action?:ReactNode;inline?:boolean;dismissLabel?:string}) {
  const [hovered,setHovered]=useState(false);
  const [focused,setFocused]=useState(false);
  const dismiss=useRef(onDismiss);
  useEffect(()=>{dismiss.current=onDismiss;},[onDismiss]);
  useEffect(()=>{
    if(!message||hovered||focused)return;
    const timer=setTimeout(()=>dismiss.current(),5000);
    return()=>clearTimeout(timer);
  },[message,hovered,focused]);
  if(!message)return null;
  return <div id={inline?undefined:'toast'} className={'success-notice'+(inline?' is-inline':'')} role="status" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocus={()=>setFocused(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}>
    <span>{message}</span>
    {action}
    <button type="button" className="toast-close" onMouseDown={event=>event.preventDefault()} onClick={onDismiss} aria-label={dismissLabel}>×</button>
  </div>;
}
