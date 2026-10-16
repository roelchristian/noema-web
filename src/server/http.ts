import http, { type IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from './store.js';
import { Vaults } from './modules/vaults.js';
import { Knowledge } from './modules/knowledge.js';
import { Organizer } from './modules/organization.js';
import { Pages } from './modules/pages.js';
import { HttpError, object } from './validation.js';
async function readBody(req: IncomingMessage) {
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of req) {
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk as string);size+=buffer.length;
    if(size>2_000_000)throw new HttpError(413,'Request too large');chunks.push(buffer);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch(error) { if(error instanceof HttpError)throw error;throw new HttpError(400,'Invalid JSON'); }
}
export function createApp(store: Store, clientRoot: string) {
  const vaults=new Vaults(store),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),organizer=new Organizer(store);
  return http.createServer(async(req,res)=>{
    const send=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url || '/', 'http://localhost'),method=req.method || 'GET';
      // The app binds to loopback. Reject DNS-rebinding hosts and cross-origin browser access.
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || ''))throw new HttpError(403,'Host is not allowed');
      if(url.pathname.startsWith('/api/')) {
        if((req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Cross-origin requests are not allowed');
        const body=['POST','PUT'].includes(method)?await readBody(req):{};
        const parts=url.pathname.split('/').filter(Boolean),[,collection,id,child,childId]=parts;
        if(collection==='vaults') {
          if(parts.length===2 && method==='GET')return send(200,vaults.list());
          if(parts.length===2 && method==='POST')return send(201,vaults.create(body));
          if(id && parts.length===4 && method==='POST' && child==='lock')return send(200,vaults.lock(id,body));
          if(id && parts.length===4 && method==='POST' && child==='unlock')return send(200,vaults.unlock(id,body));
        } else {
          const header=req.headers['x-vault-id'];
          if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          const vault=vaults.requireOpen(header || 'default');
          if(collection==='organization') {
            if(parts.length===2 && method==='GET')return send(200,organizer.list(vault));
            if((id==='collections'||id==='folders') && (parts.length===3 || parts.length===4)) {
              if(method==='POST' && !child)return send(201,id==='collections'?organizer.saveCollection(vault,body):organizer.saveFolder(vault,body));
              if(method==='PUT' && child)return send(200,id==='collections'?organizer.saveCollection(vault,body,child):organizer.saveFolder(vault,body,child));
              if(method==='DELETE' && child)return send(200,organizer.remove(vault,id,child));
            }
            if(parts.length===3 && method==='PUT' && id==='locations')return send(200,organizer.locate(vault,body));
            if(parts.length===3 && method==='PUT' && id==='favourites')return send(200,organizer.favourite(vault,body));
          }
          if(collection==='pages') {
            if(parts.length===2 && method==='GET')return send(200,pages.list(vault));
            if(parts.length===2 && method==='POST')return send(201,pages.create(vault,body));
            if(id && parts.length===3) {
              if(method==='GET')return send(200,pages.get(vault,id));
              if(method==='PUT')return send(200,pages.update(vault,id,body));
              if(method==='DELETE')return send(200,pages.delete(vault,id));
            }
          }
          if(collection==='entities') {
            if(parts.length===2 && method==='GET')return send(200,knowledge.list(vault));
            if(parts.length===2 && method==='POST')return send(201,knowledge.create(vault,body));
            if(id && parts.length===3) {
              if(method==='GET')return send(200,knowledge.detail(vault,id));
              if(method==='PUT')return send(200,knowledge.update(vault,id,body));
            }
            if(id && (child==='properties'||child==='relationships')) {
              if((parts.length===4 && method==='POST')||(parts.length===5 && method==='PUT' && childId))return send(method==='POST'?201:200,child==='properties'?knowledge.property(vault,id,body,childId):knowledge.relationship(vault,id,body,childId));
              if(parts.length===5 && childId && method==='DELETE')return send(200,knowledge.remove(vault,id,child,childId));
            }
          }
        }
        throw new HttpError(404,'Not found');
      }
      if(!['GET','HEAD'].includes(method))throw new HttpError(405,'Method not allowed');
      const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
      const filename=path.resolve(clientRoot,relative);
      if(!filename.startsWith(path.resolve(clientRoot)+path.sep))throw new HttpError(404,'Not found');
      const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
      if(!mime[path.extname(filename)])throw new HttpError(404,'Not found');
      let content:Buffer;
      try {content=readFileSync(filename);}catch{throw new HttpError(404,'Not found');}
      res.writeHead(200,{'Content-Type':mime[path.extname(filename)]!,'X-Content-Type-Options':'nosniff','Cache-Control':relative.startsWith('assets/')?'public, max-age=31536000, immutable':'no-cache','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"});
      res.end(method==='HEAD'?undefined:content);
    }catch(error){
      if(error instanceof HttpError)return send(error.status,{error:error.message});
      console.error(error);send(500,{error:'An unexpected error occurred'});
    }
  });
}
