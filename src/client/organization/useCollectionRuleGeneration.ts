import {useEffect,useRef,useState} from 'react';
import {request} from '../api';
import type {SmartRuleDefinition} from '../../shared/smart-collections';

export interface GeneratedCollectionRules {rule:SmartRuleDefinition;warnings?:string[];requiresConfirmation?:boolean}
/** Suggestions are drafts. The caller must show them and explicitly apply them before saving. */
export function useCollectionRuleGeneration(vaultId:string,prompt:string,enabled:boolean) {
  const key=JSON.stringify([vaultId,prompt,enabled]);
  const current=useRef(key);current.current=key;
  const sequence=useRef(0),mounted=useRef(true),controller=useRef<AbortController|null>(null);
  const [state,setState]=useState<{key:string;loading:boolean;result?:GeneratedCollectionRules;error?:string}>({key:'',loading:false});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;controller.current?.abort();};},[]);
  useEffect(()=>{sequence.current++;controller.current?.abort();},[key]);
  async function generate() {
    if(!enabled||!prompt.trim())return;
    controller.current?.abort();const pending=new AbortController();controller.current=pending;
    const ticket=++sequence.current;setState({key,loading:true});
    try {
      const result=await request<GeneratedCollectionRules>('organization/generate-rules','POST',{description:prompt},vaultId,pending.signal);
      if(mounted.current&&current.current===key&&sequence.current===ticket)setState({key,loading:false,result});
    } catch(error) {
      if(mounted.current&&current.current===key&&sequence.current===ticket&&!pending.signal.aborted)setState({key,loading:false,error:error instanceof Error?error.message:'Could not generate rules.'});
    }
  }
  return {loading:enabled&&state.key===key&&state.loading,result:enabled&&state.key===key?state.result:undefined,error:enabled&&state.key===key?state.error:undefined,generate};
}
