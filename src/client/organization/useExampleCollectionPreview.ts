import {useEffect,useRef,useState} from 'react';
import {request} from '../api';

/** Examples only reuse saved page embeddings. Edits do not start evaluation automatically. */
export function useExampleCollectionPreview<T>(vaultId:string,examples:unknown,enabled:boolean,savedExamples?:unknown) {
  const serialized=JSON.stringify(examples),key=JSON.stringify([vaultId,serialized,enabled]);
  const saved=!!savedExamples&&JSON.stringify(savedExamples)===serialized;
  const current=useRef(key);current.current=key;
  const sequence=useRef(0),mounted=useRef(true),controller=useRef<AbortController|null>(null);
  const [state,setState]=useState<{key:string;vaultId:string;loading:boolean;result?:T;error?:string}>({key:'',vaultId:'',loading:false});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;controller.current?.abort();};},[]);
  useEffect(()=>{sequence.current++;controller.current?.abort();},[key]);
  async function evaluate() {
    if(!enabled)return;
    controller.current?.abort();const pending=new AbortController();controller.current=pending;
    const ticket=++sequence.current;setState({key,vaultId,loading:true});
    try {
      const result=await request<T>('organization/example-preview','POST',{examples:JSON.parse(serialized)},vaultId,pending.signal);
      if(mounted.current&&current.current===key&&sequence.current===ticket)setState({key,vaultId,loading:false,result});
    } catch(error) {
      if(mounted.current&&current.current===key&&sequence.current===ticket&&!pending.signal.aborted)setState({key,vaultId,loading:false,error:error instanceof Error?error.message:'Example matching unavailable.'});
    }
  }
  const evaluated=state.key===key&&!!state.result;
  useEffect(()=>{
    if(!enabled||(!saved&&!evaluated)||(state.key===key&&state.loading))return;
    const timer=setTimeout(()=>void evaluate(),evaluated?5000:400);
    return()=>clearTimeout(timer);
  },[key,saved,evaluated,state]);
  const matching=enabled&&state.key===key&&state.vaultId===vaultId;
  return {loading:matching&&state.loading,result:matching?state.result:undefined,error:matching?state.error:undefined,canSave:matching&&!!state.result&&!state.error,evaluate};
}
