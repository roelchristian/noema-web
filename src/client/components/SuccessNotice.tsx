import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {t as uiText} from '../i18n';

/** Each confirmation gets a new occurrence, even when its text is unchanged. */
export function useSuccessNotice():[string,(message:string)=>void,number] {
  const [notice,setNotice]=useState({message:'',occurrence:0});
  const show=useCallback((message:string)=>setNotice(current=>({message,occurrence:current.occurrence+1})),[]);
  return [notice.message,show,notice.occurrence];
}

/** Transient confirmations share one timer and pause while being interacted with. */
export function SuccessNotice({message,occurrence,onDismiss,action,inline=false,dismissLabel=uiText('Dismiss notification')}:{message:string;occurrence?:unknown;onDismiss:()=>void;action?:ReactNode;inline?:boolean;dismissLabel?:string}) {
  const [hovered,setHovered]=useState(false);
  const [focused,setFocused]=useState(false);
  const dismiss=useRef(onDismiss);
  useEffect(()=>{dismiss.current=onDismiss;},[onDismiss]);
  useEffect(()=>{
    if(!message||hovered||focused)return;
    const timer=setTimeout(()=>dismiss.current(),5000);
    return()=>clearTimeout(timer);
  },[message,occurrence,hovered,focused]);
  if(!message)return null;
  return <div id={inline?undefined:'toast'} className={'success-notice'+(inline?' is-inline':'')} role="status" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocus={()=>setFocused(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}>
    <span>{message}</span>
    {action}
    <button type="button" className="toast-close" onMouseDown={event=>event.preventDefault()} onClick={onDismiss} aria-label={dismissLabel}>×</button>
  </div>;
}
