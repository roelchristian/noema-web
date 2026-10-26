import {randomUUID} from 'node:crypto';
import type {ChatEvidence,ChatMessage,ChatScope} from '../../shared/chat.js';
import type {Store} from '../store.js';
import {HttpError} from '../validation.js';
type Row=Record<string,unknown>;
interface Maps {folders:Map<string,string>;pages:Map<string,string>;entities:Map<string,string>;files:Map<string,string>;properties:Map<string,string>;relationships:Map<string,string>;generations:Map<string,string>;passages:Map<string,string>}
const invalid=()=>new HttpError(400,'This backup contains invalid Chat history.');
const record=(x:unknown):Row=>{if(!x||typeof x!=='object'||Array.isArray(x))throw invalid();return x as Row;};
const str=(x:unknown,max=20000):string=>{if(typeof x!=='string'||x.length>max)throw invalid();return x;};
const id=(x:unknown)=>{const v=str(x,200);if(!v.trim())throw invalid();return v;};
const time=(x:unknown)=>{const v=str(x,100);if(!Number.isFinite(Date.parse(v)))throw invalid();return v;};
const array=(x:unknown,max=200):unknown[]=>{if(!Array.isArray(x)||x.length>max)throw invalid();return x;};
const integer=(x:unknown,min=0)=>{if(typeof x!=='number'||!Number.isSafeInteger(x)||x<min)throw invalid();return x;};
const parse=(x:unknown)=>{try{return record(JSON.parse(str(x,2_000_000)));}catch{throw invalid();}};
/** History is restored as historical snapshots, never promoted into current knowledge.
 * Detached IDs are fresh per import, so deleted evidence cannot navigate into another vault. */
