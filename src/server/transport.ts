import {bibliographyRoutes} from './routes/bibliography.js';
import {kokoroStatus,downloadKokoro} from './modules/kokoro-speech.js';
import {cleanSpeechText} from '../shared/speech-text.js';
import {speechCacheKey} from './modules/speech-cache.js';
import {speechModelFor,isSpeechVoice,isSpeechProvider} from '../shared/intelligence.js';
import {PageHistory} from './modules/page-history.js';
import {PropertyReview} from './modules/property-review.js';
import {PropertyDefinitionGovernance} from './modules/property-definition-governance.js';
import {EntityClassificationImpact} from './modules/entity-classification-impact.js';
import {ReviewCentre} from './modules/review-centre.js';
import { fetchRemoteImage } from './modules/remote-image.js';
import {vaultStorage} from './modules/vault-storage.js';
import type {NetworkAccess} from './network-settings.js';
import {sourcePageRoutes} from './routes/source-pages.js';
import {reviewTexts,parseEditorReview} from './modules/editor-review.js';
import {entityNeighborhood} from './modules/entity-neighborhood.js';
import {entitySourceEvidence} from './modules/entity-source-evidence.js';
import {EntityLifecycle} from './modules/entity-lifecycle.js';
import {SourceLifecycleService} from './modules/source-lifecycle.js';
import {readingNoteMaxWords,readingNoteWordCount} from '../shared/source-reading.js';
import {sourceProgress} from './modules/source-progress.js';
import {mathSource} from './modules/source-math-text.js';
import {processedSourceDocument} from './modules/source-document.js';
import {EntityScanStream} from './modules/entity-scan-stream.js';
import {DOMAINS,TAXONOMY_VERSION} from '../shared/domains.js';
import {Domains} from './modules/domains.js';
import {createHash} from 'node:crypto';
import { entityMentionName } from '../shared/domain.js';
import { maxSourceBytes } from './modules/source-files.js';
import { SourceDocuments } from './modules/source-documents.js';
import { maxBackupBytes } from './modules/vault-backups.js';
import { maxImageBytes } from './modules/images.js';
import { type EnrichmentField} from './modules/page-enrichment.js';
import { summaryInput } from './modules/summary-content.js';
import http,{ type IncomingMessage } from 'node:http';
import type {Socket} from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HttpError, object } from './validation.js';
import {isLoopback, networkRequestError, networkPeerAllowed} from './network.js';
import type {Runtime} from './runtime.js';
async function readBody(req: IncomingMessage) {
  let size=0;const chunks:Buffer[]=[];
  for await(const chunk of req) {
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk as string);size+=buffer.length;
    if(size>2_000_000)throw new HttpError(413,'Request too large');chunks.push(buffer);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch(error) { if(error instanceof HttpError)throw error;throw new HttpError(400,'Invalid JSON'); }
}

