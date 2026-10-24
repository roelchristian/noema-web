import {createHash} from 'node:crypto';
import {DOMAINS,TAXONOMY_VERSION} from '../../shared/domains.js';
import {scholarlyDisciplineProperty,scholarlyEnrichmentVersion,scholarlyRelationshipKinds,type SourceScholarlyResult} from '../../shared/source-scholarly.js';
import type {PropertyProposal} from '../../shared/property-provenance.js';
import type {SourceFile} from '../../shared/domain.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {sourceEnrichmentText} from './source-enrichment-prompt.js';
import {proposeValue,rawSourceHash} from './property-provenance.js';
import type {Intelligence} from './intelligence.js';
import type {AIActivityLog} from './ai-activity.js';
import {AINotifications} from './ai-notifications.js';

type Candidate={id:string;name:string;type:string};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Reject invented targets/evidence before any proposal is saved. */
export function parseSourceScholarly(output:string,text:string,candidates:Candidate[],originalText=text):SourceScholarlyResult {
 try {
  const value=JSON.parse(output);
  const bounded=(input:unknown,limit:number,empty=false):input is string=>typeof input==='string'&&input.length<=limit&&(empty||!!input.trim());
  const evidence=(input:unknown):input is string=>bounded(input,1000)&&text.includes(input)&&originalText.includes(input);
  if(!value||!value.synopsis||!bounded(value.synopsis.text,2000)||!bounded(value.synopsis.method,1000,true)||!bounded(value.synopsis.conclusions,1000,true)||!evidence(value.synopsis.quote))throw new Error();
  if(!Array.isArray(value.disciplines)||value.disciplines.length>3||!Array.isArray(value.concepts)||value.concepts.length>5||!Array.isArray(value.relationships)||value.relationships.length>5)throw new Error();
  for(const item of value.disciplines)if(!item||!DOMAINS.some(domain=>domain.id===item.domainId)||!evidence(item.quote))throw new Error();
  for(const item of value.concepts)if(!item||!candidates.some(entity=>entity.id===item.entityId&&entity.type==='concept')||!evidence(item.quote))throw new Error();
  for(const item of value.relationships)if(!item||!candidates.some(entity=>entity.id===item.entityId&&['source','creativework'].includes(entity.type))||!scholarlyRelationshipKinds.includes(item.kind)||!evidence(item.quote))throw new Error();
  return value;
 }catch {throw new HttpError(502,'AI returned unsupported scholarly proposals. No proposals were saved.');}
}

