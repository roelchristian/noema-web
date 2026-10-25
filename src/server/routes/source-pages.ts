import type {ServerResponse} from 'node:http';
import type {Runtime} from '../runtime.js';
import type {SourcePageEvent} from '../../shared/source-page.js';
import {HttpError} from '../validation.js';

type Services=Pick<Runtime,'sourcePages'|'sourcePageGeneration'|'notifications'|'embeddings'|'vaults'>;
interface Context {vault:string; id:string; parts:string[]; childId:string|undefined; method:string; body:Record<string,unknown>; res:ServerResponse; send:(status:number,data:unknown)=>void}
export async function sourcePageRoutes(services:Services,{vault,id,parts,childId,method,body,res,send}:Context) {
  const {sourcePages,sourcePageGeneration,notifications,embeddings,vaults}=services;
  if(parts.length===4 && method==='GET')return send(200,{draft:sourcePages.latest(vault,id),...sourcePages.versions(vault,id)});
  if(parts.length===5 && method==='POST') {
    if(childId==='reject')return send(200,sourcePages.reject(vault,id,body.requestId));
    if(childId==='accept') {
      const result=sourcePages.accept(vault,id,body.requestId);
      if(result.created){notifications.record(vault,result.page.id,'create_page_from_source');try{embeddings.onSave(vault,result.page.id);}catch{/* The accepted page remains saved if indexing is unavailable. */}}
      return send(200,result.page);
    }
    throw new HttpError(404,'Not found');
  }
  if(parts.length===4 && method==='POST') {
    const prepared=sourcePageGeneration.prepare(vault,id,body);
    const controller=new AbortController();
    const disconnected=()=>{if(!res.writableEnded)controller.abort();};
    res.on('close',disconnected);
    const emit=(event:SourcePageEvent)=>{
      if(controller.signal.aborted||res.destroyed)throw new HttpError(499,'Page generation was stopped.');
      vaults.requireOpen(vault);
      res.write(JSON.stringify(event)+'\n');
    };
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Accel-Buffering':'no'});
    res.flushHeaders();
    let heartbeat:ReturnType<typeof setInterval>|undefined;
    try {
      await sourcePageGeneration.run({vault,id,prepared,signal:controller.signal,onEvent:emit,onGenerating:()=>{
        heartbeat=setInterval(()=>{if(!res.destroyed&&!controller.signal.aborted)res.write('\n');},10000);
      }});
      res.end();
    }catch(error){
      const interrupted=controller.signal.aborted;
      if(!res.destroyed){res.end(JSON.stringify({type:'error',message:interrupted?'Page generation stopped.':error instanceof HttpError?error.message:'Could not create the page. Please try again.'} satisfies SourcePageEvent)+'\n');}
    }finally{if(heartbeat)clearInterval(heartbeat);res.removeListener('close',disconnected);}
    return;
  }
  throw new HttpError(404,'Not found');
}
