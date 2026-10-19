import {useSyncExternalStore} from 'react';
import messages from './messages.json';

export const interfaceLanguages=[{id:'en',name:'English'},{id:'fr',name:'Français'},{id:'de',name:'Deutsch'},{id:'es',name:'Español'}] as const;
export type InterfaceLanguage=typeof interfaceLanguages[number]['id'];
export const languageStorageKey='noema.interface-language.v1';
const listeners=new Set<()=>void>();
function valid(value:unknown):value is InterfaceLanguage{return interfaceLanguages.some(language=>language.id===value);}
function readLanguage():InterfaceLanguage{try{const saved=localStorage.getItem(languageStorageKey);return valid(saved)?saved:'en';}catch{return 'en';}}
let language:InterfaceLanguage=typeof window==='undefined'?'en':readLanguage();
let storageError=false;
export function getLocale(){return language;}
function applyLanguage(){if(typeof document!=='undefined')document.documentElement.lang=language;}
applyLanguage();
export function setInterfaceLanguage(next:InterfaceLanguage){
  if(!valid(next))return;
  language=next;storageError=false;
  try{localStorage.setItem(languageStorageKey,next);}catch{storageError=true;}
  applyLanguage();listeners.forEach(listener=>listener());
}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{
  if(event.key!==languageStorageKey&&event.key!==null)return;
  language=readLanguage();applyLanguage();listeners.forEach(listener=>listener());
});
export function useInterfaceLanguage(){
  const current=useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},()=>language,()=> 'en' as InterfaceLanguage);
  return {language:current,setLanguage:setInterfaceLanguage,storageError};
}
const catalog:Record<string,readonly string[]>=messages;
/** Translate only authored interface strings; document content never passes through here. */
export function t(message:string,values?:Record<string,string|number|boolean|null|undefined>):string{
  const index=language==='fr'?0:language==='de'?1:language==='es'?2:-1;
  const translated=index<0?message:catalog[message]?.[index]??message;
  return values?translated.replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(values,key)?String(values[key]??''):match):translated;
}
