import {useEffect,useRef,useState,type RefObject} from 'react';
import {useViewportPageIds} from './useViewportPageIds';
import {api} from '../api';
interface PreviewState {key:string;snippets:Record<string,string>;loading:boolean;error:string}
export function useSearchSnippets(vaultId:string,query:string,pageIds:string[],allowEmptyQuery=false,revision='',root?:RefObject<HTMLElement|null>):Omit<PreviewState,'key'> {
  const nearby=useViewportPageIds(root,pageIds);
  const ids=JSON.stringify([...new Set(nearby)].sort());
  const cache=useRef<{key:string;snippets:Map<string,string>}>({key:'',snippets:new Map()});
  const cacheKey=JSON.stringify([vaultId,query.trim(),revision]);
  const term=query.trim(),enabled=!!term||allowEmptyQuery,key=JSON.stringify([vaultId,term,ids,allowEmptyQuery,revision]);
  const [state,setState]=useState<PreviewState>({key:'',snippets:{},loading:false,error:''});
  useEffect(()=>{
    const controller=new AbortController(),requested=JSON.parse(ids) as string[];
    if(cache.current.key!==cacheKey)cache.current={key:cacheKey,snippets:new Map()};
    const cached=Object.fromEntries(requested.filter(id=>cache.current.snippets.has(id)).map(id=>[id,cache.current.snippets.get(id)!]));
    const values=requested.filter(id=>!cache.current.snippets.has(id));
    setState({key,snippets:cached,loading:enabled&&values.length>0,error:''});
    if(!enabled||!values.length)return()=>controller.abort();
    // Batch local excerpts. These requests never call an AI provider.
    const timer=setTimeout(()=>{
      void (async()=>{
        for(let offset=0;offset<values.length;offset+=100){
          const result=await api.searchSnippets(vaultId,term,values.slice(offset,offset+100),controller.signal);
          if(controller.signal.aborted)return;
          for(const [id,snippet] of Object.entries(result.snippets)){cache.current.snippets.delete(id);cache.current.snippets.set(id,snippet);}
          while(cache.current.snippets.size>240)cache.current.snippets.delete(cache.current.snippets.keys().next().value!);
          setState(current=>current.key===key?{...current,snippets:{...current.snippets,...result.snippets}}:current);
        }
        if(!controller.signal.aborted)setState(current=>current.key===key?{...current,loading:false}:current);
      })().catch(()=>{if(!controller.signal.aborted)setState(current=>current.key===key?{...current,loading:false,error:'Some note previews are unavailable. You can still open the results.'}:current);});
    },150);
    return()=>{clearTimeout(timer);controller.abort();};
  },[key,vaultId,term,ids,enabled,cacheKey]);
  return state.key===key?state:{snippets:{},loading:enabled&&pageIds.length>0,error:''};
}
