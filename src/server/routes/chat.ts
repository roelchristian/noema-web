import type {ServerResponse} from 'node:http';
import type {Chat} from '../modules/chat.js';
import {HttpError} from '../validation.js';
interface Context {vault:string;path:string[];method:string;body:Record<string,unknown>;res:ServerResponse;send:(status:number,data:unknown)=>void}
/** Endpoint ownership is deliberately confined to conversation storage and answering. */
export async function chatRoutes(chat:Chat,{vault,path,method,body,res,send}:Context) {
 const [resource,id,action]=path;
 if(action)throw new HttpError(404,'Chat endpoint not found.');
 if(resource==='threads') {
  if(!id&&method==='GET')return send(200,chat.storage.list(vault));
  if(!id&&method==='POST')return send(201,chat.storage.create(vault,chat.scope(vault,body.scope),typeof body.title==='string'?body.title:undefined));
  if(id&&method==='GET')return send(200,chat.thread(vault,id));
  if(id&&method==='PUT')return send(200,chat.storage.rename(vault,id,body.title));
  if(id&&method==='DELETE'){return send(200,chat.storage.remove(vault,id));}
 }
 if(resource==='evidence'&&!id&&method==='POST')return send(200,chat.evidence(vault,body.evidence));
 if(resource==='cancel'&&!id&&method==='POST')return send(200,chat.cancel(vault,body.requestId));
 if(resource==='messages'&&!id&&method==='POST') {
  const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
  const event=(data:unknown)=>{if(!controller.signal.aborted&&!res.writableEnded)res.write(`data: ${JSON.stringify(data)}\n\n`);};
  const startStream=()=>{if(!res.headersSent)res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Accel-Buffering':'no'});};
  try {
   // Thread identity precedes retrieval so refresh can reopen even the first pending turn.
   const result=await chat.submit(vault,body,{signal:controller.signal,onThread:threadId=>{startStream();event({type:'thread',threadId});},onEvidence:(evidence,threadId)=>{
    startStream();event({type:'evidence',evidence,threadId});
   },onClaim:claim=>event({type:'claim',claim})});
   event({type:'answer',result});res.end();
  } catch(error) {
   if(controller.signal.aborted)return;
   if(!res.headersSent)throw error;
   event({type:'error',message:error instanceof HttpError?error.message:'Chat could not complete this request.'});res.end();
  } finally {res.removeListener('close',abort);}
  return;
 }
 throw new HttpError(404,'Chat endpoint not found.');
}
