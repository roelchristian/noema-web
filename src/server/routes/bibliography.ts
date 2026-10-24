import type {ServerResponse} from 'node:http';
import type {Bibliography} from '../modules/bibliography.js';
import {HttpError} from '../validation.js';
interface Context {vault:string;id?:string;action?:string;method:string;body:Record<string,unknown>;res:ServerResponse;send:(status:number,data:unknown)=>void}
export async function bibliographyRoutes(service:Bibliography,{vault,id,action,method,body,res,send}:Context) {
 if(!id&&method==='GET')return send(200,service.list(vault));
 if(id==='preview'&&method==='POST')return send(200,service.preview(vault,body.raw));
 if(id==='import'&&method==='POST')return send(200,service.import(vault,body));
 if(id==='export'&&method==='GET')return send(200,service.export(vault));
 if(id&&!action&&method==='GET')return send(200,service.get(vault,id));
 if(id&&!action&&method==='PUT')return send(200,service.save(vault,id,body));
 throw new HttpError(404,'Not found');
}
