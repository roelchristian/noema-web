import {useEffect,useState} from 'react';
import {api} from '../api';
import {SemanticSearch,type SemanticSearchState} from './semantic-search';
export function useSemanticSearch(vault:string,query:string) {
  const [state,setState]=useState<SemanticSearchState>({vault:'',query:'',results:[],loading:false,error:''});
  const [search]=useState(()=>new SemanticSearch((vault,query,signal)=>api.semanticSearch(vault,query,signal,100),setState));
  useEffect(()=>{search.update(vault,query);return()=>search.cancel();},[search,vault,query]);
  return state.vault===vault&&state.query===query.trim()?state:{results:[],loading:!!query.trim(),error:''};
}
