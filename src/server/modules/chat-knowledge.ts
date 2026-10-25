import {createHash} from 'node:crypto';
import type {ChatEvidence,ChatMention} from '../../shared/chat.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';

export const chatFingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface EntityRow {id:string;name:string;description:string;type:string;updated_at:string}
export interface ChatKnowledgeContext {entityIds:string[];pageIds:string[];sourceIds:string[];evidence:ChatEvidence[]}
const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
/** Deterministic read-only entity operations. Graph expansion is exactly one hop;
 * associated/mentioned pages are direct root matches, not recursive traversal. */
export class ChatKnowledge {
 constructor(private store:Store){}
 resolveEntities(vault:string,question:string,mentions:ChatMention[]=[]):EntityRow[]{
  const found=new Map<string,EntityRow>(),explicitNames=new Set<string>();
  for(const mention of mentions){
   if(!mention||typeof mention.id!=='string'||mention.id.length>200)throw new HttpError(400,'Choose a valid entity mention.');
   const entity=this.store.get<EntityRow>('SELECT id,name,description,type,updated_at FROM entities WHERE id=? AND vault_id=? AND inactive=0',mention.id,vault);
   if(!entity)throw new HttpError(400,'A mentioned entity is unavailable in this vault.');
   found.set(entity.id,entity);
   explicitNames.add(normalize(entity.name));
   const aliases=this.store.get<{aliases:string}>('SELECT aliases FROM entities WHERE id=? AND vault_id=?',entity.id,vault);
   try{for(const alias of JSON.parse(aliases?.aliases??'[]') as unknown[])if(typeof alias==='string')explicitNames.add(normalize(alias));}catch{/* No aliases. */}
  }
  // Exact names/aliases only; all ambiguous exact matches remain distinct.
  const candidates=this.store.all<EntityRow & {aliases:string}>(`SELECT id,name,description,type,updated_at,aliases FROM entities WHERE vault_id=? AND inactive=0 AND
   (instr(lower(?),lower(name))>0 OR EXISTS(SELECT 1 FROM json_each(aliases) a WHERE instr(lower(?),lower(a.value))>0)) ORDER BY length(name) DESC,id LIMIT 30`,vault,question,question);
  const text=` ${normalize(question).replace(/[^\p{L}\p{N}\p{M}]+/gu,' ')} `;
  for(const candidate of candidates){
   let aliases:string[]=[];try{const value:unknown=JSON.parse(candidate.aliases);if(Array.isArray(value))aliases=value.filter((item):item is string=>typeof item==='string');}catch{/* No aliases. */}
   // A resolved ID disambiguates its canonical name and aliases. Other exact
   // namesakes remain available only when separately mentioned by ID.
   if(!found.has(candidate.id)&&[candidate.name,...aliases].some(name=>explicitNames.has(normalize(name))))continue;
   if([candidate.name,...aliases].some(name=>name.trim()&&text.includes(` ${normalize(name).replace(/[^\p{L}\p{N}\p{M}]+/gu,' ')} `)))found.set(candidate.id,candidate);
  }
  return [...found.values()].slice(0,8);
 }
 get(vault:string,ids:string[]):ChatKnowledgeContext {
  const rootIds=[...new Set(ids)].slice(0,8),pageIds=new Set<string>(),sourceIds=new Set<string>(),evidence:ChatEvidence[]=[];
  for(const id of rootIds){
   const entity=this.store.get<EntityRow>('SELECT id,name,description,type,updated_at FROM entities WHERE id=? AND vault_id=? AND inactive=0',id,vault);
   if(!entity)throw new HttpError(404,'Entity is unavailable in this vault.');
   if(entity.type==='source')sourceIds.add(id);
   if(entity.description.trim())evidence.push(this.record(id,entity.name,'description',entity.description,'entity_fact'));
   const overview=this.store.get<{content:string;revision:number}>('SELECT content,revision FROM entity_overviews WHERE entity_id=?',id);
   if(overview?.content.trim())evidence.push({...this.record(id,entity.name,'overview',overview.content.slice(0,6000),'entity_overview'),revision:overview.revision,fingerprint:chatFingerprint([overview.revision,overview.content])});
   const properties=this.store.all<{id:string;name:string;value:string|null;target_id:string|null;targetName:string|null;targetType:string|null}>(`SELECT p.id,p.name,p.value,p.target_id,t.name AS targetName,t.type AS targetType FROM properties p
    LEFT JOIN entities t ON t.id=p.target_id AND t.vault_id=? AND t.inactive=0 WHERE p.entity_id=? AND (p.target_id IS NULL OR t.id IS NOT NULL) ORDER BY p.name,p.id LIMIT 24`,vault,id);
   for(const property of properties){
    evidence.push(this.record(id,entity.name,`property:${property.id}`,`${entity.name} — ${property.name}: ${property.targetName??property.value??''}`,'entity_fact'));
    if(property.targetType==='source'&&property.target_id)sourceIds.add(property.target_id);
   }
   const relations=this.store.all<{id:string;source_id:string;target_id:string;label:string;sourceName:string;targetName:string;sourceType:string;targetType:string}>(`SELECT r.*,s.name AS sourceName,t.name AS targetName,s.type AS sourceType,t.type AS targetType FROM relationships r
    JOIN entities s ON s.id=r.source_id AND s.vault_id=? AND s.inactive=0 JOIN entities t ON t.id=r.target_id AND t.vault_id=? AND t.inactive=0
    WHERE r.source_id=? OR r.target_id=? ORDER BY r.label,r.id LIMIT 24`,vault,vault,id,id);
   for(const relation of relations){
    evidence.push(this.record(id,entity.name,`relationship:${relation.id}`,`${relation.sourceName} — ${relation.label} → ${relation.targetName}`,'entity_fact'));
    if(relation.sourceType==='source')sourceIds.add(relation.source_id);
    if(relation.targetType==='source')sourceIds.add(relation.target_id);
   }
   const incoming=this.store.all<{id:string;name:string;sourceName:string;sourceType:string;entity_id:string}>(`SELECT p.id,p.name,p.entity_id,s.name AS sourceName,s.type AS sourceType FROM properties p JOIN entities s ON s.id=p.entity_id
    WHERE p.target_id=? AND s.vault_id=? AND s.inactive=0 ORDER BY p.name,p.id LIMIT 24`,id,vault);
   for(const property of incoming){
    evidence.push(this.record(id,entity.name,`incoming:${property.id}`,`${property.sourceName} — ${property.name} → ${entity.name}`,'entity_fact'));
    if(property.sourceType==='source')sourceIds.add(property.entity_id);
   }
   const pages=this.store.all<{id:string}>(`SELECT DISTINCT p.id FROM pages p WHERE p.vault_id=? AND p.deleted_at IS NULL AND p.archived_at IS NULL AND
    (EXISTS(SELECT 1 FROM entity_page_associations a WHERE a.entity_id=? AND a.page_id=p.id) OR EXISTS(SELECT 1 FROM page_mentioned_entities m WHERE m.entity_id=? AND m.page_id=p.id)) ORDER BY p.id LIMIT 40`,vault,id,id);
   for(const page of pages)pageIds.add(page.id);
  }
  return {entityIds:rootIds,pageIds:[...pageIds].slice(0,160),sourceIds:[...sourceIds].slice(0,160),evidence};
 }
 private record(objectId:string,title:string,factId:string,excerpt:string,kind:'entity_fact'|'entity_overview'):ChatEvidence {
  const bounded=excerpt.slice(0,6000);
  return {id:'',kind,objectId,title,excerpt:bounded,factId,locator:factId==='overview'?'Entity overview':factId==='description'?'Entity description':factId,fingerprint:chatFingerprint([objectId,title,factId,excerpt]),status:'current'};
 }
 /** Recreate only the recorded fact; unrelated fact changes do not stale it. */
 validate(vault:string,item:ChatEvidence):ChatEvidence['status'] {
  const entity=this.store.get<{name:string;inactive:number}>('SELECT name,inactive FROM entities WHERE id=? AND vault_id=?',item.objectId,vault);
  if(!entity||entity.inactive)return 'deleted';
  if(item.reference!==undefined||item.pageReference!==undefined||item.origin!==undefined||item.title!==entity.name)return 'stale';
  if(item.kind==='entity_overview'){
   const overview=this.store.get<{content:string;revision:number}>('SELECT content,revision FROM entity_overviews WHERE entity_id=?',item.objectId);
   return !overview?'deleted':overview.revision===item.revision&&item.factId==='overview'&&item.locator==='Entity overview'&&item.excerpt===overview.content.slice(0,6000)&&chatFingerprint([overview.revision,overview.content])===item.fingerprint?'current':'stale';
  }
  const current=this.get(vault,[item.objectId]).evidence.find(candidate=>candidate.kind===item.kind&&candidate.factId===item.factId);
  return !current?'deleted':item.revision===undefined&&current.excerpt===item.excerpt&&current.locator===item.locator&&current.fingerprint===item.fingerprint?'current':'stale';
 }
}
