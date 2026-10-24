import {useSyncExternalStore} from 'react';
import {useMobileViewport} from '../components/WorkspaceNavigation';

export type TransliterationLayout='off'|'below'|'side-by-side';
const listeners=new Set<()=>void>();
const session=new Map<string,TransliterationLayout>();
const keyFor=(pageKey:string)=>'noema-transliteration:'+pageKey;
function layout(value:unknown):TransliterationLayout{return value==='below'||value==='side-by-side'?value:'off';}
export function readTransliteration(pageKey:string):TransliterationLayout {
  const key=keyFor(pageKey);
  if(session.has(key))return session.get(key)!;
  try {const value=layout(localStorage.getItem(key));session.set(key,value);return value;}
  catch {return session.get(key)??'off';}
}
export function rememberTransliteration(pageKey:string,value:TransliterationLayout) {
  const key=keyFor(pageKey);session.set(key,value);
  try {localStorage.setItem(key,value);}catch {/* Keep the preference in this session. */}
  listeners.forEach(listener=>listener());
}
function subscribe(listener:()=>void) {
  listeners.add(listener);
  const changed=(event:StorageEvent)=>{
    if(event.key===null)session.clear();
    else if(event.key.startsWith('noema-transliteration:'))session.delete(event.key);
    else return;
    listener();
  };
  window.addEventListener('storage',changed);
  return ()=>{listeners.delete(listener);window.removeEventListener('storage',changed);};
}
export function useTransliteration(pageKey:string) {
  const mobile=useMobileViewport();
  const preference=useSyncExternalStore(subscribe,()=>readTransliteration(pageKey),()=>'off' as const);
  return mobile&&preference==='side-by-side'?'below':preference;
}
