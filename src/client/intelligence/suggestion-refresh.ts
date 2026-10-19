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
        if(!controller.signal.aborted)for(const listener of listeners)if(listener.version===undefined)listener.onError(reason);
      }).finally(()=>{
        checking=false;
        if(pending){pending=false;check();}
      });
    };
    const interval=setInterval(check,15000);
    document.addEventListener('visibilitychange',check);
    watcher={listeners,check,stop:()=>{
      controller.abort();clearInterval(interval);document.removeEventListener('visibilitychange',check);
    }};
    watchers.set(key,watcher);
  }
  const current=watcher,listener={refresh,onError};
  current.listeners.add(listener);
  const timeout=setTimeout(current.check,400);
  return()=>{
    clearTimeout(timeout);current.listeners.delete(listener);
    if(!current.listeners.size){current.stop();watchers.delete(key);}
  };
}
