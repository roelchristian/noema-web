import type {AIActivityLog} from '../modules/ai-activity.js';
import type {ServerResponse} from 'node:http';
import type {BibliographicMetadata} from '../modules/bibliographic-metadata.js';
import {HttpError} from '../validation.js';
interface Context {activity:AIActivityLog;vault:string;id?:string;action?:string;method:string;body:Record<string,unknown>;res:ServerResponse;send:(status:number,data:unknown)=>void}
export async function bibliographyRoutes(service:BibliographicMetadata,{activity,vault,id,action,method,body,res,send}:Context) {
 if(!id&&method==='GET')return send(200,service.list(vault));
 if(id==='preview'&&method==='POST')return send(200,service.preview(vault,body.raw));
 if(id==='import'&&method==='POST')return send(200,service.import(vault,body));
 if(id==='export'&&method==='GET')return send(200,service.export(vault));
 if(id&&!action&&method==='GET')return send(200,service.get(vault,id));
 if(id&&!action&&method==='PUT')return send(200,service.save(vault,id,body));
 if(id&&action==='verify'&&method==='POST') {
 service.get(vault,id);
 const activityId=body.consent===true?activity.start('bibliographic_lookup',{model:'Crossref / DataCite (metadata)',reasoningEffort:'none'},vault,id,'entity'):undefined;
 const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
 try{const result=await service.verify(vault,id,body,controller.signal);if(activityId)activity.finish(activityId,'completed',200);return send(200,result);}
 catch(error){if(activityId)activity.finish(activityId,controller.signal.aborted?'interrupted':'failed',error instanceof HttpError?error.status:502);if(controller.signal.aborted)return;throw error;}
 finally{res.removeListener('close',abort);}
 }
 if(id&&action==='reconcile-preview'&&method==='POST')return send(200,service.reconcilePreview(vault,id,body));
 if(id&&action==='accept-verification'&&method==='POST')return send(200,service.acceptVerification(vault,id,body));
 if(id&&action==='pdf-candidates'&&method==='GET')return send(200,service.pdfCandidates(vault,id));
 if(id&&action==='attach'&&method==='POST')return send(200,service.attach(vault,id,body));
 throw new HttpError(404,'Not found');
}
