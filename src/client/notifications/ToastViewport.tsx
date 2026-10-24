import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {ToastItem} from './ToastItem';
import {sameScope,VISIBLE_TOASTS} from './notification-reducer';
import type {NotificationStore} from './notification-store';
export function ToastViewport({store,activeVaultId}:{store:NotificationStore;activeVaultId?:string|null}) {
 const records=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const previous=useRef<typeof records>([]);
 const [announcement,setAnnouncement]=useState({id:'',message:''});
 const visible=records.filter(record=>record.scope.kind==='global'||activeVaultId===undefined||record.scope.vaultId===activeVaultId).slice(0,VISIBLE_TOASTS);
 useEffect(()=>{const prior=previous.current;const speak=visible.filter(record=>!prior.some(old=>old.occurrenceId===record.occurrenceId||record.dedupeKey&&old.dedupeKey===record.dedupeKey&&sameScope(old.scope,record.scope)));previous.current=visible;if(speak.length)setAnnouncement({id:speak.map(record=>record.occurrenceId).join(','),message:speak.map(record=>record.message).join('. ')});else if(!visible.some(record=>announcement.id.split(',').includes(record.occurrenceId)))setAnnouncement(current=>current.message?{id:'',message:''}:current);},[records,activeVaultId]);
 useEffect(()=>{const change=()=>{for(const record of store.getSnapshot())store.pause(record.occurrenceId,'hidden',document.hidden);};change();document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change);},[store,records]);
 if(typeof document==='undefined')return null;
 return createPortal(<><div className="toast-viewport">{visible.map(record=><ToastItem key={record.occurrenceId} record={record} store={store}/>)}</div><div className="notice-announcer" role="status" aria-live="polite" aria-atomic="true"><span key={announcement.id}>{announcement.id.split(',').every(id=>visible.some(record=>record.occurrenceId===id))?announcement.message:''}</span></div></>,document.body);
}
