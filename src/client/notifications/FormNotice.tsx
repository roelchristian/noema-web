import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {InlineNotice} from './InlineNotice';

/** Form feedback owns its occurrence and expiry; the shared inline primitive is untimed. */
export function useFormNotice():[string,(message:string)=>void,number] {
  const [notice,setNotice]=useState({message:'',occurrence:0});
  const show=useCallback((message:string)=>setNotice(current=>({message,occurrence:current.occurrence+1})),[]);
  return [notice.message,show,notice.occurrence];
}

export function FormNotice({message,occurrence,onDismiss,action}:{message:string;occurrence?:unknown;onDismiss:()=>void;action?:ReactNode}) {
  const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
  const [hidden,setHidden]=useState(()=>typeof document!=='undefined'&&document.hidden);
  const remaining=useRef(4000),dismiss=useRef(onDismiss);
  dismiss.current=onDismiss;
  useEffect(()=>{remaining.current=4000;},[message,occurrence]);
  useEffect(()=>{
    const changed=()=>setHidden(document.hidden);
    document.addEventListener('visibilitychange',changed);
    return()=>document.removeEventListener('visibilitychange',changed);
  },[]);
  useEffect(()=>{
    if(!message||hovered||focused||hidden)return;
    const started=Date.now();
    const timer=setTimeout(()=>dismiss.current(),remaining.current);
    return()=>{clearTimeout(timer);remaining.current=Math.max(0,remaining.current-(Date.now()-started));};
  },[message,occurrence,hovered,focused,hidden]);
  if(!message)return null;
  return <div className="form-notice-region" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocus={()=>setFocused(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}>
    <InlineNotice tone="success" title={message} variant="compact" actions={action} dismissible onDismiss={onDismiss}/>
  </div>;
}
