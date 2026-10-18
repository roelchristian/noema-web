import {useSyncExternalStore} from 'react';

const storageKey='noema-markdown-typing';
let enabled=true;
const listeners=new Set<()=>void>();

export function readMarkdownTyping():boolean {
  try {const stored=localStorage.getItem(storageKey);if(stored!==null)enabled=stored!=='false';}
  catch {/* Keep the preference for this session when storage is unavailable. */}
  return enabled;
}
export function rememberMarkdownTyping(value:boolean) {
  enabled=value;
  try {localStorage.setItem(storageKey,String(value));}catch {/* Session preference still applies. */}
  listeners.forEach(listener=>listener());
}
function subscribe(listener:()=>void) {
  listeners.add(listener);
  const changed=(event:StorageEvent)=>{if(event.key===storageKey||event.key===null){enabled=event.newValue!=='false';listener();}};
  window.addEventListener('storage',changed);
  return ()=>{listeners.delete(listener);window.removeEventListener('storage',changed);};
}
export function useMarkdownTyping() {return useSyncExternalStore(subscribe,readMarkdownTyping,()=>true);}
