import {useLayoutEffect,useState} from 'react';

/** Animate a completed title once; screen readers always receive the complete name. */
export function ChatTitle({title,animate=false}:{title:string;animate?:boolean}) {
 const [displayed,setDisplayed]=useState(title);
 useLayoutEffect(()=>{
  if(!animate||window.matchMedia('(prefers-reduced-motion: reduce)').matches){setDisplayed(title);return;}
  const characters=Array.from(title);let index=0;setDisplayed('');
  const timer=window.setInterval(()=>{index++;setDisplayed(characters.slice(0,index).join(''));if(index>=characters.length)window.clearInterval(timer);},Math.max(14,Math.floor(600/Math.max(1,characters.length))));
  return()=>window.clearInterval(timer);
 },[title,animate]);
 return <><span className="sr-only">{title}</span><span aria-hidden="true" className={animate?'chat-title-reveal':undefined}>{displayed||'\u00a0'}</span></>;
}
