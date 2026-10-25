import type {ChatMention,ChatScope} from '../../shared/chat';

export interface ChatSession {
 open:boolean;inboxCollapsed?:boolean;scope:ChatScope;threadId?:string;draft:string;mentions:ChatMention[];deep:boolean;
 scrollTop:number;followBottom:boolean;pending:boolean;
}
const key=(vaultId:string)=>'noema-chat-session:'+vaultId;
export function readChatSession(vaultId:string):ChatSession|null {
 try {
  const value=JSON.parse(window.sessionStorage.getItem(key(vaultId))??'null');
  if(!value||typeof value!=='object'||!value.scope||!['vault','page','source','entity','folder'].includes(value.scope.kind)||value.scope.kind!=='vault'&&(typeof value.scope.id!=='string'||!value.scope.id||value.scope.id.length>200))return null;
  if(value.threadId!==undefined&&(typeof value.threadId!=='string'||!value.threadId||value.threadId.length>100))return null;
  const mentions=Array.isArray(value.mentions)?value.mentions.filter((item:unknown):item is ChatMention=>!!item&&typeof item==='object'&&typeof (item as ChatMention).id==='string'&&(item as ChatMention).id.length<=100&&typeof (item as ChatMention).name==='string'&&(item as ChatMention).name.length<=200).slice(0,8):[];
  return {open:value.open===true,inboxCollapsed:value.inboxCollapsed===true,scope:value.scope,threadId:value.threadId,draft:typeof value.draft==='string'?value.draft.slice(0,2000):'',mentions,deep:value.deep===true,scrollTop:typeof value.scrollTop==='number'&&Number.isFinite(value.scrollTop)?Math.max(0,value.scrollTop):0,followBottom:value.followBottom!==false,pending:value.pending===true};
 }catch{return null;}
}
export function writeChatSession(vaultId:string,value:ChatSession) {
 try{window.sessionStorage.setItem(key(vaultId),JSON.stringify(value));}catch{/* Chat works even when browser storage is blocked. */}
}
export function clearChatSession(vaultId:string) {
 try{window.sessionStorage.removeItem(key(vaultId));}catch{/* Storage is optional. */}
}
