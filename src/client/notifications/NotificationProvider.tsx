import {createContext,useContext,useLayoutEffect,useRef,type ReactNode} from 'react';
import {createNotificationStore,type NotificationStore} from './notification-store';
import {ToastViewport} from './ToastViewport';
import type {NotificationCommands} from './types';
const CommandsContext=createContext<NotificationCommands|null>(null);
export function useNotifications():NotificationCommands {const commands=useContext(CommandsContext);if(!commands)throw new Error('NotificationProvider is required');return commands;}
export function NotificationProvider({children,activeVaultId}:{children:ReactNode;activeVaultId?:string|null}) {
 const storeRef=useRef<NotificationStore|null>(null);if(!storeRef.current)storeRef.current=createNotificationStore();const store=storeRef.current;
 // Scope filtering happens in layout consumers as well as callbacks, before a later timer can run.
 useLayoutEffect(()=>{if(activeVaultId!==undefined)store.commands.setActiveVault(activeVaultId);},[activeVaultId,store]);
 useLayoutEffect(()=>{store.activate();return()=>store.destroy();},[store]);
 return <CommandsContext.Provider value={store.commands}>{children}<ToastViewport store={store} activeVaultId={activeVaultId}/></CommandsContext.Provider>;
}
