import type { SemanticSearchResults, SemanticSearchResult } from '../../shared/embeddings';
export interface SemanticSearchState {vault: string; query: string; results: SemanticSearchResult[]; loading: boolean; error: string}
/** Debounce provider calls and discard completions after edits, navigation or disposal. */
export class SemanticSearch {
  private version=0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  constructor(private search:(vault:string,query:string,signal:AbortSignal)=>Promise<SemanticSearchResults>,private publish:(state:SemanticSearchState)=>void) {}
  update(vault:string,query:string,delayMs=600) {
    this.cancel();const version=this.version;query=query.trim();
    const state={vault,query,results:[],loading:!!query,error:''};
    this.publish(state);
    if(!query)return;
    this.timer=setTimeout(()=>{
      const controller=new AbortController();this.controller=controller;
      void this.search(vault,query,controller.signal).then(response=>{
        if(version===this.version)this.publish({...state,results:response.results,loading:false});
      }).catch(error=>{
        if(version===this.version)this.publish({...state,loading:false,error:'Semantic search unavailable. Text matches are still shown. '+(error instanceof Error?error.message:'Try again later.')});
      });
    },delayMs);
  }
  cancel(){this.version++;clearTimeout(this.timer);this.controller?.abort();this.controller=undefined;}
}
