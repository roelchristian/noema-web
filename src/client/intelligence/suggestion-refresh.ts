import {api} from '../api';

interface Listener {
  version?:string;
  refresh:()=>Promise<boolean>;
  onError:(reason:unknown)=>void;
}
interface Watcher {
  listeners:Set<Listener>;
  check:()=>void;
  stop:()=>void;
  schedule:()=>void;
}
const watchers=new Map<string,Watcher>();

// Both panels share a cheap version poll. Only changed inputs fetch ranked results.
export function watchSuggestions(vault:string,pageId:string,refresh:()=>Promise<boolean>,onError:(reason:unknown)=>void):()=>void {
  const key=JSON.stringify([vault,pageId]);
  let watcher=watchers.get(key);
  if(!watcher){
    const listeners=new Set<Listener>(),controller=new AbortController();
    let checking=false,pending=false;
    const check=()=>{
      if(document.hidden||controller.signal.aborted)return;
      if(checking){pending=true;return;}
      checking=true;
      void api.suggestionVersion(vault,pageId,controller.signal).then(async({version})=>{
        await Promise.all([...listeners].map(async listener=>{
          if(controller.signal.aborted||!listeners.has(listener)||listener.version===version)return;
          if(await listener.refresh()&&listeners.has(listener))listener.version=version;
        }));
      }).catch(reason=>{
        if(!controller.signal.aborted)for(const listener of listeners){listener.version=undefined;listener.onError(reason);}
      }).finally(()=>{
        checking=false;
        if(pending){pending=false;check();}
      });
    };
    let timeout:ReturnType<typeof setTimeout>;
    const schedule=()=>{clearTimeout(timeout);timeout=setTimeout(check,400);};
    const interval=setInterval(check,15000);
    window.addEventListener('focus',schedule);window.addEventListener('noema:ai-activity',schedule);
    document.addEventListener('visibilitychange',check);
    watcher={listeners,check,schedule,stop:()=>{
      controller.abort();clearTimeout(timeout);clearInterval(interval);
      window.removeEventListener('focus',schedule);window.removeEventListener('noema:ai-activity',schedule);document.removeEventListener('visibilitychange',check);
    }};
    watchers.set(key,watcher);
  }
  const current=watcher,listener={refresh,onError};
  current.listeners.add(listener);
  current.schedule();
  return()=>{
    current.listeners.delete(listener);
    if(!current.listeners.size){current.stop();watchers.delete(key);}
  };
}

// A revision is a hint to check the durable version, not a new subscription.
export function requestSuggestionCheck(vault:string,pageId:string) {
  watchers.get(JSON.stringify([vault,pageId]))?.schedule();
}
