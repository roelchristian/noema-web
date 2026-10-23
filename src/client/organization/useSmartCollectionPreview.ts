import {useEffect, useState} from 'react';
import {request} from '../api';

export function useSmartCollectionPreview<T>(vaultId:string, definition:unknown, enabled:boolean) {
  const key=JSON.stringify(definition);
  const [state,setState]=useState<{key:string;vaultId:string;loading:boolean;result?:T;error?:string}>({key:'',vaultId:'',loading:false});
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    const controller=new AbortController();
    setState({key,vaultId,loading:true});
    const timer=setTimeout(()=>{
      void request<T>('organization/smart-preview','POST',{rule:JSON.parse(key)},vaultId,controller.signal).then(result=>{
        if(active)setState({key,vaultId,loading:false,result});
      }).catch(error=>{if(active&&!controller.signal.aborted)setState({key,vaultId,loading:false,error:error instanceof Error?error.message:'Preview unavailable.'});});
    },400);
    return ()=>{active=false;clearTimeout(timer);controller.abort();};
  },[vaultId,key,enabled]);
  return enabled&&state.vaultId===vaultId&&state.key===key?state:{key,vaultId,loading:enabled};
}
