import {useEffect,useState} from 'react';
import {api} from '../api';
interface PreviewState {key:string;snippets:Record<string,string>;loading:boolean;error:string}
export function useSearchSnippets(vaultId:string,query:string,pageIds:string[]):Omit<PreviewState,'key'> {
  const ids=JSON.stringify([...new Set(pageIds)].sort());
  const term=query.trim(),key=JSON.stringify([vaultId,term,ids]);
  const [state,setState]=useState<PreviewState>({key:'',snippets:{},loading:false,error:''});
  useEffect(()=>{
    const controller=new AbortController(),values=JSON.parse(ids) as string[];
    setState({key,snippets:{},loading:!!term&&values.length>0,error:''});
    if(!term||!values.length)return()=>controller.abort();
    // Batch local excerpts. These requests never call an AI provider.
    const timer=setTimeout(()=>{
      void (async()=>{
        for(let offset=0;offset<values.length;offset+=100){
          const result=await api.searchSnippets(vaultId,term,values.slice(offset,offset+100),controller.signal);
          if(controller.signal.aborted)return;
          setState(current=>current.key===key?{...current,snippets:{...current.snippets,...result.snippets}}:current);
        }
        if(!controller.signal.aborted)setState(current=>current.key===key?{...current,loading:false}:current);
      })().catch(()=>{if(!controller.signal.aborted)setState(current=>current.key===key?{...current,loading:false,error:'Some note previews are unavailable. You can still open the results.'}:current);});
    },150);
    return()=>{clearTimeout(timer);controller.abort();};
  },[key,vaultId,term,ids]);
  return state.key===key?state:{snippets:{},loading:!!term&&pageIds.length>0,error:''};
}
