import {request} from '../api';

/** Share only live requests. Completed values never outlive their access check.
 * Every consumer owns cancellation; the transport is cancelled when none remain. */
let accessEpoch=0;
type Entry={controller:AbortController;promise:Promise<unknown>;users:number};
const pending=new Map<string,Entry>();
export function resetSharedRequests(){accessEpoch++;for(const entry of pending.values())entry.controller.abort();pending.clear();}
export function sharedRequest<T>(vaultId:string,route:string,version:string,signal?:AbortSignal):Promise<T>{
 if(signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
 const epoch=accessEpoch,key=JSON.stringify([vaultId,epoch,version,route]);
 let entry=pending.get(key);
 if(!entry){
  const controller=new AbortController();
  entry={controller,users:0,promise:request<T>(route,'GET',undefined,vaultId,controller.signal)};
  pending.set(key,entry);
  const owned=entry;
  void entry.promise.finally(()=>{if(pending.get(key)===owned)pending.delete(key);}).catch(()=>{});
 }
 const owned=entry;owned.users++;
 return new Promise<T>((resolve,reject)=>{
  let finished=false;
  const finish=()=>{if(finished)return false;finished=true;signal?.removeEventListener('abort',abort);if(--owned.users===0){if(pending.get(key)===owned){owned.controller.abort();pending.delete(key);}}return true;};
  const abort=()=>{if(finish())reject(new DOMException('Aborted','AbortError'));};
  signal?.addEventListener('abort',abort,{once:true});
  owned.promise.then(value=>{if(!finish())return;if(epoch!==accessEpoch||owned.controller.signal.aborted)reject(new DOMException('Access changed','AbortError'));else resolve(value as T);},cause=>{if(finish())reject(cause);});
 });
}