/** On-demand only. Shares the existing provider, activity, provenance and explicit review queue. */
export class SourceScholarly {
 private controllers=new Set<AbortController>();
 private active=new Set<string>();
 constructor(private store:Store,private intelligence:Pick<Intelligence,'selection'|'generate'>,private activity:AIActivityLog) {}
 private snapshot(vault:string,id:string) {
  const source=this.store.get<{id:string;name:string;type:string;archived_at:string|null;locked:number}>(`SELECT e.id,e.name,e.type,e.archived_at,v.locked FROM entities e JOIN vaults v ON v.id=e.vault_id WHERE e.id=? AND e.vault_id=?`,id,vault);
  if(!source||source.type!=='source'||source.archived_at)throw new HttpError(404,'Active Source not found.');
  if(source.locked)throw new HttpError(423,'Unlock this vault first.');
  const file=this.store.get<SourceFile>(`SELECT * FROM source_files WHERE entity_id=? AND vault_id=? AND status='ready' AND admitted=1 AND trim(text)<>'' ORDER BY created_at,id LIMIT 1`,id,vault);
  if(!file)throw new HttpError(409,'Scholarly interpretation requires an attached processed document. Metadata alone does not establish a work’s arguments.');
  const hasBibliography=this.store.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bibliographic_records'");
  const bibliographic=hasBibliography?this.store.get('SELECT revision,fields_json,entry_type,citation_key FROM bibliographic_records WHERE source_id=?',id)??null:null;
  return {source,file,bibliographic};
 }
 async run(vault:string,id:string,body:Record<string,unknown>,signal?:AbortSignal) {
  if(body.confirmRemote!==true)throw new HttpError(400,'Confirm sending source excerpts and bibliographic metadata to your configured AI provider; this may incur a charge.');
  if(signal?.aborted)throw new HttpError(499,'Scholarly enrichment stopped.');
  const initial=this.snapshot(vault,id),selection=this.intelligence.selection();
  const candidates=this.store.all<Candidate>(`SELECT id,name,type FROM entities WHERE vault_id=? AND id<>? AND archived_at IS NULL AND inactive=0 AND type IN ('concept','source','creativework') ORDER BY name,id LIMIT 150`,vault,id);
  const fingerprint=digest([scholarlyEnrichmentVersion,TAXONOMY_VERSION,rawSourceHash(initial.file.text),initial.file.id,initial.source.name,initial.bibliographic,candidates,selection]);
  const marker=`${scholarlyEnrichmentVersion}:${fingerprint}`;
  const cached=this.store.all<PropertyProposal>("SELECT * FROM property_proposals WHERE entity_id=? AND vault_id=? AND instr(details,?)>0 ORDER BY id",id,vault,marker);
  if(cached.length)return {cached:true,proposals:cached,basis:'document-excerpts' as const};
  const key=JSON.stringify([vault,id]);
  if(this.active.has(key))throw new HttpError(409,'Scholarly enrichment for this Source is already running.');
  this.active.add(key);
  const controller=new AbortController(),abort=()=>controller.abort();this.controllers.add(controller);signal?.addEventListener('abort',abort,{once:true});
  const activityId=this.activity.start('source_enrichment',selection,vault,id,'entity');
  try {
   const text=sourceEnrichmentText(initial.file.text);
   const input=JSON.stringify({basis:'document-excerpts',source:{name:initial.source.name,bibliographic:initial.bibliographic},untrusted_source_excerpts:text,existing_entities:candidates,disciplines:DOMAINS.map(domain=>({id:domain.id,label:domain.label}))});
   const output=await this.intelligence.generate({kind:'sourceScholarly',input,signal:controller.signal,onRequest:bytes=>this.activity.request(activityId,bytes,null)});
   if(controller.signal.aborted)throw new HttpError(499,'Scholarly enrichment stopped.');
   const parsed=parseSourceScholarly(output,text,candidates,initial.file.text);
   const proposals=this.store.transaction(()=>{
    const current=this.snapshot(vault,id);
    if(digest([current.file.id,current.file.text,current.source.name,current.bibliographic])!==digest([initial.file.id,initial.file.text,initial.source.name,initial.bibliographic]))throw new HttpError(409,'The Source changed while enriching. Review its current contents and retry.');
    for(const item of [...parsed.concepts,...parsed.relationships]) {
     const target=this.store.get<Candidate>('SELECT id,name,type FROM entities WHERE id=? AND vault_id=? AND archived_at IS NULL AND inactive=0',item.entityId,vault);
     if(!target||digest(target)!==digest(candidates.find(candidate=>candidate.id===item.entityId)))throw new HttpError(409,'A proposed target changed while enriching. Retry with current entities.');
    }
    const details=(quote:string)=>`${marker}\nAI interpretation from supplied document excerpts only; not an author abstract. Evidence: ${quote}`;
    const propose=(property_name:string,value:string|null,target_id:string|null,quote:string)=>proposeValue(this.store,vault,{entity_id:id,property_name,value,target_id,origin:'ai',source_file_id:initial.file.id,source_hash:rawSourceHash(initial.file.text),details:details(quote)});
    const result=[propose('ai scholarly synopsis',JSON.stringify({basis:'document-excerpts',enrichmentFingerprint:fingerprint,...parsed.synopsis,suggestedDisciplines:parsed.disciplines}),null,parsed.synopsis.quote)];
    for(const item of parsed.disciplines)result.push(propose(scholarlyDisciplineProperty,JSON.stringify({domainId:item.domainId,label:DOMAINS.find(domain=>domain.id===item.domainId)!.label,taxonomyVersion:TAXONOMY_VERSION,bibliographicRevision:(initial.bibliographic as {revision:number}|null)?.revision??null}),null,item.quote));
    for(const item of parsed.concepts)result.push(propose('discusses concept',null,item.entityId,item.quote));
    for(const item of parsed.relationships)result.push(propose(`scholarly ${item.kind.replaceAll('_',' ')}`,null,item.entityId,item.quote));
    return result;
   });
   new AINotifications(this.store).recordSource(vault,id,'completed','source_enrichment');
   this.activity.finish(activityId,'completed',200);
   return {cached:false,proposals,basis:'document-excerpts' as const};
  }catch(error){this.activity.finish(activityId,controller.signal.aborted?'interrupted':'failed',error instanceof HttpError?error.status:502);throw error;}
  finally{signal?.removeEventListener('abort',abort);this.controllers.delete(controller);this.active.delete(key);}
 }
 close(){for(const controller of this.controllers)controller.abort();}
}
