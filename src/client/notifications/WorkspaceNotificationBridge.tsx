import {useEffect,useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import {t} from '../i18n';
import type {Workspace} from '../state/workspace';
import {useNotifications} from './NotificationProvider';

/** Adapts workspace occurrences; authoritative recovery state never lives in this store. */
export function WorkspaceNotificationBridge({workspace}:{workspace:Workspace}) {
 const state=useSyncExternalStore(workspace.subscribe,workspace.snapshot);
 const commands=useNotifications();
 const active=state.vault&&!state.vault.locked?state.vault.id:null;
 const errorSeen=useRef(0),archiveSeen=useRef('');
 const archiveToast=useRef<string|null>(null);
 useLayoutEffect(()=>commands.setActiveVault(active),[active,commands]);
 useEffect(()=>{
  if(!state.error||errorSeen.current===state.errorOccurrence)return;
  errorSeen.current=state.errorOccurrence;
  const occurrence=state.errorOccurrence;
  commands.notify({tone:'error',message:state.error,priority:'important',durationMs:null,
   scope:active?{kind:'vault',vaultId:active}:{kind:'global'},
   onDismiss:()=>{if(workspace.snapshot().errorOccurrence===occurrence)workspace.dismissError();}});
 },[state.error,state.errorOccurrence,active,commands,workspace]);
 useEffect(()=>{
  const operation=state.archiveUndoOccurrence,key=active+':'+operation;
  if(!active||!state.archiveUndo.length) {
   if(archiveToast.current)commands.dismiss(archiveToast.current,'scope');
   archiveToast.current=null;return;
  }
  if(archiveSeen.current===key)return;
  archiveSeen.current=key;
  if(archiveToast.current)commands.dismiss(archiveToast.current,'scope');
  const vaultId=active;
  archiveToast.current=commands.notify({tone:'success',scope:{kind:'vault',vaultId},dedupeKey:'archive:'+vaultId,
   message:state.archiveUndo.length===1?t('Page archived.'):t('{count} pages archived.',{count:state.archiveUndo.length}),durationMs:6000,
   actions:[{label:t('Undo'),run:async()=>{
    const current=workspace.snapshot();
    if(current.vault?.id!==vaultId||current.vault.locked||current.archiveUndoOccurrence!==operation)return;
    await workspace.restoreArchivedPages(current.archiveUndo,{vaultId,operation});
   }}],onDismiss:()=>workspace.dismissArchiveUndo(operation)});
 },[active,state.archiveUndo,state.archiveUndoOccurrence,commands,workspace]);
 return null;
}
