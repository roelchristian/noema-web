import {useEffect,useRef,useState} from 'react';
import {request} from '../api';
import type {SmartRuleDefinition} from '../../shared/smart-collections';

type Options={threshold?:number;minCoverage?:number;collectionId?:string;savedDescription?:string;rule?:SmartRuleDefinition};
/** Only evaluate() can generate a description embedding. Background previews reuse it. */
export function useSemanticCollectionPreview<T>(vaultId:string,description:string,enabled:boolean,options:Options={}) {
  const semantic={version:1,description,threshold:options.threshold??0.55,minCoverage:options.minCoverage??0.5};
  const serialized=JSON.stringify(semantic);
  const key=JSON.stringify([vaultId,serialized,options.rule,enabled]);
  const descriptionKey=JSON.stringify([vaultId,description]);
  const current=useRef(key);current.current=key;
  const controller=useRef<AbortController|null>(null);
  const sequence=useRef(0);
  const mounted=useRef(true);
  const [token,setToken]=useState<{key:string;value:string}|null>(null);
  const [state,setState]=useState<{key:string;vaultId:string;loading:boolean;result?:T;error?:string}>({key:'',vaultId:'',loading:false});
  const evaluationToken=token?.key===descriptionKey?token.value:undefined;
  const saved=!!options.collectionId&&options.savedDescription===description;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();sequence.current++;};},[]);
  useEffect(()=>{controller.current?.abort();sequence.current++;},[key]);
  // An unchanged saved description or evaluated draft can be previewed without any provider call.
  useEffect(()=>{
    if(!enabled||(!evaluationToken&&!saved))return;
    let active=true;let pending:AbortController|undefined;let timer:ReturnType<typeof setTimeout>;
    const refresh=()=>{
      const ticket=sequence.current;
      pending=new AbortController();
      void request<T>('organization/semantic-preview','POST',{semantic:JSON.parse(serialized),...(options.rule?{rule:options.rule}:{}),...(evaluationToken?{evaluationToken}:{collection_id:options.collectionId})},vaultId,pending.signal).then(result=>{
        if(active&&mounted.current&&current.current===key&&ticket===sequence.current)setState({key,vaultId,loading:false,result});
      }).catch(error=>{if(active&&mounted.current&&current.current===key&&ticket===sequence.current&&!pending?.signal.aborted)setState({key,vaultId,loading:false,error:error instanceof Error?error.message:'Semantic preview unavailable.'});}).finally(()=>{if(active)timer=setTimeout(refresh,5000);});
    };
    if(state.key!==key)setState({key,vaultId,loading:true});
    timer=setTimeout(refresh,state.key===key&&state.result?5000:400);
    return()=>{active=false;clearTimeout(timer);pending?.abort();};
  },[vaultId,key,serialized,enabled,evaluationToken,saved,options.collectionId]);
  async function evaluate() {
    if(!enabled||!description.trim())return;
    controller.current?.abort();const pending=new AbortController();controller.current=pending;
    const ticket=++sequence.current;
    setState({key,vaultId,loading:true});
    try {
      const response=await request<{evaluationToken:string;preview:T}>('organization/semantic-evaluate','POST',{semantic,...(options.rule?{rule:options.rule}:{})},vaultId,pending.signal);
      if(mounted.current&&current.current===key&&ticket===sequence.current){setToken({key:descriptionKey,value:response.evaluationToken});setState({key,vaultId,loading:false,result:response.preview});}
    } catch(error) {
      if(mounted.current&&current.current===key&&ticket===sequence.current&&!pending.signal.aborted)setState({key,vaultId,loading:false,error:error instanceof Error?error.message:'Semantic preview unavailable.'});
    }
  }
  const matching=enabled&&state.key===key&&state.vaultId===vaultId;
  return {loading:enabled&&(matching?state.loading:!!evaluationToken||saved),result:matching?state.result:undefined,error:matching?state.error:undefined,stale:enabled&&state.vaultId===vaultId&&!!state.result&&!matching,evaluationToken,canSave:!!evaluationToken||saved,evaluate};
}
