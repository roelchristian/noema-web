import { SourceFiles, maxSourceBytes } from './modules/source-files.js';
import { VaultBackups, maxBackupBytes } from './modules/vault-backups.js';
import { AINotifications } from './modules/ai-notifications.js';
import { Images, maxImageBytes } from './modules/images.js';
import {PageUtility} from './modules/page-utility.js';
import { EntityScans } from './modules/entity-scan.js';
import { EntityMatches } from './modules/entity-matches.js';
import { summaryInput } from './modules/summary-content.js';
import { AIEnrichments } from './modules/ai-enrichments.js';
import { AIActivityLog } from './modules/ai-activity.js';
import http, { type IncomingMessage } from 'node:http';
import type {Socket} from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Store } from './store.js';
import {VaultDeletion} from './modules/vault-deletion.js';
import { Vaults } from './modules/vaults.js';
import { Knowledge } from './modules/knowledge.js';
import { Organizer } from './modules/organization.js';
import { Intelligence, keychainFor, intelligencePreferencesFor } from './modules/intelligence.js';
import { Pages } from './modules/pages.js';
import { Embeddings } from './modules/embeddings.js';
import { SearchSnippets } from './modules/search-snippets.js';
import { HttpError, object } from './validation.js';
import {isLoopback, networkPeerAllowed, networkRequestError, readNetworkConfig, type NetworkConfig} from './network.js';
import {NetworkAccess, networkSettingsPath} from './network-settings.js';
async function readBody(req: IncomingMessage) {
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of req) {
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk as string);size+=buffer.length;
    if(size>2_000_000)throw new HttpError(413,'Request too large');chunks.push(buffer);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch(error) { if(error instanceof HttpError)throw error;throw new HttpError(400,'Invalid JSON'); }
}
export function createApp(store: Store, clientRoot: string, intelligence=new Intelligence(keychainFor(store),fetch,()=>Date.now(),intelligencePreferencesFor(store)), network: NetworkConfig=readNetworkConfig(), access?: NetworkAccess) {
  const database = store.all<{name: string; file: string}>('PRAGMA database_list').find(item => item.name === 'main')?.file;
  const networkAccess = access ?? new NetworkAccess(database ? networkSettingsPath(database) : undefined, network, network.lan ? network : undefined);
  const sockets = new Set<Socket>();
  const vaultDeletion=new VaultDeletion(store);
  const sourceFiles=new SourceFiles(store);
  sourceFiles.recover();
  const backups=new VaultBackups(store);
  const images=new Images(store),notifications=new AINotifications(store);
  const vaults=new Vaults(store),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),organizer=new Organizer(store);
  const activity=new AIActivityLog(store),enrichments=new AIEnrichments(store,pages);
  const scans=new EntityScans(store,pages,knowledge,enrichments);
  const pageUtility=new PageUtility(store,pages,knowledge,enrichments,intelligence);
  const entityMatches=new EntityMatches(store,pages,knowledge);
  const embeddings=new Embeddings(store,pages,knowledge,vaults,intelligence,activity);
  const searchSnippets=new SearchSnippets(pages,knowledge,vaults);
  // Enforce retention on startup, periodically while running, and before scoped API access.
  pages.purgeExpired();
  images.cleanup();
  let sourceWorker: ReturnType<typeof setInterval> | undefined;
  let cleanup: ReturnType<typeof setInterval> | undefined;
  let keyCleanup: ReturnType<typeof setInterval> | undefined;
  let embeddingWorker: ReturnType<typeof setInterval> | undefined;
  const server = http.createServer(async(req,res)=>{
    let activityId: string | undefined;
    const send=(status:number,data:unknown)=>{if(activityId){activity.finish(activityId,status<400?'completed':'failed',status);activityId=undefined;}res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url || '/', 'http://localhost'),method=req.method || 'GET';
      // LAN mode expands the peer/host allowlist without weakening same-origin API checks.
      const accessError=networkRequestError(req,networkAccess.config());
      if(accessError)throw new HttpError(403,accessError);
      if(url.pathname.startsWith('/api/')) {
        if((req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Cross-origin requests are not allowed');
        const securityRoute = url.pathname === '/api/security/network' || /^\/api\/vaults\/[^/]+\/passphrase$/.test(url.pathname);
        if (securityRoute && (req.headers['x-noema-request'] !== '1' || method === 'PUT' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))) throw new HttpError(403, 'Security settings require the Noema client and JSON.');
        const aiRoute=url.pathname==='/api/search/snippets'||url.pathname==='/api/intelligence'||url.pathname.startsWith('/api/intelligence/')||url.pathname==='/api/embeddings'||url.pathname.startsWith('/api/embeddings/')||/^\/api\/pages\/[^/]+\/(summary|title|entity-scan|entity-review|explain)$/.test(url.pathname);
        if(aiRoute && (req.headers['x-noema-request']!=='1'||(['POST','PUT'].includes(method)&&!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))))throw new HttpError(403,'AI requests require the Noema client and JSON');
        if(url.pathname==='/api/source-files' || url.pathname.startsWith('/api/source-files/')) {
          if(req.headers['x-noema-request']!=='1' && method!=='GET')throw new HttpError(403,'Source actions require the Noema client');
          const header=req.headers['x-vault-id'];if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          const vault=vaults.requireOpen(header || (method==='GET'?url.searchParams.get('vault'):null) || 'default');
          const parts=url.pathname.split('/').filter(Boolean),id=parts[2];
          if(!id && parts.length===2 && method==='POST') {
            const chunks:Buffer[]=[];let size=0;
            for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>maxSourceBytes)throw new HttpError(413,'Source files must be 50 MB or smaller');chunks.push(bytes);}
            vaults.requireOpen(vault);
            return send(201,sourceFiles.add(vault,url.searchParams.get('name')||'',Buffer.concat(chunks),url.searchParams.get('entity')||undefined));
          }
          if(id && parts.length===3 && method==='GET')return send(200,sourceFiles.require(vault,id));
          if(id && parts.length===3 && method==='DELETE')return send(200,sourceFiles.remove(vault,id));
          if(id && parts.length===4 && parts[3]==='retry' && method==='POST')return send(200,sourceFiles.retry(vault,id));
          if(id && parts.length===4 && parts[3]==='download' && method==='GET') {
            const file=sourceFiles.require(vault,id),bytes=readFileSync(sourceFiles.filename(vault,id));
            const filename=encodeURIComponent(file.name).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
            res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="source.${id.split('.').at(-1)}"; filename*=UTF-8''${filename}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
            return res.end(bytes);
          }
          throw new HttpError(404,'Not found');
        }
        if(url.pathname === '/api/images' && method === 'POST' || url.pathname.startsWith('/api/images/') && method === 'GET') {
          const header=req.headers['x-vault-id'];
          if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          const vault=vaults.requireOpen(header || (method === 'GET' ? url.searchParams.get('vault') : null) || 'default');
          if(method === 'POST') {
            if(req.headers['x-noema-request'] !== '1')throw new HttpError(403,'Image uploads require the Noema client');
            const chunks: Buffer[]=[]; let size=0;
            for await(const chunk of req) {const bytes=Buffer.from(chunk); size+=bytes.length; if(size>maxImageBytes)throw new HttpError(413,'Images must be 20 MB or smaller'); chunks.push(bytes);}
            vaults.requireOpen(vault);
            return send(201,images.add(vault,Buffer.concat(chunks)));
          }
          const image=images.get(vault,url.pathname.slice('/api/images/'.length));
          res.writeHead(200,{'Content-Type':image.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
          return res.end(image.bytes);
        }
        if(url.pathname==='/api/vaults/import' && method==='POST' || /^\/api\/vaults\/[^/]+\/backup$/.test(url.pathname) && method==='GET') {
          if(req.headers['x-noema-request']!=='1')throw new HttpError(403,'Vault backups require the Noema client');
          if(method==='POST') {
            if(!/^application\/(octet-stream|x-noema-backup)(?:;|$)/i.test(req.headers['content-type']||''))throw new HttpError(415,'Upload a .noemabkp backup file.');
            const chunks:Buffer[]=[];let size=0;
            for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>maxBackupBytes)throw new HttpError(413,'Backups must be 128 MB or smaller.');chunks.push(bytes);}
            return send(201,await backups.import(Buffer.concat(chunks),url.searchParams.get('name')??undefined));
          }
          const vault=url.pathname.split('/')[3]!;
          vaults.requireOpen(vault);pages.purgeExpired(vault);
          const backup=await backups.export(vault);
          const filename=encodeURIComponent(backup.filename).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
          res.writeHead(200,{'Content-Type':'application/x-noema-backup','Content-Disposition':`attachment; filename="vault.noemabkp"; filename*=UTF-8''${filename}`,'Content-Length':backup.bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
          return res.end(backup.bytes);
        }
        if(/^\/api\/vaults\/[^/]+\/delete$/.test(url.pathname)&&method==='POST'&&(req.headers['x-noema-request']!=='1'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')))throw new HttpError(403,'Vault deletion requires the Noema client and JSON confirmation.');
        const body=['POST','PUT'].includes(method)?await readBody(req):{};
        const parts=url.pathname.split('/').filter(Boolean),[,collection,id,child,childId]=parts;
        if (collection === 'security' && id === 'network' && parts.length === 3) {
          if (method !== 'GET' && method !== 'PUT') throw new HttpError(405, 'Method not allowed');
          if (method === 'PUT') {
            networkAccess.save(body.lan);
            if (!networkAccess.enabled()) res.once('finish', () => {
              for (const socket of sockets) if (!isLoopback(socket.remoteAddress || '')) {
                if (socket === req.socket) socket.end(); else socket.destroy();
              }
            });
          }
          const port = new URL(`http://${req.headers.host}`).port;
          return send(200, {lan: networkAccess.enabled(), localUrl: `http://localhost${port ? ':' + port : ''}`});
        }
        if(method==='POST' && ((collection==='intelligence' && id==='validate' && parts.length===3) || (collection==='pages' && (child==='summary'||child==='title'||child==='entity-scan'||child==='explain') && parts.length===4))) {
          const header=req.headers['x-vault-id'];
          if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          activityId=activity.start(collection==='pages'?(child==='title'?'page_title':child==='entity-scan'?'entity_scan':child==='explain'?'block_explanation':'page_summary'):'connection_test',child==='title'?intelligence.titleSelection():intelligence.selection(),collection==='pages'?(header||'default'):null,collection==='pages'?id!:null);
        }
        if(collection==='intelligence') {
          if(parts.length===3 && id==='notifications' && method==='GET')return send(200,notifications.list());
          if(parts.length===3 && id==='notifications' && method==='PUT')return send(200,notifications.read(body));
          if(parts.length===3 && id==='debug' && method==='GET')return send(200,activity.debugSettings());
          if(parts.length===3 && id==='debug' && method==='PUT')return send(200,activity.saveDebugSettings(body));
          if(parts.length===4 && id==='activity' && child && method==='GET')return send(200,activity.debug(child));
          if(parts.length===3 && id==='activity' && method==='DELETE')return send(200,activity.clear());
          if(parts.length===3 && id==='activity' && method==='GET')return send(200,activity.list(url.searchParams.get('before')));
          if(parts.length===2 && method==='GET')return send(200,intelligence.status());
          if(parts.length===3 && id==='preferences' && method==='PUT')return send(200,intelligence.savePreferences(body));
          if(parts.length===2 && method==='PUT')return send(200,intelligence.save(body));
          if(parts.length===2 && method==='DELETE')return send(200,intelligence.remove());
          if(parts.length===3 && id==='validate' && method==='POST') {await intelligence.generate('',true,bytes=>activity.request(activityId!,bytes,null));return send(200,{ok:true,...intelligence.selection()});}
          throw new HttpError(404,'Not found');
        } else if(collection==='vaults') {
          if(id && parts.length===4 && method==='PUT' && child==='passphrase')return send(200,vaults.setPassphrase(id,body));
          if(parts.length===2 && method==='GET')return send(200,vaults.list());
          if(parts.length===2 && method==='POST')return send(201,vaults.create(body));
          if(id && parts.length===4 && method==='GET' && child==='deletion-preview')return send(200,vaultDeletion.preview(id));
          if(id && parts.length===4 && method==='POST' && child==='delete')return send(200,vaultDeletion.remove(id,body));
          if(id && parts.length===4 && method==='POST' && child==='lock')return send(200,vaults.lock(id,body));
          if(id && parts.length===4 && method==='POST' && child==='unlock')return send(200,vaults.unlock(id,body));
        } else {
          const header=req.headers['x-vault-id'];
          if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          const vault=vaults.requireOpen(header || 'default');
          pages.purgeExpired(vault);
          if(collection==='search' && parts.length===3 && id==='snippets' && method==='POST')return send(200,searchSnippets.get(vault,body));
          if(collection==='embeddings') {
            if(parts.length===2 && method==='GET')return send(200,embeddings.status(vault));
            if(parts.length===3 && id==='settings' && method==='PUT')return send(200,embeddings.saveSettings(vault,body));
            if(parts.length===3 && id==='enqueue' && method==='POST')return send(200,embeddings.enqueueExisting(vault,body));
            if(parts.length===5 && id==='jobs' && child && childId==='retry' && method==='POST')return send(200,embeddings.retry(vault,child));
            if(parts.length===3 && id==='search' && method==='POST')return send(200,await embeddings.search(vault,body));
          }
          if(collection==='entity-schema') {
            if(parts.length===2 && method==='GET')return send(200,knowledge.schema(vault));
            if(parts.length===3 && method==='POST' && id==='subtypes')return send(201,knowledge.addSubtype(vault,body));
            if(parts.length===3 && method==='POST' && id==='properties')return send(201,knowledge.addTypeProperty(vault,body));
          }
          if(collection==='trash') {
            if(parts.length===2 && method==='GET')return send(200,pages.trash(vault));
            if(id && parts.length===4 && child==='restore' && method==='POST'){const page=pages.restore(vault,id);embeddings.onSave(vault,id);return send(200,page);}
            if(id && parts.length===3 && method==='DELETE')return send(200,pages.permanentlyDelete(vault,id));
          }
          if(collection==='organization') {
            if(parts.length===2 && method==='GET')return send(200,organizer.list(vault));
            if((id==='collections'||id==='folders') && (parts.length===3 || parts.length===4)) {
              if(method==='POST' && !child)return send(201,id==='collections'?organizer.saveCollection(vault,body):organizer.saveFolder(vault,body));
              if(method==='PUT' && child)return send(200,id==='collections'?organizer.saveCollection(vault,body,child):organizer.saveFolder(vault,body,child));
              if(method==='DELETE' && child)return send(200,organizer.remove(vault,id,child));
            }
            if(parts.length===3 && method==='PUT' && id==='memberships')return send(200,organizer.membership(vault,body));
            if(parts.length===3 && method==='PUT' && id==='locations')return send(200,organizer.locate(vault,body));
            if(parts.length===3 && method==='PUT' && id==='favourites')return send(200,organizer.favourite(vault,body));
          }
          if(collection==='pages') {
            if(id && parts.length===4 && child==='backlinks' && method==='GET')return send(200,pages.backlinks(vault,id));
            if(id && parts.length===4 && child==='explain' && method==='POST') {
              const page=pages.get(vault,id);
              // Draft blocks allow explaining current edits without saving or sending other note content.
              const blocks=pages.validateBlocks(vault,body.blocks);
              const input=summaryInput({title:'',blocks},entityId=>knowledge.find(vault,entityId)?.name,false,true).trim();
              if(!input)throw new HttpError(400,'Select blocks containing text or equations to explain.');
              if(Buffer.byteLength(input,'utf8')>24000)throw new HttpError(400,'Select fewer blocks (at most 24,000 bytes of text).');
              const markdown=await intelligence.generate(input,false,bytes=>activity.request(activityId!,bytes,page.revision),false,false,true);
              vaults.requireOpen(vault);pages.get(vault,id);
              notifications.record(vault,id,'block_explanation');
              return send(200,{markdown});
            }
            if(id && parts.length===4 && child==='entity-review' && method==='POST') {
              const result=scans.review(vault,id,body);
              if(body.decision==='accepted')embeddings.onSave(vault,id);
              return send(200,result);
            }
            if(id && parts.length===4 && child==='entity-scan' && method==='POST') {
              const page=pages.get(vault,id);
              if(body.revision!==page.revision)throw new HttpError(409,'Save the latest note before scanning.');
              await pageUtility.run(vault,page);
              vaults.requireOpen(vault);
              const classified=pages.get(vault,id);
              if(classified.revision!==page.revision)throw new HttpError(409,'The note changed while classifying it. Scan again after saving.');
              const input=scans.input(vault,classified);
              const output=await intelligence.generate(input,false,bytes=>activity.request(activityId!,bytes,page.revision),false,true);
              vaults.requireOpen(vault);
              return send(200,scans.save(vault,classified,output,intelligence.selection()));
            }
            if(id && parts.length===4 && child==='summary' && method==='DELETE')return send(200,enrichments.removeSummary(vault,id));
            if(id && parts.length===4 && child==='enrichments' && method==='GET')return send(200,enrichments.list(vault,id));
            if(id && parts.length===4 && (child==='summary'||child==='title') && method==='POST') {
              const page=pages.get(vault,id),isTitle=child==='title';
              if(isTitle) {
                if(body.revision!==page.revision)throw new HttpError(409,'Save the latest page before classification.');
                const result=await pageUtility.run(vault,page,bytes=>activity.request(activityId!,bytes,page.revision));
                vaults.requireOpen(vault);return send(200,result);
              }
              if(body.revision!==page.revision)throw new HttpError(409,'Save the latest page before summarizing.');
              const names=new Map(knowledge.list(vault).map(entity=>[entity.id,entity.name]));
              const input=summaryInput(page,id=>names.get(id));
              if(input.length>40000)throw new HttpError(413,'This page exceeds the AI limit of 40,000 characters.');
              if(!input.trim())throw new HttpError(400,'Add some page content first.');
              const onRequest=(bytes: number)=>activity.request(activityId!,bytes,page.revision);
              const summary=await intelligence.generate(input,false,onRequest);
              vaults.requireOpen(vault);
              const current=pages.get(vault,id);
              if(current.revision!==page.revision || current.summaryContentHash!==page.summaryContentHash)throw new HttpError(409,'The page changed. Generate a fresh summary.');
              const selection=intelligence.selection();
              const data={summary};
              enrichments.save(vault,id,'summary',data,page.revision,selection);
              return send(200,{...data,revision:page.revision,...selection,contentHash:page.summaryContentHash});
            }
            if(id && child==='editor' && parts.length===4 && method==='GET') {
              const page=pages.get(vault,id);
              return send(200,{...page,entityMatchCache:entityMatches.get(vault,id,page.revision)});
            }
            if(id && child==='entity-matches' && parts.length===4) {
              if(method==='GET') {
                const revision = url.searchParams.has('revision') ? Number(url.searchParams.get('revision')) : undefined;
                if(revision !== undefined && (!Number.isInteger(revision) || revision < 1)) throw new HttpError(400,'Invalid page revision.');
                return send(200,entityMatches.get(vault,id,revision));
              }
              if(method==='POST') return send(200,entityMatches.resolve(vault,id,body));
            }
            if(parts.length===2 && method==='GET')return send(200,pages.list(vault));
            if(parts.length===2 && method==='POST'){const page=pages.create(vault,body);embeddings.onSave(vault,page.id);return send(201,page);}
            if(id && parts.length===3) {
              if(method==='GET')return send(200,pages.get(vault,id));
              if(method==='PUT'){const page=pages.update(vault,id,body);embeddings.onSave(vault,id);return send(200,page);}
              if(method==='DELETE'){const result=pages.delete(vault,id);embeddings.invalidate(vault,id);return send(200,result);}
            }
          }
          if(collection==='entities') {
            if(id && child==='aliases' && parts.length===4 && method==='POST')return send(200,knowledge.addAlias(vault,id,body));
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
      res.writeHead(200,{'Content-Type':mime[path.extname(filename)]!,'X-Content-Type-Options':'nosniff','Cache-Control':relative.startsWith('assets/')?'public, max-age=31536000, immutable':'no-cache','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; frame-ancestors 'none'"});
      res.end(method==='HEAD'?undefined:content);
    }catch(error){
      if(error instanceof HttpError)return send(error.status,{error:error.message});
      console.error(error);send(500,{error:'An unexpected error occurred'});
    }
  });
  server.on('connection', socket => {
    if (!networkPeerAllowed(socket.remoteAddress || '', networkAccess.config(), socket.localAddress)) { socket.destroy(); return; }
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
  server.on('listening', () => {
    vaultDeletion.cleanup();
    sourceWorker=setInterval(()=>{void sourceFiles.tick().catch(()=>{});},500);sourceWorker.unref();
    cleanup = setInterval(() => { try { pages.purgeExpired(); images.cleanup(); sourceFiles.cleanup(); vaultDeletion.cleanup(); } catch (error) { console.error('Trash cleanup failed',error); } },60 * 60 * 1000);
    cleanup.unref();
    keyCleanup=setInterval(()=>{try{intelligence.purgeExpired();}catch{/* Keychain may be locked; all AI access still fails closed. */}},60000);keyCleanup.unref();
    embeddingWorker=setInterval(()=>{void embeddings.tick().catch(()=>{/* Durable job history records failures; never log note content. */});},1000);embeddingWorker.unref();
  });
  server.on('close', () => {clearInterval(sourceWorker);sourceFiles.close();clearInterval(cleanup);clearInterval(keyCleanup);clearInterval(embeddingWorker);embeddings.close();});
  return server;
}
