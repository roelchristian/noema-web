import {domainById,TAXONOMY_VERSION} from '../../shared/domains.js';
import {isScholarlyDisciplineProposal,parseScholarlyDiscipline} from '../../shared/source-scholarly.js';
import {Domains} from './domains.js';
import {createHash} from 'node:crypto';
import type {Entity,Property,PropertyInput} from '../../shared/domain.js';
import type {PropertyDefinition} from '../../shared/property-definitions.js';
import {propertyDefinitionSignature,propertyDefinitionConflicts,resolvePropertyDefinition} from '../../shared/property-definitions.js';
import type {PropertyProposal} from '../../shared/property-provenance.js';
import {Store} from '../store.js';
import {validatePropertyValue} from '../../shared/property-values.js';
import {HttpError,now,required} from '../validation.js';
import {bindPropertyDefinition} from './property-storage.js';
import {TemporalProperties} from './temporal-properties.js';
import {assertNoHierarchyCycle} from './entity-classification-impact.js';
import {Knowledge} from './knowledge.js';
import {rawSourceHash,recordPropertyProvenance,recordEntityNameProvenance} from './property-provenance.js';

export interface ProposalReview extends PropertyProposal {
 stale:boolean;staleReason:string|null;fingerprint:string;conflicts:Property[];currentName:string;definition?:PropertyDefinition;sourceName?:string;
}
export interface PropertyReviewInput {action:'accept'|'reject'|'retain_both';fingerprint:string;target_id?:string}
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
type SourceState={id:string;entity_id:string|null;name:string;text:string;status:string;admitted:number;vault_id:string;source_url:string|null;import_method:string};

