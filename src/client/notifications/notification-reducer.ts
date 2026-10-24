import type {NotificationScope,ToastRecord} from './types';
export const VISIBLE_TOASTS=2;
export const MAX_TOASTS=34;
export const sameScope=(a:NotificationScope,b:NotificationScope)=>a.kind===b.kind&&(a.kind==='global'||b.kind==='vault'&&a.vaultId===b.vaultId);
export type NotificationTransition={type:'enqueue';record:ToastRecord}|{type:'replace';id:string;record:ToastRecord}|{type:'dismiss';id:string}|{type:'scope';scope:NotificationScope}|{type:'transient'};
/** Occurrence IDs are immutable; a dedupe replacement is a new occurrence in the old slot. */
export function notificationReducer(state:readonly ToastRecord[],action:NotificationTransition):readonly ToastRecord[] {
 switch(action.type){
 case 'enqueue': {
  const record=action.record,index=state.findIndex(item=>(record.dedupeKey&&record.dedupeKey===item.dedupeKey&&sameScope(record.scope,item.scope))||record.id===item.id);
  if(index>=0)return state.map((item,i)=>i===index?record:item);
  if(state.length<MAX_TOASTS){if(record.priority==='important'){const index=state.findIndex((item,index)=>index>=VISIBLE_TOASTS&&item.priority==='routine');if(index>=0)return [...state.slice(0,index),record,...state.slice(index)];}return [...state,record];}
  const discard=(()=>{for(let i=state.length-1;i>=VISIBLE_TOASTS;i--)if(state[i].priority==='routine'&&!state[i].pendingAction)return i;return -1;})();
  return discard<0?state:notificationReducer([...state.slice(0,discard),...state.slice(discard+1)],action);
 }
 case 'replace':return state.map(item=>item.occurrenceId===action.id?action.record:item);
 case 'dismiss':return state.filter(item=>item.occurrenceId!==action.id);
 case 'scope':return state.filter(item=>!sameScope(item.scope,action.scope));
 case 'transient':return state.filter(item=>item.durationMs===null||item.pendingAction);
 }
}
