import {request,ApiError} from '../api';
import type {ChatEvent,ChatSubmit,ChatThread,ChatEvidence} from '../../shared/chat';
export const chatAPI={
 verify:(vault:string,evidence:ChatEvidence[],signal?:AbortSignal)=>request<ChatEvidence[]>('chat/evidence','POST',{evidence},vault,signal),
 list:(vault:string,signal?:AbortSignal)=>request<ChatThread[]>('chat/threads','GET',undefined,vault,signal),
 get:(vault:string,id:string,signal?:AbortSignal)=>request<ChatThread>(`chat/threads/${encodeURIComponent(id)}`,'GET',undefined,vault,signal),
 rename:(vault:string,id:string,title:string)=>request<ChatThread>(`chat/threads/${encodeURIComponent(id)}`,'PUT',{title},vault),
 remove:(vault:string,id:string)=>request<{deleted:boolean}>(`chat/threads/${encodeURIComponent(id)}`,'DELETE',{},vault),
 cancel:(vault:string,requestId:string)=>request<{cancelled:boolean}>('chat/cancel','POST',{requestId},vault),
};
/** Incremental framing only: provider prose is never interpreted as a citation. */
export async function streamChat(vault:string,input:ChatSubmit,signal:AbortSignal,onEvent:(event:ChatEvent)=>void) {
 try {
 const response=await fetch('/api/chat/messages',{method:'POST',signal,headers:{'X-Noema-Request':'1','X-Vault-Id':vault,'Content-Type':'application/json'},body:JSON.stringify(input)});
 if(!response.ok){const error=await response.json();throw new ApiError(response.status,error.error||'Chat is unavailable.');}
 if(!response.body)throw new Error('Chat stream is unavailable.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',answered=false,claims=0;
 try {for(;;){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});if(buffer.length>1_000_000)throw new Error('Chat response is too large.');let boundary:number;while((boundary=buffer.search(/\r?\n\r?\n/))>=0){const packet=buffer.slice(0,boundary);const delimiter=/^\r?\n\r?\n/.exec(buffer.slice(boundary))![0];buffer=buffer.slice(boundary+delimiter.length);const data=packet.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)continue;const event=JSON.parse(data) as ChatEvent;if(event.type==='error')throw new Error(event.message);if(event.type==='answer')answered=true;if(event.type==='claim'&&++claims>12)throw new Error('Chat returned too many claims.');onEvent(event);}if(done)break;}
 if(!answered&&!signal.aborted)throw new Error('The answer was interrupted. Your question can be retried.');
 }finally{if(!answered)await reader.cancel().catch(()=>{});reader.releaseLock();}
 }finally{if(typeof window!=='undefined')window.dispatchEvent(new Event('noema:ai-activity'));}
}