export function createTransportHandler(runtime: Runtime, clientRoot: string, sockets: Set<Socket>) {
  const { store, speechCache, temporal, liturgical, intelligence, networkAccess, vaultDeletion, sourceFiles, sourcePageImages, sourceReading, backups, images, notifications, vaults, knowledge, pages, organizer, activity, enrichments, sourceReprocessing, scans, pageEnrichment, enrichmentScheduler, scheduleEnrichment, entityMatches, embeddings, sourceEnrichments, searchSnippets, textSearch } = runtime;
  const speechControllers=new Map<AbortController,string>();
  return async(req: IncomingMessage,res: http.ServerResponse)=>{
    let activityId: string | undefined;
    const send=(status:number,data:unknown)=>{if(activityId){activity.finishResponse(activityId,status);activityId=undefined;}res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url || '/', 'http://localhost'),method=req.method || 'GET';
      // LAN mode expands the peer/host allowlist without weakening same-origin API checks.
      const accessError=networkRequestError(req,networkAccess.config());
      if(accessError)throw new HttpError(403,accessError);
      if(url.pathname.startsWith('/api/')) {
        if((req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Cross-origin requests are not allowed');
        const securityRoute = url.pathname === '/api/security/network' || /^\/api\/pages\/[^/]+\/edit-lock$/.test(url.pathname) || /^\/api\/vaults\/[^/]+\/passphrase$/.test(url.pathname);
        if (securityRoute && (req.headers['x-noema-request'] !== '1' || method === 'PUT' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))) throw new HttpError(403, 'Security settings require the Noema client and JSON.');
        const aiRoute=/^\/api\/entities\/[^/]+\/scholarly$/.test(url.pathname)||/^\/api\/entities\/[^/]+\/discovery(?:\/[^/]+\/review)?$/.test(url.pathname)||/^\/api\/entities\/[^/]+\/create-page(?:\/(?:accept|reject))?$/.test(url.pathname)||url.pathname==='/api/intelligence'||url.pathname.startsWith('/api/intelligence/')||url.pathname==='/api/embeddings'||url.pathname.startsWith('/api/embeddings/')||/^\/api\/pages\/[^/]+\/(summary|title|enrich|enrichment-settings|entity-scan|entity-review|explain|review)$/.test(url.pathname);
        const searchRoute=url.pathname.startsWith('/api/search/');
        if((aiRoute||searchRoute) && (req.headers['x-noema-request']!=='1'||(['POST','PUT'].includes(method)&&!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))))throw new HttpError(403,searchRoute?'Search requests require the Noema client and JSON':'AI requests require the Noema client and JSON');
        if(url.pathname==='/api/review-centre' && method==='GET') {
          const header=req.headers['x-vault-id'];if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          const vault=vaults.requireOpen(header||'default'),centre=new ReviewCentre(store),id=url.searchParams.get('id');
          if(id){
            const item=centre.resolve(vault,id);
            if(item?.category==='scan'){const row=store.get<{data:string}>("SELECT data FROM page_ai_enrichments WHERE page_id=? AND kind='entity_scan'",item.originId);const scan=row?JSON.parse(row.data).scan:null;if(scan?.contextKey&&scan.contextKey!==scans.contextKey(vault,pages.get(vault,item.originId))){item.state='stale';item.group='operations';}}
            if(item?.category==='discovery') {const draft=runtime.entityDiscovery.latest(vault,item.originId);if(!draft||draft.id!==item.runId)return send(200,null);if(draft.stale){item.state='stale';item.group='operations';}}
            if(item?.category==='editorial'){const revision=sourceReprocessing.detail(vault,item.fileId!,item.runId!);if(revision.stale){item.state='stale';item.group='operations';}}
            return send(200,item);
          }
          const offset=Number(url.searchParams.get('offset')??0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new HttpError(400,'Invalid review position');
          return send(200,centre.list(vault,offset));
        }
        if(url.pathname==='/api/source-files' || url.pathname.startsWith('/api/source-files/')) {
          if(req.headers['x-noema-request']!=='1' && method!=='GET')throw new HttpError(403,'Source actions require the Noema client');
          const header=req.headers['x-vault-id'];if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          const vault=vaults.requireOpen(header || (method==='GET'?url.searchParams.get('vault'):null) || 'default');
          const parts=url.pathname.split('/').filter(Boolean),id=parts[2];
          if(id && parts[3]==='reprocessing') {
            if(method==='POST'&&!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new HttpError(415,'Editorial requests require JSON.');
            if(parts.length===4&&method==='GET')return send(200,sourceReprocessing.list(vault,id));
            if(parts.length===4&&method==='POST'){const body=await readBody(req);vaults.requireOpen(vault);return send(202,sourceReprocessing.start(vault,id,body));}
            if(parts.length===6&&parts[5]==='status'&&method==='GET')return send(200,sourceReprocessing.status(vault,id,parts[4]!));
            if(parts.length===5&&method==='GET')return send(200,sourceReprocessing.detail(vault,id,parts[4]!));
            if(parts.length===6&&parts[5]==='cancel'&&method==='POST')return send(200,sourceReprocessing.cancel(vault,id,parts[4]!));
            if(parts.length===6&&parts[5]==='resume'&&method==='POST')return send(202,sourceReprocessing.resume(vault,id,parts[4]!));
            if(parts.length===6&&parts[5]==='review'&&method==='POST'){const body=await readBody(req);vaults.requireOpen(vault);return send(200,sourceReprocessing.review(vault,id,parts[4]!,body));}
            throw new HttpError(404,'Editorial endpoint not found.');
          }
          if(id==='url' && parts.length===3 && method==='POST') {
            if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new HttpError(415,'URL imports require JSON.');
            const body=await readBody(req);
            if(body.containsMath!==undefined&&typeof body.containsMath!=='boolean')throw new HttpError(400,'Invalid math notation choice.');
            if(body.entityId!==undefined&&typeof body.entityId!=='string')throw new HttpError(400,'Invalid source entity.');
            return send(201,await sourceFiles.addURL(vault,body.url,body.entityId as string|undefined,()=>{vaults.requireOpen(vault);},body.containsMath===true));
          }
          if(!id && parts.length===2 && method==='POST') {
            const containsMath=url.searchParams.get('containsMath');
            if(containsMath!==null&&containsMath!=='true'&&containsMath!=='false')throw new HttpError(400,'Invalid math notation choice.');
            const chunks:Buffer[]=[];let size=0;
            for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>maxSourceBytes)throw new HttpError(413,'Source files must be 50 MB or smaller');chunks.push(bytes);}
            vaults.requireOpen(vault);
            return send(201,await sourceFiles.admit(vault,url.searchParams.get('name')||'',Buffer.concat(chunks),url.searchParams.get('entity')||undefined,()=>{vaults.requireOpen(vault);},undefined,containsMath==='true'));
          }
          if(id && parts.length===4 && parts[3]==='evidence' && method==='GET') {
            const evidence=sourceFiles.evidence(vault,id),pageQuery=url.searchParams.get('page');
            if(pageQuery===null)return send(200,evidence);
            const page=Number(pageQuery),file=sourceFiles.require(vault,id);
            if(!Number.isSafeInteger(page)||page<1||page>(file.pages??0))throw new HttpError(400,'Choose a valid evidence page.');
            // The comparison panel needs one page, not the full raw text and
            // normalization offset map for the entire document on every click.
            const raw=evidence.rawExtraction as {ocrPages?:number;pageEvidence?:{page:number}[];unresolvedOutlines?:string[]}|undefined;
            const {originalAvailable,originalHash,originalBytes,admittedBytes,flattening,findings}=evidence;
            return send(200,{originalAvailable,originalHash,originalBytes,admittedBytes,flattening,findings,
              rawExtraction:raw?{ocrPages:raw.ocrPages,unresolvedOutlines:raw.unresolvedOutlines,pageEvidence:raw.pageEvidence?.filter(item=>item.page===page)}:undefined});
          }
          if(id && parts.length===5 && parts[3]==='page-image' && method==='GET') {
            const bytes=await sourcePageImages.get(vault,id,Number(parts[4]));
            vaults.requireOpen(vault);sourceFiles.require(vault,id);
            res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
            return res.end(bytes);
          }
          if(id && parts.length===3 && method==='GET') {
            const raw=sourceFiles.require(vault,id);
            const file=url.searchParams.get('sourceHash')===createHash('sha256').update(raw.text).digest('hex')?raw:mathSource(store,raw);
            return send(200,{...file,processing_detail:sourceProgress.get(file.id),
              ...(url.searchParams.get('fingerprint')==='1'?{textHash:createHash('sha256').update(file.text).digest('hex')}:{}),
              ...(url.searchParams.get('context')==='1'&&file.status==='ready'&&file.admitted?{document:processedSourceDocument(file)}:{}),
            });
          }
          if(id && parts[3]==='reading-locations') {
            if(parts.length===4&&method==='GET')return send(200,sourceReading.continuity(vault,id));
            if(parts.length===5&&method==='DELETE')return send(200,sourceReading.removeLocation(vault,id,parts[4]!));
            if(parts.length===5&&['PUT','PATCH'].includes(method)) {
              if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new HttpError(415,'Reading actions require JSON.');
              const body=await readBody(req);vaults.requireOpen(vault);
              return send(200,method==='PATCH'?sourceReading.renameLocation(vault,id,parts[4]!,body):sourceReading.saveLocation(vault,id,parts[4]!,body));
            }
          }
          if(id && parts.length===4 && parts[3]==='highlights' && method==='GET')return send(200,sourceReading.list(vault,id));
          if(id && parts.length===4 && parts[3]==='reading-notes' && method==='GET')return send(200,sourceReading.listReadingNotes(vault,id));
          if(id && parts.length===5 && parts[3]==='reading-notes' && parts[4]==='explain' && method==='POST') {
            if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new HttpError(415,'AI requests require JSON.');
            const body=await readBody(req);vaults.requireOpen(vault);
            const prepared=sourceReading.prepareExplanation(vault,id,body,intelligence.personaSelection().id);
            if(prepared.saved)return send(200,prepared.saved);
            activityId=activity.start('block_explanation',intelligence.selection(),vault,prepared.ref.sourceId,'entity');
            const controller=new AbortController(),abort=()=>controller.abort();
            res.once('close',abort);
            try {
              const explanation=await intelligence.generate({kind:'explanation',personaId:prepared.options.persona?.id,personaVersion:prepared.options.persona?.version,input:prepared.ref.excerpt,options:prepared.options,signal:controller.signal,onRequest:bytes=>activity.request(activityId!,bytes,null)});
              vaults.requireOpen(vault);
              if(controller.signal.aborted)throw new HttpError(409,'Explanation cancelled.');
              if(!explanation.trim()||readingNoteWordCount(explanation)>readingNoteMaxWords)throw new HttpError(502,'The explanation exceeded the 200-word reading note limit. Please try again.');
              const page=sourceReading.createReadingNote(vault,id,{...body,requestId:prepared.requestId,text:explanation},prepared.options);
              store.run("UPDATE ai_activity SET object_kind='page',object_id=? WHERE id=?",page.id,activityId);
              notifications.record(vault,page.id,'block_explanation');
              return send(201,page);
            }finally {res.removeListener('close',abort);}
          }
          if(id && parts.length===5 && parts[3]==='highlights' && method==='DELETE')return send(200,sourceReading.removeHighlight(vault,id,parts[4]!));
          if(id && parts.length===5 && parts[3]==='highlights' && method==='PUT') {
            if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new HttpError(415,'Reading actions require JSON.');
            const body=await readBody(req);vaults.requireOpen(vault);
            return send(200,sourceReading.updateHighlight(vault,id,parts[4]!,body));
          }
          if(id && parts.length===4 && ['highlights','reading-notes'].includes(parts[3]!) && method==='POST') {
            if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new HttpError(415,'Reading actions require JSON.');
            const body=await readBody(req);vaults.requireOpen(vault);
            return send(201,parts[3]==='highlights'?sourceReading.createHighlight(vault,id,body):sourceReading.createReadingNote(vault,id,body));
          }
          if(id && parts.length===3 && method==='DELETE')return send(200,sourceFiles.remove(vault,id));
          if(id && parts.length===4 && parts[3]==='retry' && method==='POST')return send(200,sourceFiles.retry(vault,id));
          if(id && parts.length===4 && parts[3]==='retry-enrichment' && method==='POST')return send(200,sourceEnrichments.retry(vault,id));
          if(id && parts.length===4 && parts[3]==='download-processed' && method==='GET') {
            const file=sourceFiles.require(vault,id);
            if(file.admitted!==1||file.status!=='ready'||!file.text.trim())throw new HttpError(409,'Processed text is available after source processing completes.');
            const name=(file.name.replace(/\.[^.]+$/,'')||'source')+'.processed.json';
            const filename=encodeURIComponent(name).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
            res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="source.processed.json"; filename*=UTF-8''${filename}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
            return res.end(JSON.stringify(new SourceDocuments(store).get(file),null,2));
          }
          if(id && parts.length===4 && parts[3]==='download' && method==='GET') {
            const file=sourceFiles.require(vault,id);
            if(file.admitted!==1)throw new HttpError(409,'This source is not available until safety processing succeeds.');
            const bytes=readFileSync(sourceFiles.filename(vault,id));
            const filename=encodeURIComponent(file.name).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
            res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="source.${id.split('.').at(-1)}"; filename*=UTF-8''${filename}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
            return res.end(bytes);
          }
          throw new HttpError(404,'Not found');
        }
        if((url.pathname === '/api/images' || url.pathname === '/api/images/fetch') && method === 'POST' || url.pathname.startsWith('/api/images/') && method === 'GET') {
          const header=req.headers['x-vault-id'];
          if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          const vault=vaults.requireOpen(header || (method === 'GET' ? url.searchParams.get('vault') : null) || 'default');
          if(method === 'POST') {
            if(req.headers['x-noema-request'] !== '1')throw new HttpError(403,'Image uploads require the Noema client');
            if (url.pathname === '/api/images/fetch') {
              if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415,'Image downloads require JSON.');
              const {bytes, mime} = await fetchRemoteImage((await readBody(req)).url);
              vaults.requireOpen(vault);
              res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
              return res.end(bytes);
            }
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
        const body=(['POST','PUT'].includes(method)||(method==='DELETE'&&/^\/api\/pages\/[^/]+\/archive$/.test(url.pathname)))?await readBody(req):{};
        const parts=url.pathname.split('/').filter(Boolean),[,collection,id,child,childId]=parts;
        if(collection==='temporal') {
          const header=req.headers['x-vault-id'];
          if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          if(method!=='GET'&&(req.headers['x-noema-request']!=='1'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')))throw new HttpError(403,'Temporal changes require the Noema client and JSON');
          const vault=vaults.requireOpen(header||(method==='GET'?url.searchParams.get('vault'):null)||'default');
          const calendar=method==='GET'?url.searchParams.get('calendar')??'gregorian':body.calendar??'gregorian';
          if(calendar!=='gregorian'&&calendar!=='julian')throw new HttpError(400,'Unsupported temporal calendar');
          const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??100);
          if(id==='liturgical'&&child==='preload'&&parts.length===4&&method==='POST')return send(202,liturgical.prepare(vault,Number(body.year),body.retry===true));
          if(id==='liturgical'&&child==='status'&&parts.length===4&&method==='GET')return send(200,liturgical.status(vault));
          if(id==='liturgical'&&child&&parts.length===4&&method==='GET')return send(200,await liturgical.year(vault,Number(child),url.searchParams.get('rite')??'grc-en'));
          if(id==='dates'&&parts.length===3&&method==='GET')return send(200,temporal.query(vault,url.searchParams.get('from')??'',url.searchParams.get('to')??'',url.searchParams.get('references')==='all',calendar,{offset,limit,layers:url.searchParams.has('layers')?(url.searchParams.get('layers')?.split(',').filter(Boolean)??[]) as import('../shared/temporal.js').TemporalLayer[]:undefined}));
          if(id==='dates'&&child&&parts.length===4&&method==='GET')return send(200,temporal.detail(vault,decodeURIComponent(child),offset,Number(url.searchParams.get('relationOffset')??0),Number(url.searchParams.get('limit')??20),Number(url.searchParams.get('sourceOffset')??0),Number(url.searchParams.get('propertyOffset')??0),Number(url.searchParams.get('proposalOffset')??0),url.searchParams.get('proposalId')??undefined));
          if(id==='curation'&&parts.length===3&&method==='PUT')return send(200,temporal.curate(vault,typeof body.value==='string'?body.value:'',body,calendar));
          if(id==='curation'&&child&&parts.length===4&&method==='DELETE')return send(200,temporal.uncurate(vault,decodeURIComponent(child)));
          if(id==='source-mentions'&&child&&parts.length===4&&method==='GET')return send(200,temporal.sources.resolve(vault,child));
          if(id==='relations'&&child&&parts.length===4&&method==='PUT')return send(200,temporal.reviewRelation(vault,child,body));
          if(id==='relations'&&parts.length===3&&method==='POST')return send(201,temporal.relate(vault,typeof body.dateId==='string'?body.dateId:'',body));
          if(id==='pages'&&child&&parts.length===4&&method==='GET')return send(200,temporal.pageEvidence(vault,child));
          if(id==='mentions'&&child&&parts.length===4&&method==='GET')return send(200,temporal.resolve(vault,child));
          if(id==='refresh'&&parts.length===3&&method==='POST')return send(200,temporal.refresh(vault));
          throw new HttpError(404,'Temporal endpoint not found');
        }
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
        if(method==='POST' && ((collection==='intelligence' && id==='validate' && parts.length===3) || (collection==='pages' && (child==='summary'||child==='title'||child==='enrich'||child==='entity-scan'||child==='explain'||child==='review') && !(body.background===true&&(child==='summary'||child==='title'||child==='enrich')) && parts.length===4))) {
          const header=req.headers['x-vault-id'];
          if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          activityId=activity.start(collection==='pages'?(child==='enrich'||child==='title'||child==='summary'?'page_enrichment':child==='entity-scan'?'entity_scan':child==='review'?'text_review':child==='explain'?'block_explanation':'page_summary'):'connection_test',child==='title'||child==='summary'||child==='enrich'?intelligence.enrichmentSelection():intelligence.selection(),collection==='pages'?(header||'default'):null,collection==='pages'?id!:null);
        }
        if(collection==='intelligence') {
          if(parts.length===4&&id==='speech'&&child==='model'&&method==='GET')return send(200,kokoroStatus());
          if(parts.length===4&&id==='speech'&&child==='model'&&method==='POST')return send(200,await downloadKokoro());
          if(parts.length===3&&id==='pricing'&&method==='GET')return send(200,activity.pricing());
          if(parts.length===3&&id==='pricing'&&method==='PUT')return send(200,activity.savePricing(body));
          if(parts.length===3&&id==='enrichment-metrics'&&method==='GET') {
            const header=req.headers['x-vault-id'];if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
            const vault=vaults.requireOpen(header||'default');return send(200,activity.enrichmentMetrics(vault));
          }
          if(parts.length===3 && id==='notifications' && method==='GET')return send(200,notifications.list());
          if(parts.length===3 && id==='notifications' && method==='PUT')return send(200,notifications.read(body));
          if(parts.length===3 && id==='debug' && method==='GET')return send(200,activity.debugSettings());
          if(parts.length===3 && id==='debug' && method==='PUT')return send(200,activity.saveDebugSettings(body));
          if(parts.length===4 && id==='activity' && child && method==='GET')return send(200,activity.debug(child,{after:url.searchParams.has('after')?Number(url.searchParams.get('after')):undefined,eventCursor:url.searchParams.has('eventCursor')?Number(url.searchParams.get('eventCursor')):undefined,limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):undefined,includeEvents:url.searchParams.has('events')?url.searchParams.get('events')==='1':undefined}));
          if(parts.length===3 && id==='activity' && method==='DELETE')return send(200,activity.clear());
          if(parts.length===3 && id==='activity' && method==='GET')return send(200,activity.list(url.searchParams.get('before')));
          if(parts.length===4&&id==='speech'&&child==='preview'&&method==='POST') {
            const header=req.headers['x-vault-id'];if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
            const vault=vaults.requireOpen(header||'default');
            if(!isSpeechProvider(body.provider))throw new HttpError(400,'Choose a supported speech provider.');
            const model=speechModelFor(body.provider);
            const controller=new AbortController(),abort=()=>controller.abort();res.once('close',abort);speechControllers.set(controller,vault);
            try {
              const audio=await intelligence.previewSpeech(body,controller.signal,bytes=>{
                activityId=activity.start('text_to_speech',{model,reasoningEffort:'none'},vault,null);
                return activity.request(activityId,bytes,null);
              });
              vaults.requireOpen(vault);
              if(controller.signal.aborted)throw new HttpError(409,'Speech preview cancelled.');
              if(activityId){activity.finish(activityId,'completed',200);activityId=undefined;}
              res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':audio.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="noema-speech-preview.wav"'});
              return res.end(audio);
            }finally{res.off('close',abort);speechControllers.delete(controller);}
          }
          if(parts.length===4&&id==='gemini'&&child==='validate'&&method==='POST')return send(200,await intelligence.validateGemini());
          if(parts.length===4&&id==='preferences'&&(child==='ai'||child==='voice')&&method==='PUT')return send(200,intelligence.saveCategoryPreferences(child,body));
          if(parts.length===3 && id==='speech' && method==='POST') {
            const header=req.headers['x-vault-id'];if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
            if(body.pageId!==undefined&&(typeof body.pageId!=='string'||!body.pageId))throw new HttpError(400,'Invalid speech source page.');
            const speechPageId=typeof body.pageId==='string'?body.pageId:null;
            const provider=intelligence.speechProviderSelection(),voice=intelligence.speechVoiceSelection(),model=speechModelFor(provider),speechRevision=intelligence.speechRevision();
            // Ordinary runs pin the saved narration independently from explicit draft previews.
            const expectedNarration=body.expectedNarration===undefined?undefined:JSON.stringify(intelligence.parseNarration(body.expectedNarration));
            const narration=body.narration===undefined?intelligence.narrationSelection():intelligence.parseNarration(body.narration);
            const pauseAfterMs=body.pauseAfterMs??0;
            if(typeof pauseAfterMs!=='number'||!Number.isInteger(pauseAfterMs)||pauseAfterMs<0||pauseAfterMs>3000)throw new HttpError(400,'Pause must be between 0 and 3,000 milliseconds.');
            if(body.protectedText!==undefined&&typeof body.protectedText!=='boolean')throw new HttpError(400,'Invalid protected speech section.');
            const protectedText=body.protectedText===true;
            if(body.provider!==undefined&&!isSpeechProvider(body.provider))throw new HttpError(400,'Choose a supported speech provider.');
            if(body.provider!==undefined&&body.provider!==provider)throw new HttpError(409,'The speech provider changed. Start Speak again.');
            if(body.voice!==undefined&&!isSpeechVoice(body.voice,provider))throw new HttpError(400,'Choose a supported voice for the speech provider.');
            if(body.voice!==undefined&&body.voice!==voice)throw new HttpError(409,'The speech voice changed. Start Speak again.');
            const vault=vaults.requireOpen(header||'default');
            const validateAccess=()=>{vaults.requireOpen(vault);if(speechPageId)pages.get(vault,speechPageId);if(expectedNarration!==undefined&&JSON.stringify(intelligence.narrationSelection())!==expectedNarration)throw new HttpError(409,'The narration settings changed. Start Speak again.');if(intelligence.speechRevision()!==speechRevision||intelligence.speechProviderSelection()!==provider||intelligence.speechVoiceSelection()!==voice)throw new HttpError(409,'The speech settings changed. Start Speak again.');};
            validateAccess();
            if(!intelligence.speechEnabled())throw new HttpError(409,'Enable text to speech in Settings → Intelligence.');
            if(typeof body.text!=='string')throw new HttpError(400,'Speech requires text of at most 4,096 characters.');
            const text=cleanSpeechText(body.text);
            if(!text||text.length>4096)throw new HttpError(400,'Speech requires text of at most 4,096 characters.');
            const key=speechCacheKey(text,{provider,model,voice,narration,pauseAfterMs,protectedText}),cached=speechCache.read(vault,key);
            const controller=new AbortController(),abort=()=>controller.abort();res.once('close',abort);speechControllers.set(controller,vault);
            try {
              let audio=cached;
              if(!audio) {
                activityId=activity.start('text_to_speech',{model,reasoningEffort:'none'},vault,speechPageId);
                audio=await intelligence.speech(text,controller.signal,bytes=>activity.request(activityId!,bytes,null),{narration,pauseAfterMs,protectedText});
                validateAccess();
                if(controller.signal.aborted)throw new HttpError(409,'Speech request cancelled.');
                speechCache.write(vault,key,audio,()=>{validateAccess();if(controller.signal.aborted)throw new HttpError(409,'Speech request cancelled.');});
                activity.finish(activityId!,'completed',200);activityId=undefined;
              }
              validateAccess();
              if(controller.signal.aborted)throw new HttpError(409,'Speech request cancelled.');
              res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':audio.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Noema-Speech-Cache':cached?'hit':'miss','Content-Disposition':`inline; filename="noema-speech-${key.slice(0,12)}.wav"`});
              return res.end(audio);
            } finally {res.off('close',abort);speechControllers.delete(controller);}

          }
          if(parts.length===3&&id==='gemini') {
            if(method==='GET')return send(200,intelligence.geminiStatus());
            if(method==='PUT')return send(200,intelligence.saveGemini(body));
            if(method==='DELETE')return send(200,intelligence.removeGemini());
          }
          if(parts.length===2 && method==='GET')return send(200,intelligence.status());
          if(parts.length===3 && id==='preferences' && method==='PUT')return send(200,intelligence.savePreferences(body));
          if(parts.length===2 && method==='PUT'){const result=intelligence.save(body);embeddings.clearQueryCache();return send(200,result);}
          if(parts.length===2 && method==='DELETE'){const result=intelligence.remove();embeddings.clearQueryCache();return send(200,result);}
          if(parts.length===3 && id==='validate' && method==='POST') {await intelligence.generate({kind:'validation',onRequest:bytes=>activity.request(activityId!,bytes,null)});return send(200,{ok:true,...intelligence.selection()});}
          throw new HttpError(404,'Not found');
        } else if(collection==='vaults') {
          if(id && parts.length===4 && method==='GET' && child==='storage')return send(200,await vaultStorage(store,id,url.searchParams.get('category') ?? undefined));
          if(id && parts.length===4 && method==='PUT' && child==='passphrase')return send(200,vaults.setPassphrase(id,body));
          if(parts.length===2 && method==='GET')return send(200,vaults.list());
          if(parts.length===2 && method==='POST')return send(201,vaults.create(body));
          if(id && parts.length===4 && method==='GET' && child==='deletion-preview')return send(200,vaultDeletion.preview(id));
          if(id && parts.length===4 && method==='POST' && child==='delete')return send(200,vaultDeletion.remove(id,body));
          if(id && parts.length===4 && method==='POST' && child==='lock'){const result=vaults.lock(id,body);for(const [controller,vault] of speechControllers)if(vault===id)controller.abort();organizer.smart.clearCaches(id);enrichmentScheduler.pauseVault(id);pageEnrichment.pauseVault(id);embeddings.clearQueryCache(id);return send(200,result);}
          if(id && parts.length===4 && method==='POST' && child==='unlock')return send(200,vaults.unlock(id,body));
        } else {
          const header=req.headers['x-vault-id'];
          if(Array.isArray(header))throw new HttpError(400,'Invalid vault ID');
          const vault=vaults.requireOpen(header || 'default');
          if(collection==='bibliography') {
            if(parts.length>4)throw new HttpError(404,'Not found');
            if(method!=='GET'&&(req.headers['x-noema-request']!=='1'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')))throw new HttpError(403,'Bibliography changes require the Noema client and JSON');
            return await bibliographyRoutes(runtime.bibliography,{activity,vault,id,action:child,method,body,res,send});
          }
          if(collection==='pages' && id && child==='preview' && parts.length===4 && method==='GET')return send(200,pages.preview(vault,id));
          pages.purgeExpired(vault);
          if(collection==='search' && parts.length===3 && id==='text' && method==='POST')return send(200,textSearch.search(vault,body.query,body.limit,body.scope));
          if(collection==='search' && parts.length===3 && id==='snippets' && method==='POST')return send(200,searchSnippets.get(vault,body));
          if(collection==='embeddings') {
            if(parts.length===2 && method==='GET')return send(200,embeddings.status(vault));
            if(parts.length===3 && id==='settings' && method==='PUT')return send(200,embeddings.saveSettings(vault,body));
            if(parts.length===3 && id==='enqueue' && method==='POST')return send(200,embeddings.enqueueExisting(vault,body));
            if(parts.length===5 && id==='jobs' && child && childId==='retry' && method==='POST')return send(200,embeddings.retry(vault,child));
            if(parts.length===3 && id==='search' && method==='POST')return send(200,await embeddings.search(vault,body));
          }
          if(collection==='domains' && parts.length===2 && method==='GET')return send(200,{domains:DOMAINS,taxonomyVersion:TAXONOMY_VERSION});
          if(collection==='entity-schema') {
            if(id==='definitions'&&parts.length===3&&method==='POST')return send(201,new PropertyDefinitionGovernance(store).create(vault,body));
            if(id==='definitions'&&child&&parts.length===5&&childId==='impact'&&method==='POST')return send(200,new PropertyDefinitionGovernance(store).impact(vault,decodeURIComponent(child),body));
            if(id==='definitions'&&child&&parts.length===4&&method==='PUT')return send(200,new PropertyDefinitionGovernance(store).update(vault,decodeURIComponent(child),body));
            if(parts.length===2 && method==='GET')return send(200,knowledge.schema(vault));
            if(parts.length===3 && method==='POST' && id==='subtypes')return send(201,knowledge.addSubtype(vault,body));
            if(parts.length===3 && method==='POST' && id==='properties')return send(201,knowledge.addTypeProperty(vault,body));
          }
          if(collection==='trash') {
            if(parts.length===2 && method==='GET')return send(200,pages.trash(vault));
            if(id && parts.length===4 && child==='restore' && method==='POST'){const page=pages.restore(vault,id);embeddings.onSave(vault,id);scheduleEnrichment(vault,page);return send(200,pages.get(vault,page.id));}
            if(id && parts.length===3 && method==='DELETE')return send(200,pages.permanentlyDelete(vault,id));
          }
          if(collection==='organization') {
            if(parts.length===3 && method==='POST' && id==='generate-rules')return send(200,await organizer.smart.ruleGeneration.generate(vault,body));
            if(parts.length===3 && method==='POST' && id==='example-preview')return send(200,organizer.smart.examplePreview(vault,body));
            if(parts.length===3 && method==='POST' && id==='semantic-evaluate')return send(200,await organizer.smart.evaluateDescription(vault,body));
            if(parts.length===3 && method==='POST' && id==='semantic-preview')return send(200,organizer.smart.semanticPreview(vault,body));
            if(parts.length===3 && method==='POST' && id==='smart-preview')return send(200,organizer.smart.preview(vault,body));
            if(parts.length===5 && method==='POST' && id==='collections' && child && childId==='refresh'){organizer.smart.refresh(vault,child);return send(200,organizer.list(vault));}
            if(parts.length===2 && method==='GET')return send(200,organizer.list(vault));
            if((id==='collections'||id==='folders') && (parts.length===3 || parts.length===4)) {
              if(method==='POST' && !child)return send(201,id==='collections'?organizer.saveCollection(vault,body):organizer.saveFolder(vault,body));
              if(method==='PUT' && child)return send(200,id==='collections'?organizer.saveCollection(vault,body,child):organizer.saveFolder(vault,body,child));
              if(method==='DELETE' && child)return send(200,organizer.remove(vault,id,child));
            }
            if(parts.length===3 && method==='PUT' && id==='folder-memberships')return send(200,organizer.folderMembership(vault,body));
            if(parts.length===3 && method==='PUT' && id==='memberships')return send(200,organizer.membership(vault,body));
            if(parts.length===3 && method==='PUT' && id==='locations')return send(200,organizer.locate(vault,body));
            if(parts.length===3 && method==='PUT' && id==='favourites')return send(200,organizer.favourite(vault,body));
          }
          if(collection==='pages') {
            if(id==='archive' && parts.length===3 && method==='GET')return send(200,pages.archiveList(vault));
            if(id && child==='archive' && parts.length===4 && (method==='PUT'||method==='DELETE'))return send(200,pages.setArchived(vault,id,method==='PUT',body));
            if(id && method!=='GET' && id!=='archive')pages.requireActive(vault,id);

            if(id && parts.length===4 && child==='entities' && method==='GET')return send(200,knowledge.pageAssociations(vault,id));
            if(id && parts.length===4 && child==='domains' && method==='PUT'){new Domains(store).setManual(vault,id,body,body.revision);return send(200,pages.get(vault,id));}
            if(id && parts.length===4 && child==='edit-lock' && method==='PUT')return send(200,pages.setEditLock(vault,id,body));
            if(id && child==='connections') {
              if(parts.length===4&&method==='GET')return send(200,pages.associations(vault,id));
              if(parts.length===5&&childId&&method==='PUT')return send(200,pages.associate(vault,id,childId,body));
              if(parts.length===5&&childId&&method==='DELETE')return send(200,pages.removeAssociation(vault,id,childId));
            }
            if(id && parts.length===4 && child==='backlinks' && method==='GET')return send(200,pages.backlinks(vault,id));
            if(id && parts.length===4 && child==='review' && method==='POST') {
              const page=pages.requireEditable(vault,id),texts=reviewTexts(body.texts);
              const output=await intelligence.generate({kind:'review',personaId:typeof body.personaId==='string'?body.personaId:undefined,input:JSON.stringify({untrusted_texts:texts}),onRequest:bytes=>activity.request(activityId!,bytes,page.revision)});
              vaults.requireOpen(vault);pages.requireEditable(vault,id);
              return send(200,{suggestions:parseEditorReview(output,texts)});
            }
            if(id && parts.length===4 && child==='explain' && method==='POST') {
              const page=pages.requireEditable(vault,id);
              // Draft blocks allow explaining current edits without saving or sending other note content.
              const blocks=pages.validateBlocks(vault,body.blocks);
              const input=summaryInput({title:'',blocks},entityId=>entityMentionName(knowledge.find(vault,entityId)),false,true).trim();
              if(!input)throw new HttpError(400,'Select blocks containing text or equations to explain.');
              if(Buffer.byteLength(input,'utf8')>24000)throw new HttpError(400,'Select fewer blocks (at most 24,000 bytes of text).');
              const persona=intelligence.personaSelection(body.personaId,typeof body.personaVersion==='number'?body.personaVersion:undefined);
              const markdown=await intelligence.generate({kind:'explanation',personaId:persona.id,personaVersion:persona.version,input,onRequest:bytes=>activity.request(activityId!,bytes,page.revision)});
              vaults.requireOpen(vault);pages.get(vault,id);
              notifications.record(vault,id,'block_explanation');
              return send(200,{markdown,persona:{id:persona.id,version:persona.version,origin:persona.origin}});
            }
            if(id && parts.length===4 && child==='entity-review' && method==='POST') {
              const result=scans.review(vault,id,body);
              if(body.decision==='accepted')embeddings.onSave(vault,id);
              return send(200,result);
            }
            if(id && parts.length===4 && child==='entity-scan' && method==='POST') {
              const page=pages.get(vault,id);
              if(body.revision!==page.revision)throw new HttpError(409,'Save the latest note before scanning.');
              const previous=scans.continuation(vault,page,body.continueScanId,body.continuationToken);
              const cached=enrichments.list(vault,id).find(row=>row.kind==='entity_scan'&&row.revision===page.revision)?.data.scan as import('../shared/entity-scan.js').EntityScan|undefined;
              const contextKey=scans.contextKey(vault,page);
              const streaming=req.headers.accept?.includes('application/x-ndjson');
              if(!previous&&!streaming&&cached?.contextKey===contextKey)return send(200,cached);
              const input=scans.input(vault,page,previous);
              if(streaming) {
                const controller=new AbortController(),parser=new EntityScanStream();
                const disconnected=()=>{if(!res.writableEnded)controller.abort();};
                res.on('close',disconnected);
                const emit=(event:import('../shared/entity-scan.js').EntityScanEvent)=>{
                  if(controller.signal.aborted||res.destroyed)throw new HttpError(499,'Entity scanning stopped.');
                  vaults.requireOpen(vault);res.write(JSON.stringify(event)+'\n');
                };
                res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Accel-Buffering':'no'});res.flushHeaders();
                const heartbeat=setInterval(()=>{if(!res.destroyed&&!controller.signal.aborted)res.write('\n');},10000);
                try {
                  if(!previous&&cached?.contextKey===contextKey)emit({type:'completed',scan:cached});
                  else {
                    const output=await intelligence.generate({kind:'entityScan',input,onRequest:bytes=>activity.request(activityId!,bytes,page.revision),
                      signal:controller.signal,onDelta:delta=>{
                        const suggestions=parser.feed(delta);
                        if(suggestions&&(suggestions.length===1||suggestions.length%5===0))emit({type:'progress',scan:scans.save(vault,page,JSON.stringify({suggestions}),intelligence.selection(),false,previous)});
                      },
                    });
                    if(controller.signal.aborted)throw new HttpError(499,'Entity scanning stopped.');
                    vaults.requireOpen(vault);
                    if(scans.contextKey(vault,pages.get(vault,id))!==contextKey)throw new HttpError(409,'The note, domains or entity catalog changed. Scan again.');
                    emit({type:'completed',scan:scans.save(vault,page,output,intelligence.selection(),true,previous)});
                  }
                  activity.finish(activityId!,'completed',200);activityId=undefined;res.end();
                }catch(error){
                  if(activityId){activity.finish(activityId,controller.signal.aborted?'interrupted':'failed',error instanceof HttpError?error.status:500);activityId=undefined;}
                  if(!res.destroyed)res.end(JSON.stringify({type:'error',message:error instanceof HttpError?error.message:'Entity scan failed. Please try again.'})+'\n');
                }finally{clearInterval(heartbeat);res.removeListener('close',disconnected);}
                return;
              }
              const parser=new EntityScanStream();
              const output=await intelligence.generate({kind:'entityScan',input,onRequest:bytes=>activity.request(activityId!,bytes,page.revision),onDelta:delta=>{parser.feed(delta);}});
              vaults.requireOpen(vault);
              if(scans.contextKey(vault,pages.get(vault,id))!==contextKey)throw new HttpError(409,'The note, domains or entity catalog changed. Scan again.');
              return send(200,scans.save(vault,page,output,intelligence.selection(),true,previous));
            }
            if(id && parts.length===4 && child==='summary' && method==='DELETE')return send(200,enrichments.removeSummary(vault,id));
            if(id && parts.length===4 && child==='enrichments' && method==='GET')return send(200,enrichments.list(vault,id));
            if(id && parts.length===4 && child==='enrichment-settings') {
              if(method==='GET')return send(200,pageEnrichment.settings(vault));
              if(method==='PUT'){const settings=pageEnrichment.configure(vault,body);if(settings.automaticSummaries)scheduleEnrichment(vault,pages.get(vault,id));return send(200,settings);}
            }
            if(id && parts.length===4 && (child==='summary'||child==='title'||child==='enrich') && method==='POST') {
              const page=pages.requireEditable(vault,id);
              if(body.revision!==page.revision)throw new HttpError(409,'Save the latest page before enrichment.');
              const allowed:EnrichmentField[]=['title','domains','language','summary'];
              if(body.requestedFields!==undefined&&(!Array.isArray(body.requestedFields)||!body.requestedFields.length||body.requestedFields.some(field=>!allowed.includes(field as EnrichmentField))))throw new HttpError(400,'Choose valid enrichment fields.');
              const background=body.background===true;
              // Compatibility for old clients: saved pages are already queued. A browser
              // background call must not dispatch work or reset the queue's retry budget.
              if(background)return send(200,{title:page.title,revision:page.revision,pageDomains:page.pageDomains,enrichmentPending:page.enrichmentPending});
              const result=await pageEnrichment.run(vault,page,bytes=>activity.request(activityId!,bytes,page.revision),{
                fields:child==='enrich'?body.requestedFields as EnrichmentField[]|undefined:undefined,
                explicit:!background,background,refreshFields:child==='summary'?['summary']:child==='title'&&!background?['domains']:body.requestedFields as EnrichmentField[]|undefined,
              });
              if(result.classified)enrichmentScheduler.markClassified(id);
              if(child==='summary')return send(200,{summary:result.summary??'',revision:result.revision,contentHash:result.contentHash,...intelligence.enrichmentSelection()});
              return send(200,result);
            }
            if(id && child==='suggestion-version' && parts.length===4 && method==='GET')return send(200,embeddings.suggestionVersion(vault,id));
            if(id && child==='related-notes' && parts.length===4 && method==='GET')return send(200,url.searchParams.has('state')?embeddings.relatedNotesState(vault,id,url.searchParams.getAll('previous')):embeddings.relatedNotes(vault,id));
            if(id && child==='source-suggestions' && parts.length===4) {
              if(method==='GET')return send(200,embeddings.suggestedSources(vault,id));
              if(method==='POST')return send(200,embeddings.dismissSource(vault,id,body.sourceId));
            }
            if(id && child==='history') {
              const history=new PageHistory(store);
              if(parts.length===4&&method==='GET')return send(200,history.list(vault,id));
              if(parts.length===4&&method==='POST')return send(201,history.checkpoint(vault,id,body));
              if(childId&&parts.length===5&&method==='GET')return send(200,history.get(vault,id,childId));
              if(childId&&parts.length===6&&method==='POST'&&(parts[5]==='restore'||parts[5]==='copy')) {
                const page=parts[5]==='restore'?history.restore(vault,id,childId,body,pages):history.copy(vault,id,childId,body,pages);
                embeddings.onSave(vault,page.id);scheduleEnrichment(vault,page);return send(200,page);
              }
            }
            if(id && child==='editor' && parts.length===4 && method==='GET') {
              const page=pages.get(vault,id);
              return send(200,{...page,entityMatchCache:entityMatches.get(vault,id,page.revision)});
            }
            if(id && child==='metadata' && parts.length===4 && method==='GET') {
              const {id:pageId,vault_id,title,revision,pageDomains,summaryContentHash,enrichmentPending,enrichmentPendingFields,enrichmentFields,language}=pages.get(vault,id);
              return send(200,{id:pageId,vault_id,title,revision,pageDomains,summaryContentHash,enrichmentPending,enrichmentPendingFields,enrichmentFields,language});
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
            if(parts.length===2 && method==='POST'){const page=pages.create(vault,body);embeddings.onSave(vault,page.id);scheduleEnrichment(vault,page);return send(201,pages.get(vault,page.id));}
            if(id && parts.length===3) {
              if(method==='GET')return send(200,pages.get(vault,id));
              if(method==='PUT'){const page=pages.update(vault,id,body);embeddings.onSave(vault,id);scheduleEnrichment(vault,page);return send(200,pages.get(vault,page.id));}
              if(method==='DELETE'){const result=pages.delete(vault,id);embeddings.invalidate(vault,id);return send(200,result);}
            }
          }
          if(collection==='entities') {
            if(id&&child==='scholarly'&&parts.length===4&&method==='POST') {
              const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
              try{return send(200,await sourceEnrichments.scholarly(vault,id,body,controller.signal));}
              catch(error){if(controller.signal.aborted)return;throw error;}
              finally{res.removeListener('close',abort);}
            }

            if(id&&child==='property-proposals'&&parts.length===4&&method==='GET')return send(200,new PropertyReview(store).list(vault,id,url.searchParams.get('status')??'pending',url.searchParams.get('proposalId')??undefined));
            if(id&&child==='property-proposals'&&childId&&parts.length===6&&parts[5]==='review'&&method==='POST')return send(200,new PropertyReview(store).review(vault,id,decodeURIComponent(childId),body as unknown as Parameters<PropertyReview['review']>[3]));
            if(id&&child==='classification-impact'&&parts.length===4&&method==='POST')return send(200,new EntityClassificationImpact(store).preview(vault,id,{type:body.type as import('../shared/domain.js').EntityType,subtypes:body.subtypes as string[]}));
            if(id==='reference-options' && parts.length===3 && method==='GET')return send(200,knowledge.referenceOptions(vault,{
              query:url.searchParams.get('q')??'', types:(url.searchParams.get('types')??'').split(',').filter(Boolean), subtypes:(url.searchParams.get('subtypes')??'').split(',').filter(Boolean),
              offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??30),selected:url.searchParams.get('selected')??'',
            }));
            if(id && child==='neighborhood' && parts.length===4 && method==='GET') {
              const depth=Number(url.searchParams.get('depth')??1);
              if(depth!==1&&depth!==2)throw new HttpError(400,'Choose one or two hops.');
              return send(200,entityNeighborhood(store,vault,id,{depth,relationType:url.searchParams.get('relationType')??undefined}));
            }
            if(id && child==='discovery') {
              if(parts.length===4 && method==='GET')return send(200,runtime.entityDiscovery.latest(vault,id));
              if(parts.length===4 && method==='POST') {
                const controller=new AbortController();
                const abort=()=>{if(!res.writableEnded)controller.abort();};
                res.once('close',abort);
                try{return send(200,await runtime.entityDiscovery.generate(vault,id,controller.signal));}
                catch(error){if(controller.signal.aborted)return;throw error;}
                finally{res.removeListener('close',abort);}
              }
              if(parts.length===6 && childId && parts[5]==='review' && method==='POST')return send(200,runtime.entityDiscovery.review(vault,id,childId,body));
            }
            if(id && child==='evidence' && parts.length===4 && method==='GET') {
              const offset=Number(url.searchParams.get('offset')??0);
              if(!Number.isSafeInteger(offset)||offset<0)throw new HttpError(400,'Invalid evidence offset.');
              return send(200,entitySourceEvidence(store,vault,id,{offset,preview:url.searchParams.get('preview')==='1'}));
            }
            if(id && child==='pages' && parts.length===4 && method==='POST')return send(201,knowledge.createPage(vault,id,body,pages));
            if(id && child==='overview' && parts.length===4 && method==='PUT')return send(200,knowledge.saveOverview(vault,id,body));
            if(id && child==='pages' && childId && parts.length===5) {
              if(method==='PUT')return send(200,knowledge.associatePage(vault,id,childId,body));
              if(method==='DELETE')return send(200,knowledge.removePage(vault,id,childId));
            }
            if(id && child==='lifecycle' && parts.length===4) {
              const lifecycle=new SourceLifecycleService(store);
              if(method==='GET')return send(200,new EntityLifecycle(store).preview(vault,id));
              if(method==='POST') {
                if(body.action==='archive'||body.action==='restore')return send(200,new EntityLifecycle(store).change(vault,id,body.action==='restore',body.version));
                if(body.action==='delete')return send(200,lifecycle.delete(vault,id,body.confirmation));
                throw new HttpError(400,'Choose archive, restore, or delete.');
              }
            }
            if(id && child==='create-page')return sourcePageRoutes(runtime,{vault,id,parts,childId,method,body,res,send});
            if(id && child==='aliases' && parts.length===4 && method==='POST')return send(200,knowledge.addAlias(vault,id,body));
            if(parts.length===2 && method==='GET')return send(200,knowledge.list(vault));
            if(parts.length===2 && method==='POST')return send(201,knowledge.create(vault,body));
            if(id && parts.length===3) {
              if(method==='GET')return send(200,knowledge.detail(vault,id,url.searchParams.get('preview')==='1'));
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
  };
}

export function trackConnections(server: http.Server, networkAccess: NetworkAccess, sockets: Set<Socket>) {
  server.on('connection', socket => {
    if (!networkPeerAllowed(socket.remoteAddress || '', networkAccess.config(), socket.localAddress)) { socket.destroy(); return; }
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
}
