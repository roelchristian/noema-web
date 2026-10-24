import type {ReactNode} from 'react';
export type NoticeTone='neutral'|'info'|'success'|'warning'|'error';
export type NotificationScope={kind:'global'}|{kind:'vault';vaultId:string};
export type DismissReason='dismissed'|'expired'|'action'|'scope'|'cleared';
export interface NotificationAction {label:string;run:()=>void|Promise<void>;dismissOnSuccess?:boolean;kind?:'primary'|'secondary'}
export interface ToastInput {id?:string;tone:NoticeTone;message:string;description?:string;scope:NotificationScope;dedupeKey?:string;durationMs?:number|null;priority?:'routine'|'important';actions?:NotificationAction[];onDismiss?:()=>void}
export interface ToastRecord extends ToastInput {id:string;occurrenceId:string;createdAt:number;revision:number;durationMs:number|null;priority:'routine'|'important';remainingMs:number|null;deadline:number|null;pendingAction:boolean;actionError?:string;overflowCount?:number;status:'active'}
export interface InlineNoticeProps {id?:string;tone:NoticeTone;title:ReactNode;description?:ReactNode;actions?:ReactNode;variant?:'standard'|'compact';dismissible?:boolean;onDismiss?:()=>void;announcement?:'polite'|'assertive'|'off';className?:string}
export interface ProgressNoticeProps {id?:string;title:string;stage?:string;detail?:ReactNode;state:'queued'|'running'|'completed'|'failed'|'interrupted';value?:number;max?:number;retryAction?:ReactNode;progressLabel?:string;compact?:boolean;className?:string}
export interface NotificationCommands {setActiveVault:(id:string|null)=>void;notify:(input:ToastInput)=>string;update:(id:string,patch:Partial<ToastInput>)=>void;dismiss:(id:string,reason?:DismissReason)=>void;dismissScope:(scope:NotificationScope)=>void;clearTransient:()=>void}