/** Read-only previews and transactional explicit review. Extraction never invokes this user action. */
export class PropertyReview {
 constructor(private store:Store) {}
 private entity(vault:string,id:string) {
  const row=this.store.get<Entity&{subtypes:string}>('SELECT * FROM entities WHERE id=? AND vault_id=?',id,vault);
  if(!row)throw new HttpError(404,'Entity not found');
  return {...row,subtypes:JSON.parse(row.subtypes) as string[]};
 }
 private preview(vault:string,proposal:PropertyProposal):ProposalReview {
  const entity=this.entity(vault,proposal.entity_id);
  const discipline=isScholarlyDisciplineProposal(proposal);
  const taxonomyProposal=discipline?parseScholarlyDiscipline(proposal.value):null;
  const domains=discipline?this.store.all('SELECT domain_id,origin FROM entity_domains WHERE entity_id=? ORDER BY domain_id',entity.id):null;
  const bibliographic=discipline&&this.store.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bibliographic_records'")?this.store.get<{revision:number}>('SELECT revision FROM bibliographic_records WHERE source_id=? AND vault_id=?',entity.id,vault):undefined;
  const properties=this.store.all<Property&{definition_id:string|null}>('SELECT p.*,m.definition_id FROM properties p LEFT JOIN property_value_metadata m ON m.property_id=p.id WHERE p.entity_id=? ORDER BY p.id',entity.id);
  const definitions=this.store.all<{definition_json:string}>('SELECT definition_json FROM property_definitions WHERE vault_id=? ORDER BY id',vault).map(row=>JSON.parse(row.definition_json) as PropertyDefinition);
  const definition=proposal.kind==='property'&&proposal.property_name?resolvePropertyDefinition(definitions,entity.type,entity.subtypes,proposal.property_name,proposal.property_id?properties.find(item=>item.id===proposal.property_id)?.definition_id??undefined:undefined):undefined;
  const conflicts=proposal.kind==='entity_name'?[]:properties.filter(property=>{
   const bound=resolvePropertyDefinition(definitions,entity.type,entity.subtypes,property.name,property.definition_id??undefined);
   return definition&&bound?definition.key===bound.key&&propertyDefinitionSignature(definition)===propertyDefinitionSignature(bound):property.name.toLowerCase()===proposal.property_name?.toLowerCase();
  });
  const source=proposal.source_file_id?this.store.get<SourceState>('SELECT id,entity_id,name,text,status,admitted,vault_id,source_url,import_method FROM source_files WHERE id=? AND vault_id=?',proposal.source_file_id,vault):undefined;
  let staleReason:string|null=null;
  if(proposal.source_file_id||proposal.source_hash||proposal.origin==='imported'&&['Source URL','Import method'].includes(proposal.property_name??'')) {
   if(!source||!source.entity_id||entity.type==='source'&&source.entity_id!==entity.id)staleReason='The source file is no longer attached to an available source entity.';
   else if(proposal.origin==='imported'&&proposal.property_name==='Source URL') {if(source.source_url!==proposal.value)staleReason='The imported source URL changed.';}
   else if(proposal.origin==='imported'&&proposal.property_name==='Import method') {if(source.import_method!==proposal.value)staleReason='The import method changed.';}
   else if(source.status!=='ready'||!source.admitted)staleReason='The source is not currently available for evidence review.';
   else if(!proposal.source_hash||rawSourceHash(source.text)!==proposal.source_hash)staleReason='The source content changed after this value was extracted.';
  }
  if(discipline) {
   if(entity.type!=='source'||entity.archived_at||entity.inactive||proposal.origin!=='ai'||!proposal.source_file_id||!proposal.source_hash)staleReason='Disciplinary proposals require an active Source and document evidence.';
   else if(!taxonomyProposal||!domainById(taxonomyProposal.domainId)||taxonomyProposal.taxonomyVersion!==TAXONOMY_VERSION)staleReason='The disciplinary taxonomy changed or the proposal is invalid.';
   else if(taxonomyProposal.bibliographicRevision!==(bibliographic?.revision??null))staleReason='Bibliographic metadata changed after classification. Generate a fresh proposal.';
  }
  if(proposal.property_id&&!properties.some(property=>property.id===proposal.property_id))staleReason='The original authored value was removed.';
  const target=proposal.target_id?this.store.get('SELECT id,type,subtypes,archived_at,updated_at FROM entities WHERE id=? AND vault_id=?',proposal.target_id,vault):undefined;
  if(proposal.target_id&&!target||proposal.kind==='property'&&proposal.target_id===null&&proposal.value===null)staleReason='The proposed value or reference target is unavailable.';
  const fingerprint=createHash('sha256').update(stable([proposal,entity,properties,definitions,source?{...source,text:rawSourceHash(source.text)}:null,target??null,domains,bibliographic??null,discipline?TAXONOMY_VERSION:null])).digest('hex');
  return {...proposal,stale:staleReason!==null,staleReason,fingerprint,conflicts,currentName:entity.name,definition,...source?{sourceName:source.name}:{}};
 }
 list(vault:string,entityId:string,status='pending',proposalId?:string):ProposalReview[] {
  this.entity(vault,entityId);
  if(!['pending','accepted','rejected','all'].includes(status))throw new HttpError(400,'Unknown proposal status.');
  if(proposalId){const proposal=this.store.get<PropertyProposal>('SELECT * FROM property_proposals WHERE id=? AND vault_id=? AND entity_id=?',proposalId,vault,entityId);return proposal&&(status==='all'||proposal.status===status)?[this.preview(vault,proposal)]:[];}
  return this.store.all<PropertyProposal>(`SELECT * FROM property_proposals WHERE vault_id=? AND entity_id=? ${status==='all'?'':'AND status=?'} ORDER BY created_at,id LIMIT 100`,...status==='all'?[vault,entityId]:[vault,entityId,status]).map(proposal=>this.preview(vault,proposal));
 }
 review(vault:string,entityId:string,proposalId:string,input:PropertyReviewInput):ProposalReview {
  if(!['accept','reject','retain_both'].includes(input.action)||typeof input.fingerprint!=='string'||!input.fingerprint)throw new HttpError(400,'Choose a review action with its current fingerprint.');
  const apply=()=>{
   const proposal=this.store.get<PropertyProposal>('SELECT * FROM property_proposals WHERE id=? AND vault_id=? AND entity_id=?',proposalId,vault,entityId);
   if(!proposal)throw new HttpError(404,'Property proposal not found');
   const current=this.preview(vault,proposal);
   if(proposal.status!=='pending') {
    if(proposal.status===(input.action==='reject'?'rejected':'accepted'))return current;
    throw new HttpError(409,'This proposal already has a different review decision.');
   }
   if(input.fingerprint!==current.fingerprint)throw new HttpError(409,'The entity, values or evidence changed. Review a fresh preview.');
   if(input.action!=='reject'&&current.stale)throw new HttpError(409,current.staleReason??'This proposal is stale.');
   let decisionDetails='';
   if(input.action!=='reject') {
    const knowledge=new Knowledge(this.store),entity=this.entity(vault,entityId);
    if(isScholarlyDisciplineProposal(proposal)) {
     if(input.target_id!==undefined)throw new HttpError(400,'A disciplinary proposal applies its reviewed Domain ID only.');
     const discipline=parseScholarlyDiscipline(proposal.value);
     if(!discipline)throw new HttpError(409,'Invalid disciplinary proposal. Generate a fresh proposal.');
     new Domains(this.store).acceptSourceDiscipline(vault,entityId,discipline.domainId,discipline.taxonomyVersion);
     decisionDetails='Accepted canonical disciplinary Domain ID: '+discipline.domainId+'. ';
    } else if(proposal.kind==='entity_name') {
     if(input.action==='retain_both')throw new HttpError(400,'An entity has one canonical name. Accept the proposed name or keep the existing name by rejecting it.');
     const name=required(proposal.value);knowledge.update(vault,entityId,{...knowledge.require(vault,entityId),name});
     recordEntityNameProvenance(this.store,vault,entityId,{origin:'manual',source_file_id:proposal.source_file_id??undefined,source_hash:proposal.source_hash??undefined,details:'User approved a proposed name. '+proposal.details});
    } else {
     const name=required(proposal.property_name),definition=current.definition;
     const inherited=knowledge.schema(vault).propertyDefinitions?.filter(item=>item.scope.type===entity.type&&(item.scope.kind==='main_type'||entity.subtypes.includes(item.scope.subtypeId)))??[];
     if(definition&&propertyDefinitionConflicts(inherited).some(conflict=>conflict.key===definition.key))throw new HttpError(409,'Conflicting inherited definitions require schema review before accepting a value.');
     const target=input.target_id===undefined?proposal.target_id:required(input.target_id);
     const value=target?null:proposal.value;
     if(!target&&typeof value!=='string')throw new HttpError(400,'The proposal has no value to accept.');
     const selectedTarget=target?knowledge.find(vault,target):undefined;
     if(target&&!selectedTarget)throw new HttpError(400,'Choose a target from this vault.');
     if(target)assertNoHierarchyCycle(this.store,vault,entityId,target,definition??name);
     if(definition){const error=validatePropertyValue(definition,{name,value,target_id:target??null},selectedTarget);if(error)throw new HttpError(400,error);}
     if(target)decisionDetails='Resolved reference target: '+target+'. ';
     const same=current.conflicts.find(property=>property.target_id===(target??null)&&property.value===value);
     if(!same) {
      if(current.conflicts.length&&definition?.cardinality==='one'&&input.action!=='retain_both')throw new HttpError(409,'This single-value field already has authored knowledge. Choose retain both to preserve all evidence.');
      const before=new Set(this.store.all<{id:string}>('SELECT id FROM properties WHERE entity_id=?',entityId).map(row=>row.id));
      const body:PropertyInput=target?{name,target_id:target}:{name,value:value!};
      if(definition&&definition.editable&&input.action!=='retain_both')body.definition_id=definition.id;
      knowledge.property(vault,entityId,body,undefined,{nativeTemporalAssertion:false});
      const added=this.store.all<{id:string}>('SELECT id FROM properties WHERE entity_id=?',entityId).find(row=>!before.has(row.id));
      if(added&&definition){bindPropertyDefinition(this.store,vault,added.id,definition.id);if(definition.valueKind==='date')new TemporalProperties(this.store).refresh(vault,1,added.id);}
      if(added)decisionDetails+='Accepted property: '+added.id+'. ';
      if(added)recordPropertyProvenance(this.store,vault,added.id,{origin:proposal.origin,source_file_id:proposal.source_file_id??undefined,source_hash:proposal.source_hash??undefined,details:'User approved this proposal. '+proposal.details});
     }
    }
   }
   this.store.run('UPDATE property_proposals SET status=?,updated_at=?,details=? WHERE id=? AND vault_id=?',input.action==='reject'?'rejected':'accepted',now(),proposal.details+(decisionDetails?'\nReview decision: '+decisionDetails:''),proposalId,vault);
   return this.preview(vault,this.store.get<PropertyProposal>('SELECT * FROM property_proposals WHERE id=? AND vault_id=?',proposalId,vault)!);
  };
  return this.store.db.isTransaction?apply():this.store.transaction(apply);
 }
}