export function restoreChatHistory(store:Store,vault:string,rows:{threads:Row[];messages:Row[];evidence:Row[]},maps:Maps) {
 const detached=new Map<string,string>();
 const remap=(map:Map<string,string>,value:unknown,kind:string)=>{const key=id(value);if(map.has(key))return map.get(key)!;const k=kind+':'+key;if(!detached.has(k))detached.set(k,randomUUID());return detached.get(k)!;};
 const scope=(value:unknown):ChatScope=>{const r=record(value);if(r.kind==='vault')return {kind:'vault'};if(!['page','source','entity','folder'].includes(String(r.kind)))throw invalid();return {kind:r.kind as 'page'|'source'|'entity'|'folder',id:remap(r.kind==='folder'?maps.folders:r.kind==='page'?maps.pages:maps.entities,r.id,r.kind==='folder'?'folder':r.kind==='page'?'page':'entity')};};
 const threadIds=new Map<string,string>(),messageIds=new Map<string,string>(),sequences=new Map<string,Set<number>>();
 if(rows.threads.length>1000||rows.messages.length>200000||rows.evidence.length>200000)throw invalid();
 for(const row of rows.threads){const old=id(row.id);if(threadIds.has(old))throw invalid();const key=randomUUID();threadIds.set(old,key);sequences.set(old,new Set());store.run('INSERT INTO chat_threads(id,vault_id,title,scope_json,created_at,updated_at) VALUES(?,?,?,?,?,?)',key,vault,str(row.title,160),JSON.stringify(scope(parse(row.scope_json))),time(row.created_at),time(row.updated_at));}
 const byMessage=new Map<string,ChatEvidence[]>(),evidenceKeys=new Set<string>();
 for(const row of rows.evidence){const messageId=id(row.message_id),evidenceId=id(row.evidence_id);if(!/^E[1-9]\d{0,2}$/.test(evidenceId)||evidenceKeys.has(messageId+':'+evidenceId))throw invalid();evidenceKeys.add(messageId+':'+evidenceId);const r=parse(row.snapshot);
  if(typeof r.fingerprint!=='string'||!/^(?:restored:)?[a-f0-9]{64}$/.test(r.fingerprint)||r.id!==evidenceId||!['source','own_note','entity_fact','entity_overview'].includes(String(r.kind))||!['current','stale','deleted'].includes(String(r.status)))throw invalid();
  const kind=r.kind as ChatEvidence['kind'];const e:ChatEvidence={id:evidenceId,kind,objectId:remap(kind==='own_note'?maps.pages:maps.entities,r.objectId,kind==='own_note'?'page':'entity'),title:str(r.title,1000),excerpt:str(r.excerpt,32000),fingerprint:'restored:'+str(r.fingerprint,200).replace(/^restored:/,''),locator:str(r.locator,2000),status:r.status==='deleted'?'deleted':'stale'};
  if(r.revision!==undefined)e.revision=integer(r.revision);
  if(r.origin!==undefined){if(!['authored','ai_generated','mixed'].includes(String(r.origin)))throw invalid();e.origin=r.origin as ChatEvidence['origin'];}
  if(r.factId!==undefined){const old=id(r.factId),match=/^(property|incoming|relationship):(.+)$/.exec(old);if(old==='description'||old==='overview')e.factId=old;else if(match){e.factId=match[1]+':'+remap(match[1]==='relationship'?maps.relationships:maps.properties,match[2],match[1]==='relationship'?'relationship':'property');if(e.locator===old)e.locator=e.factId;}else throw invalid();}
  if(r.pageReference!==undefined){const p=record(r.pageReference);if(kind!=='own_note'||p.pageId!==r.objectId||p.excerpt!==r.excerpt)throw invalid();const start=integer(p.startOffset),end=integer(p.endOffset);if(end<start)throw invalid();e.pageReference={pageId:e.objectId,segmentId:remap(new Map(),p.segmentId,'segment'),revision:integer(p.revision),projectionHash:str(p.projectionHash,200),blockIds:array(p.blockIds,500).map(x=>id(x)),startOffset:start,endOffset:end,excerpt:str(p.excerpt,32000)};}
  if(r.reference!==undefined){const p=record(r.reference);if(kind!=='source'||p.sourceId!==r.objectId||p.excerpt!==r.excerpt)throw invalid();const startLine=integer(p.startLine,1),endLine=integer(p.endLine,startLine);const ref:NonNullable<ChatEvidence['reference']>={id:randomUUID(),sourceId:e.objectId,fileId:remap(maps.files,p.fileId,'file'),startLine,endLine,sourceHash:str(p.sourceHash,200),excerpt:str(p.excerpt,32000),stale:true};
   for(const key of ['startOffset','endOffset','startPage','endPage','sourceNumber'] as const)if(p[key]!==undefined)ref[key]=integer(p[key]);
   if(ref.endOffset!==undefined&&ref.startOffset!==undefined&&ref.endOffset<ref.startOffset)throw invalid();
   if(p.strictTemporal!==undefined){if(typeof p.strictTemporal!=='boolean')throw invalid();ref.strictTemporal=p.strictTemporal;}
   for(const key of ['userLocator','appLocator','nodeId','contextLabel'] as const)if(p[key]!==undefined)ref[key]=str(p[key],2000);
   if(p.generationId!==undefined)ref.generationId=remap(maps.generations,p.generationId,'generation');if(p.passageId!==undefined)ref.passageId=remap(maps.passages,p.passageId,'passage');e.reference=ref;
  }
  if(kind==='source'&&!e.reference||kind==='own_note'&&!e.pageReference||kind==='entity_fact'&&!e.factId||kind==='entity_overview'&&e.revision===undefined)throw invalid();
  if(e.reference){const owner=store.get<{entity_id:string}>('SELECT entity_id FROM source_files WHERE id=? AND vault_id=?',e.reference.fileId,vault),source=store.get<{type:string}>('SELECT type FROM entities WHERE id=? AND vault_id=?',e.objectId,vault);if(owner&&owner.entity_id!==e.objectId||source&&source.type!=='source')throw invalid();}
  const entries=byMessage.get(messageId)??[];if(entries.length>=24)throw invalid();entries.push(e);byMessage.set(messageId,entries);
 }
 for(const row of rows.messages){const old=id(row.id),thread=id(row.thread_id),threadId=threadIds.get(thread),seq=integer(row.sequence);if(!threadId||seq>=200||messageIds.has(old)||sequences.get(thread)!.has(seq))throw invalid();sequences.get(thread)!.add(seq);const r=parse(row.payload);if(r.id!==old||!['user','assistant'].includes(String(r.role)))throw invalid();
  const key=randomUUID();messageIds.set(old,key);const message:ChatMessage={id:key,role:r.role as ChatMessage['role'],text:str(r.text,24000),createdAt:time(r.createdAt)};const evidence=byMessage.get(old)??[],validIds=new Set(evidence.map(e=>e.id));
  if(r.status!==undefined){if(!['completed','interrupted','failed'].includes(String(r.status)))throw invalid();message.status=r.status as ChatMessage['status'];}
  if(r.mentions!==undefined)message.mentions=array(r.mentions,12).map(x=>{const m=record(x);return {id:remap(maps.entities,m.id,'entity'),name:str(m.name,200)};});
  if(r.claims!==undefined){if(message.role!=='assistant')throw invalid();message.claims=array(r.claims,12).map(x=>{const c=record(x);if(!['supported','inferred','unestablished'].includes(String(c.attribution)))throw invalid();const citationIds=array(c.citationIds,12).map(x=>id(x));if(new Set(citationIds).size!==citationIds.length||citationIds.some(x=>!validIds.has(x))||c.attribution!=='unestablished'&&!citationIds.length||c.attribution==='unestablished'&&citationIds.length)throw invalid();if(!str(c.text,2000).trim()||/https?:\/\/|\]\s*\(|\[E\d+\]/i.test(str(c.text,2000)))throw invalid();return {text:str(c.text,2000),attribution:c.attribution as 'supported'|'inferred'|'unestablished',citationIds};});}
  if(r.searchDepth!==undefined){if(message.role!=='user'||!['standard','deep'].includes(String(r.searchDepth)))throw invalid();message.searchDepth=r.searchDepth as 'standard'|'deep';}
  if(message.role==='user'&&evidence.length)throw invalid();
  store.run('INSERT INTO chat_messages(id,thread_id,sequence,payload) VALUES(?,?,?,?)',key,threadId,seq,JSON.stringify(message));for(const e of evidence)store.run('INSERT INTO chat_evidence(message_id,evidence_id,snapshot) VALUES(?,?,?)',key,e.id,JSON.stringify(e));
 }
 for(const key of byMessage.keys())if(!messageIds.has(key))throw invalid();
 for(const values of sequences.values()){const sorted=[...values].sort((a,b)=>a-b);if(sorted.some((x,i)=>x!==i))throw invalid();}
}
