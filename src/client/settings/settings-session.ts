import {useLayoutEffect, useRef, useState} from 'react';

const storageKey='noema-settings-session';
const tabs=['appearance','images','calendar','knowledge','intelligence','voice','storage','security'] as const;
export type SettingsTab=typeof tabs[number];
type AIView='overview'|'indexing'|'diagnostics';
type SettingsSession={tab:SettingsTab;aiView:AIView;scrollTop:number};

export function readSettingsSession():SettingsSession|null {
  try {
    const value=JSON.parse(window.sessionStorage.getItem(storageKey)??'null');
    if(!value||!tabs.includes(value.tab))return null;
    return {tab:value.tab,aiView:['overview','indexing','diagnostics'].includes(value.aiView)?value.aiView:'overview',
      scrollTop:typeof value.scrollTop==='number'&&Number.isFinite(value.scrollTop)?Math.max(0,value.scrollTop):0};
  } catch {return null;}
}
function saveSettingsSession(value:SettingsSession|null) {
  try {
    if(value)window.sessionStorage.setItem(storageKey,JSON.stringify(value));
    else window.sessionStorage.removeItem(storageKey);
  } catch {/* Settings remain usable without browser storage. */}
}

export function useSettingsOpen() {
  const [open,setOpen]=useState(()=>readSettingsSession()!==null);
  function changeOpen(next:boolean) {
    if(!next)saveSettingsSession(null);
    setOpen(next);
  }
  return [open,changeOpen] as const;
}

export function useSettingsSession(initialTab:SettingsTab) {
  const [initial]=useState(()=>readSettingsSession()??{tab:initialTab,aiView:'overview' as const,scrollTop:0});
  const [tab,setTab]=useState(initial.tab);
  const [aiView,setAIView]=useState<AIView>(initial.aiView);
  const panels=useRef<HTMLDivElement>(null);
  const first=useRef(true);
  useLayoutEffect(()=>{
    const element=panels.current!;
    const target=first.current?initial.scrollTop:0;
    first.current=false;
    let restoring=true;
    let resize:ResizeObserver|undefined;
    const save=()=>saveSettingsSession({tab,aiView,scrollTop:restoring?target:element.scrollTop});
    const stop=()=>{restoring=false;resize?.disconnect();};
    const restore=()=>{
      if(!restoring)return;
      element.scrollTop=target;
      if(Math.abs(element.scrollTop-target)<1)stop();
    };
    restore();
    if(restoring&&typeof ResizeObserver!=='undefined') {
      resize=new ResizeObserver(restore);
      // Observe the content as well as its viewport: settings can load asynchronously.
      resize.observe(element);
      for(const child of element.children)resize.observe(child);
    }
    const interrupt=()=>{stop();save();};
    const scroll=()=>{if(!restoring)save();};
    element.addEventListener('scroll',scroll);
    for(const type of ['wheel','touchstart','pointerdown','keydown'])element.addEventListener(type,interrupt,{passive:true});
    save();
    return()=>{
      stop();
      element.removeEventListener('scroll',scroll);
      for(const type of ['wheel','touchstart','pointerdown','keydown'])element.removeEventListener(type,interrupt);
    };
  },[tab,aiView,initial]);
  return {tab,setTab,aiView,setAIView,panels};
}
