import {notificationReducer,sameScope,VISIBLE_TOASTS} from './notification-reducer';
import {defaultDuration,remainingDuration,systemNotificationClock,type NotificationClock} from './notification-timing';
import type {DismissReason,NotificationCommands,NotificationScope,ToastInput,ToastRecord} from './types';
let sequence=0;
export function createNotificationStore(clock:NotificationClock=systemNotificationClock) {
 let records:readonly ToastRecord[]=[],alive=true,activeVaultId:string|null|undefined;
 const listeners=new Set<()=>void>(),timers=new Map<string,ReturnType<typeof setTimeout>>(),starts=new Map<string,number>(),pauses=new Map<string,Set<string>>();
 const emit=()=>{records=[...records];for(const listener of listeners)listener();};
 const find=(id:string)=>records.find(record=>record.occurrenceId===id);
 function cancel(id:string){const timer=timers.get(id);if(timer!==undefined)clock.clearTimeout(timer);timers.delete(id);starts.delete(id);}
 function settle(){
  for(const id of [...timers.keys()])if(!records.slice(0,VISIBLE_TOASTS).some(record=>record.occurrenceId===id))cancel(id);
  for(const record of records.slice(0,VISIBLE_TOASTS)){
   const id=record.occurrenceId;
   if(record.remainingMs===null||record.pendingAction||pauses.get(id)?.size||timers.has(id)||typeof document!=='undefined'&&document.hidden)continue;
   starts.set(id,clock.now());record.deadline=clock.now()+record.remainingMs;
   timers.set(id,clock.setTimeout(()=>commands.dismiss(id,'expired'),record.remainingMs));
  }
 }
 function transition(next:readonly ToastRecord[]){if(!alive)return;records=next;settle();emit();}
 const commands:NotificationCommands={
 setActiveVault(id){activeVaultId=id;for(const record of [...records])if(record.scope.kind==='vault'&&record.scope.vaultId!==id)commands.dismiss(record.occurrenceId,'scope');},
 notify(input){const occurrenceId='notice-'+(++sequence),record:ToastRecord={...input,id:input.id??occurrenceId,occurrenceId,createdAt:clock.now(),revision:0,durationMs:input.durationMs===undefined?defaultDuration(input.tone):input.durationMs,remainingMs:input.durationMs===undefined?defaultDuration(input.tone):input.durationMs,deadline:null,priority:input.priority??'routine',actions:input.actions?.slice(0,2),pendingAction:false,status:'active'};if(input.scope.kind==='global'||activeVaultId===undefined||input.scope.vaultId===activeVaultId)transition(notificationReducer(records,{type:'enqueue',record}));return occurrenceId;},
 update(id,patch){const current=find(id);if(!current)return;const duration=patch.durationMs===undefined?current.durationMs:patch.durationMs;const remaining=patch.durationMs===undefined?remainingDuration(current.remainingMs,starts.get(id)??null,clock.now()):duration;cancel(id);transition(notificationReducer(records,{type:'replace',id,record:{...current,...patch,id:current.id,occurrenceId:id,revision:current.revision,durationMs:duration,remainingMs:remaining,deadline:null,actions:patch.actions?.slice(0,2)??current.actions,pendingAction:current.pendingAction,actionError:current.actionError}}));},
 dismiss(id,reason='dismissed'){const record=find(id);if(!record)return;cancel(id);pauses.delete(id);transition(notificationReducer(records,{type:'dismiss',id}));if(reason!=='scope'&&reason!=='cleared')record.onDismiss?.();},
 dismissScope(scope){for(const record of [...records])if(sameScope(record.scope,scope))commands.dismiss(record.occurrenceId,'scope');},
 clearTransient(){for(const record of [...records])if(record.durationMs!==null&&!record.pendingAction)commands.dismiss(record.occurrenceId,'cleared');}
 };
 return {commands,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>records,
 pause(id:string,reason:string,paused:boolean){const record=find(id);if(!record)return;const reasons=pauses.get(id)??new Set<string>();if(paused)reasons.add(reason);else reasons.delete(reason);pauses.set(id,reasons);if(reasons.size){const start=starts.get(id);record.remainingMs=remainingDuration(record.remainingMs,start??null,clock.now());record.deadline=null;cancel(id);}settle();},
 async runAction(id:string,index:number){const record=find(id),action=record?.actions?.[index];if(!record||!action||record.pendingAction)return;const revision=record.revision;
  const start=starts.get(id);record.remainingMs=remainingDuration(record.remainingMs,start??null,clock.now());cancel(id);record.pendingAction=true;record.actionError=undefined;emit();
  try{await action.run();if(!alive||!find(id)||find(id)!.revision!==revision)return;const latest=find(id)!;latest.pendingAction=false;if(action.dismissOnSuccess!==false)commands.dismiss(id,'action');else{settle();emit();}}
  catch(error){if(!alive||!find(id)||find(id)!.revision!==revision)return;const latest=find(id)!;latest.pendingAction=false;latest.actionError=error instanceof Error?error.message:String(error);latest.remainingMs=null;latest.deadline=null;emit();}
 },destroy(){alive=false;for(const id of [...timers.keys()])cancel(id);listeners.clear();},activate(){alive=true;settle();}};
}
export type NotificationStore=ReturnType<typeof createNotificationStore>;
