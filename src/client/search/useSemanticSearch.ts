import {useEffect,useState} from 'react';
import {api} from '../api';
import {SemanticSearch,type SemanticSearchState} from './semantic-search';
export function useSemanticSearch(vault:string,query:string,{enabled=true,delayMs=600}:{enabled?:boolean;delayMs?:number}={}) {
  const [state,setState]=useState<SemanticSearchState>({vault:'',query:'',results:[],loading:false,error:''});
  const [search]=useState(()=>new SemanticSearch((vault,query,signal)=>api.semanticSearch(vault,query,signal,100),setState));
  useEffect(()=>{
    if(enabled) search.update(vault,query,delayMs);
    else {search.cancel();setState(previous=>previous.loading?{...previous,loading:false}:previous);}
    return()=>search.cancel();
  },[search,vault,query,enabled,delayMs]);
  const current=state.vault===vault&&state.query===query.trim()?{...state,loading:enabled&&state.loading}:{results:[],loading:enabled&&!!query.trim(),error:''};
  // Cancel synchronously in interaction handlers, before a pending timer can fire.
  return {...current,cancel:()=>{search.cancel();setState(previous=>previous.loading?{...previous,loading:false}:previous);}};
}
