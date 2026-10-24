import {useEffect,useRef} from 'react';

/** Ranges use the current visible order; hidden IDs never become bulk targets. */
export function useLibraryRangeSelection(ids:string[],selected:Set<string>,onChange:(next:Set<string>)=>void,scope:string) {
  const anchor=useRef<string|null>(null);
  useEffect(()=>{anchor.current=null;},[scope]);
  return (id:string,range=false)=>{
    const start=anchor.current?ids.indexOf(anchor.current):-1,end=ids.indexOf(id);
    const next=new Set(selected),add=!next.has(id);
    const targets=range&&start>=0&&end>=0?ids.slice(Math.min(start,end),Math.max(start,end)+1):[id];
    for(const value of targets){if(add)next.add(value);else next.delete(value);}
    if(!range||start<0)anchor.current=id;
    onChange(next);
  };
}
