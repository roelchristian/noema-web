import {useEffect,useState,type RefObject} from 'react';

/** Observe card proximity, not page bodies. Work and excerpt requests stay bounded. */
export function useViewportPageIds(root:RefObject<HTMLElement|null>|undefined,pageIds:string[]):string[] {
  const candidates=JSON.stringify(pageIds),[windowIds,setWindowIds]=useState<{key:string;ids:string[]}>({key:'',ids:[]});
  useEffect(()=>{
    if(!root)return;
    const element=root.current,ids=JSON.parse(candidates) as string[],allowed=new Set(ids);
    if(!element||typeof IntersectionObserver==='undefined'){setWindowIds({key:candidates,ids:ids.slice(0,24)});return;}
    const nearby=new Set<string>();
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const id=(entry.target as HTMLElement).dataset.libraryRow?.slice(5);if(!id)continue;if(entry.isIntersecting)nearby.add(id);else nearby.delete(id);}
      // Stable ordering prevents a sequence of observer callbacks from restarting work.
      const visible=ids.filter(id=>nearby.has(id)).slice(0,60);
      setWindowIds(previous=>previous.key===candidates&&JSON.stringify(previous.ids)===JSON.stringify(visible)?previous:{key:candidates,ids:visible});
    },{rootMargin:'300px 0px'});
    for(const row of element.querySelectorAll<HTMLElement>('[data-library-row^="page:"]'))if(allowed.has(row.dataset.libraryRow!.slice(5)))observer.observe(row);
    return()=>observer.disconnect();
  },[root,candidates]);
  return root?(windowIds.key===candidates?windowIds.ids:[]):pageIds;
}
