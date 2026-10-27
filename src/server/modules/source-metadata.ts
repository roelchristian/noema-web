import {createHash} from 'node:crypto';
import type {Property,SourceFile} from '../../shared/domain.js';
import type {PropertyProposal} from '../../shared/property-provenance.js';
import type {MetadataRegistration,MetadataCandidate,MetadataEvidence,MetadataField,MetadataProposal,MetadataReviewInput,MetadataBatchInput,MetadataBatchResult,SourceMetadataSnapshot,SourceMetadataPolicy} from '../../shared/source-metadata.js';
import {normalizeDoi,bibliographyCreators} from '../../shared/bibliography.js';
import {normalizeEntityName} from '../../shared/auto-entities.js';
import {Store} from '../store.js';
import {HttpError,now,required,text} from '../validation.js';
import {Bibliography} from './bibliography.js';
import {Knowledge} from './knowledge.js';
import {PropertyReview} from './property-review.js';
import {bibliographicLegacyConflicts} from './bibliographic-property-projection.js';
import {proposeValue,rawSourceHash,getNameProvenance} from './property-provenance.js';
import {metadataEvidenceStaleReason} from './source-metadata-evidence.js';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sourceMetadataFieldFingerprint=(sourceId:string,key:string,value:string|null,targetId:string|null,preservedValues:MetadataField['preservedValues'],provenance:unknown)=>digest([sourceId,key,value,targetId,preservedValues,provenance]);
export {sourceMetadataCanonicalField,sourceMetadataBibliographicOwner} from '../../shared/source-metadata.js';
import {sourceMetadataCanonicalField,sourceMetadataBibliographicOwner} from '../../shared/source-metadata.js';
const labels:Record<string,string>={title:'Bibliographic title',author:'Credited authors',editor:'Credited editors',translator:'Credited translators',year:'Publication year',date:'Publication date',publisher:'Publisher',edition:'Edition',doi:'DOI',isbn:'ISBN',issn:'ISSN',journal:'Journal',booktitle:'Container title',volume:'Volume',issue:'Issue',pages:'Pages',series:'Series',url:'Publication URL',abstract:'Author abstract',language:'Publication language'};
const aliases:Record<string,string>={'publication title':'title',title:'title',author:'author',authors:'author',editor:'editor',editors:'editor',translator:'translator',translators:'translator',publisher:'publisher',doi:'doi',isbn:'isbn',issn:'issn',edition:'edition','publication date':'date','publication year':'year',published:'date',year:'year',journal:'journal',journaltitle:'journal','journal title':'journal',volume:'volume',issue:'issue',number:'issue',pages:'pages','page range':'pages','book title':'booktitle','container title':'booktitle',series:'series',url:'url',abstract:'abstract','author abstract':'abstract'};
type CandidateRow={proposal_id:string;field_key:string;target_fingerprint:string;evidence_json:string;decision_json:string;status:MetadataProposal['status']};
const equal=(key:string,a:string|null,b:string|null)=>key==='bibliography:doi'&&a&&b?!!normalizeDoi(a)&&normalizeDoi(a)===normalizeDoi(b):a===b;

/** One reconciliation adapter dispatches writes to the pre-existing canonical owners. */
export class SourceMetadata {
 constructor(private store:Store) {}
 private transaction<T>(work:()=>T):T{return this.store.db.isTransaction?work():this.store.transaction(work);}
 private source(vault:string,id:string){const entity=new Knowledge(this.store).require(vault,id);if(entity.type!=='source'||entity.archived_at)throw new HttpError(404,'Source not found');return entity;}
 policy(vault:string,id:string):SourceMetadataPolicy{this.source(vault,id);return this.store.get<{policy:SourceMetadataPolicy}>('SELECT policy FROM source_metadata_policies WHERE source_id=? AND vault_id=?',id,vault)?.policy??'review';}
 setPolicy(vault:string,id:string,value:unknown){this.source(vault,id);if(value!=='review'&&value!=='fill_validated_empty')throw new HttpError(400,'Unknown metadata acceptance policy');this.store.run('INSERT INTO source_metadata_policies(source_id,vault_id,policy) VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET policy=excluded.policy',id,vault,value);return this.snapshot(vault,id);}
 private key(proposal:PropertyProposal){if(proposal.kind==='entity_name')return 'source:display_name';if(proposal.property_name?.startsWith('bibliography:'))return 'bibliography:'+sourceMetadataCanonicalField(proposal.property_name.slice(13));const field=!proposal.target_id?aliases[proposal.property_name?.toLowerCase()??'']:undefined;return field?'bibliography:'+sourceMetadataCanonicalField(field):'property:'+proposal.property_name;}
 private fields(vault:string,id:string):MetadataField[]{
  const entity=this.source(vault,id),bibliography=new Bibliography(this.store).get(vault,id),result:MetadataField[]=[];
  const add=(key:string,label:string,owner:MetadataField['owner'],value:string|null,targetId:string|null=null,editable=true)=>result.push({key,label,owner,value,targetId,editable,fingerprint:'',proposals:[],history:[]});
  add('source:display_name','Source display name','source',entity.name);
  for(const field of new Set([...Object.keys(labels),...Object.keys(bibliography?.fields??{})].map(sourceMetadataCanonicalField))){const owner=sourceMetadataBibliographicOwner(bibliography?.fields??{},field);add('bibliography:'+field,labels[field]??field,'bibliography',bibliography?.fields[owner]??null);}
  for(const property of this.store.all<Property>('SELECT * FROM properties WHERE entity_id=? ORDER BY name,id',id)){
   const creatorReference=!!property.target_id&&['author','authors','editor','editors','translator','translators'].includes(property.name.toLowerCase());
   const publication=!creatorReference&&aliases[property.name.toLowerCase()]?sourceMetadataCanonicalField(aliases[property.name.toLowerCase()]!):undefined;
   if(publication){const field=result.find(item=>item.key==='bibliography:'+publication)!;if(field)(field.preservedValues??=[]).push({id:property.id,name:property.name,value:property.value,target_id:property.target_id});if(!property.target_id)continue;}
   // Entity references are knowledge assertions, never parsed out of credited creator strings.
   const key='property:'+property.name;
   const present=result.find(item=>item.key===key);
   if(present){present.value=[present.value,property.value??property.target_id].filter(Boolean).join('; ');present.editable=false;}
   else add(key,property.name+(property.target_id?' (resolved entity)':''),'property',property.value,property.target_id,!property.target_id);
  }
  for(const file of this.store.all<SourceFile>('SELECT * FROM source_files WHERE entity_id=? AND vault_id=? ORDER BY id',id,vault)){
   add('attachment:'+file.id+':source_url',file.name+' · import URL','attachment',file.source_url);
   add('attachment:'+file.id+':language',file.name+' · language','attachment',file.language,null,false);
   add('attachment:'+file.id+':format',file.name+' · format','attachment',file.format,null,false);
  }
  for(const field of result){
   if(field.targetId)field.targetName=this.store.get<{name:string}>('SELECT name FROM entities WHERE id=? AND vault_id=?',field.targetId,vault)?.name;
   if(field.owner==='bibliography'){const provenance=bibliography?.provenance[sourceMetadataBibliographicOwner(bibliography?.fields??{},field.key.slice(13))];if(provenance&&field.value!==null)field.confirmedHistory=[...(provenance.history??[]),{value:field.value,origin:provenance.origin,at:provenance.at}];}
   if(field.key==='source:display_name'){const provenance=getNameProvenance(this.store,vault,id);if(provenance)field.confirmedHistory=[{value:entity.name,origin:provenance.origin,at:provenance.updated_at,details:provenance.details}];}
   const propertyState=field.owner==='property'?this.store.all<Property&{definition_id:string|null;definition_json:string|null}>('SELECT p.*,m.definition_id,d.definition_json FROM properties p LEFT JOIN property_value_metadata m ON m.property_id=p.id LEFT JOIN property_definitions d ON d.id=m.definition_id WHERE p.entity_id=? AND p.name=? ORDER BY p.id',id,field.key.slice(9)):null;
   if(propertyState&&propertyState.length>1)field.displayValues=propertyState.map(property=>property.value??this.store.get<{name:string}>('SELECT name FROM entities WHERE id=? AND vault_id=?',property.target_id,vault)?.name??property.target_id??'');
   if(propertyState?.[0]?.definition_json){const definition=JSON.parse(propertyState[0].definition_json) as {editable:boolean;valueKind:string};if(!definition.editable||definition.valueKind==='entity_reference')field.editable=false;}
   field.fingerprint=sourceMetadataFieldFingerprint(id,field.key,field.value,field.targetId??null,field.preservedValues,field.owner==='bibliography'?bibliography?.provenance[sourceMetadataBibliographicOwner(bibliography?.fields??{},field.key.slice(13))]??null:propertyState);
  }
  return result;
 }
 private preview(vault:string,id:string,proposal:PropertyProposal,fields:MetadataField[]):MetadataProposal {
  const sidecar=this.store.get<CandidateRow>('SELECT * FROM source_metadata_candidates WHERE proposal_id=?',proposal.id),fieldKey=sidecar?'bibliography:'+sourceMetadataCanonicalField(sidecar.field_key.slice(13)):this.key(proposal),field=fields.find(item=>item.key===fieldKey);
  const evidence:MetadataEvidence[]=sidecar?JSON.parse(sidecar.evidence_json):[];
  let staleReason:string|null=null,legacyFingerprint='';
  if(sidecar){
   const reasons=evidence.map(item=>metadataEvidenceStaleReason(this.store,vault,id,item));
   staleReason=!evidence.length?'Document evidence is unavailable.':reasons.every(Boolean)?reasons[0]!:null;
   if(proposal.status==='pending'&&field?.fingerprint!==sidecar.target_fingerprint)staleReason='The target field changed after extraction.';
  }else {const legacy=new PropertyReview(this.store).list(vault,id,'all',proposal.id)[0];staleReason=legacy?.staleReason??null;legacyFingerprint=legacy?.fingerprint??'';}
  const satisfied=equal(fieldKey,field?.value??null,proposal.value)&&(!proposal.target_id||proposal.target_id===field?.targetId);
  const legacyConflict=field?.preservedValues?.some(item=>item.target_id||!equal(fieldKey,item.value,proposal.value))??false;
  const competing=!!this.store.get("SELECT 1 FROM property_proposals p JOIN source_metadata_candidates c ON c.proposal_id=p.id WHERE p.vault_id=? AND p.entity_id=? AND c.field_key=? AND c.status='pending' AND p.status='pending' AND p.id<>? AND p.value IS NOT ? LIMIT 1",vault,id,fieldKey,proposal.id,proposal.value);
  const compatible=!staleReason&&!legacyConflict&&!competing&&(satisfied||!field?.value&&!field?.targetId)&&!!sidecar&&evidence.some(item=>item.validated&&!metadataEvidenceStaleReason(this.store,vault,id,item));
  const decision=sidecar?.decision_json?JSON.parse(sidecar.decision_json) as {value?:string}:{};
  return {id:proposal.id,fieldKey,value:proposal.value,targetId:proposal.target_id,...decision.value!==undefined?{acceptedValue:decision.value}:{},status:sidecar?.status??proposal.status,fingerprint:digest([proposal,sidecar,field?.fingerprint,staleReason,legacyFingerprint]),stale:!!staleReason,staleReason,compatible,evidence,details:proposal.details,createdAt:proposal.created_at,updatedAt:proposal.updated_at};
 }
 snapshot(vault:string,id:string,runId?:string,proposalId?:string):SourceMetadataSnapshot {
  const fields=this.fields(vault,id),proposals=this.store.all<PropertyProposal>('SELECT * FROM property_proposals WHERE vault_id=? AND entity_id=? ORDER BY created_at,id',vault,id);
  for(const row of proposals){const proposal=this.preview(vault,id,row,fields);if(runId&&!proposal.evidence.some(item=>item.runId===runId)||proposalId&&proposal.id!==proposalId)continue;
   let field=fields.find(item=>item.key===proposal.fieldKey);if(!field){field={key:proposal.fieldKey,label:row.property_name??'Source display name',owner:'property',value:null,editable:false,fingerprint:digest([id,proposal.fieldKey,null]),proposals:[],history:[]};fields.push(field);}
   (proposal.status==='pending'?field.proposals:field.history).push(proposal);
  }
  for(const field of fields)if(new Set(field.proposals.map(proposal=>JSON.stringify([proposal.value,proposal.targetId]))).size>1)for(const proposal of field.proposals)proposal.compatible=false;
  const pending=fields.flatMap(field=>field.proposals);
  return {sourceId:id,policy:this.policy(vault,id),fields,counts:{confirmed:fields.filter(field=>field.value||field.targetId).length,suggested:pending.length,conflicts:pending.filter(proposal=>!proposal.compatible).length}};
 }
 private write(vault:string,id:string,fieldKey:string,value:string,targetId?:string,preserveAuthoredValues=false,origin:'manual'|'ai'='manual'){
  if(fieldKey.startsWith('bibliography:')){
   if(targetId)throw new HttpError(400,'Credited bibliographic names remain ordered text; resolve entities separately.');
   const requested=fieldKey.slice(13);if(!/^[a-z][a-z0-9_:.-]{0,63}$/i.test(requested))throw new HttpError(400,'Invalid bibliographic field');
   if(requested==='doi'&&value&&!normalizeDoi(value))throw new HttpError(400,'Invalid DOI');
   const bibliography=new Bibliography(this.store),record=bibliography.get(vault,id),selected=sourceMetadataBibliographicOwner(record?.fields??{},requested),field=selected==='date'&&!Object.hasOwn(record?.fields??{},'date')&&/^\d{4}$/.test(value)?'year':selected;
   bibliography.save(vault,id,{revision:record?.revision??0,citationKey:record?.citationKey??'source-'+id,entryType:record?.entryType??'misc',fields:{...record?.fields,[field]:value},...(preserveAuthoredValues?{reviewedProperties:bibliographicLegacyConflicts(this.store,vault,id,{...record?.fields,[field]:value},record?.fields).map(conflict=>({propertyId:conflict.property.id,fingerprint:conflict.fingerprint}))}:{})},origin);
   if(['author','editor','translator'].includes(field))this.offerCreatorReferences(vault,id,field,value);
  }else if(fieldKey==='source:display_name'){
   const knowledge=new Knowledge(this.store);knowledge.update(vault,id,{...knowledge.require(vault,id),name:required(value)});
  }else if(fieldKey.startsWith('attachment:')&&fieldKey.endsWith(':source_url')){
   const fileId=fieldKey.slice(11,-11);if(!this.store.get('SELECT 1 FROM source_files WHERE id=? AND entity_id=? AND vault_id=?',fileId,id,vault))throw new HttpError(409,'Attachment changed');
   if(value&&!/^https?:\/\//i.test(value))throw new HttpError(400,'Use an HTTP or HTTPS attachment URL');
   this.store.run('UPDATE source_files SET source_url=? WHERE id=? AND entity_id=? AND vault_id=?',value||null,fileId,id,vault);
  }else if(fieldKey.startsWith('property:')){
   const name=fieldKey.slice(9),existing=this.store.all<Property>('SELECT * FROM properties WHERE entity_id=? AND name=? ORDER BY id',id,name),binding=existing.length===1?this.store.get<{definition_id:string|null}>('SELECT definition_id FROM property_value_metadata WHERE property_id=?',existing[0]!.id):undefined;
   if(existing.length>1)throw new HttpError(409,'Use the property editor to review multiple values.');
   new Knowledge(this.store).property(vault,id,{name,...targetId?{target_id:targetId}:{value},...binding?.definition_id?{definition_id:binding.definition_id}:{}},existing[0]?.id);
  }else throw new HttpError(400,'This metadata field is read-only');
 }

 private offerCreatorReferences(vault:string,id:string,role:string,value:string){
  const candidates=this.store.all<{id:string;name:string;aliases:string}>("SELECT id,name,aliases FROM entities WHERE vault_id=? AND type IN ('person','organization') AND inactive=0 AND archived_at IS NULL",vault);
  for(const creator of bibliographyCreators({[role]:value})){
   const name=creator.literal??[creator.given,creator.prefix,creator.family,creator.suffix].filter(Boolean).join(' '),key=normalizeEntityName(name.normalize('NFC'));
   const matches=candidates.filter(candidate=>{let aliases:string[]=[];try{aliases=JSON.parse(candidate.aliases);}catch{}return [candidate.name,...aliases].some(value=>normalizeEntityName(value.normalize('NFC'))===key);});
   if(matches.length!==1)continue;const target=matches[0]!;
   if(this.store.get('SELECT 1 FROM properties WHERE entity_id=? AND name=? COLLATE NOCASE AND target_id=?',id,role,target.id))continue;
   proposeValue(this.store,vault,{entity_id:id,property_name:role,target_id:target.id,origin:'derived',details:'Canonical credited '+role+': '+name+'. Unique existing identity offered for explicit review; ordered bibliographic credits remain unchanged.'});
  }
 }
 save(vault:string,id:string,body:Record<string,unknown>){return this.transaction(()=>{const field=this.fields(vault,id).find(item=>item.key===body.fieldKey);if(!field||!field.editable)throw new HttpError(400,'This metadata field is read-only');if(field.fingerprint!==body.fingerprint)throw new HttpError(409,'The target field changed. Reload before saving.');this.write(vault,id,field.key,text(body.value),undefined,body.preserveAuthoredValues===true);return this.snapshot(vault,id);});}
 private apply(vault:string,id:string,input:MetadataReviewInput):'changed'|'satisfied' {
  if(!['accept','reject'].includes(input.action))throw new HttpError(400,'Choose a metadata review action');
  const row=this.store.get<PropertyProposal>('SELECT * FROM property_proposals WHERE id=? AND vault_id=? AND entity_id=?',input.proposalId,vault,id);if(!row)throw new HttpError(404,'Metadata proposal not found');
  const fields=this.fields(vault,id),proposal=this.preview(vault,id,row,fields),expected=input.action==='reject'?'rejected':'accepted';
  if(proposal.status!=='pending'){if(proposal.status===expected||input.action==='accept'&&proposal.status==='corroborated')return 'satisfied';throw new HttpError(409,'This proposal already has another decision');}
  if(input.fingerprint!==proposal.fingerprint)throw new HttpError(409,'Metadata or evidence changed. Reload before reviewing.');
  if(input.action==='accept'&&proposal.stale)throw new HttpError(409,proposal.staleReason??'Evidence is stale');
  let result:'changed'|'satisfied'='satisfied';
  const sidecar=this.store.get<CandidateRow>('SELECT * FROM source_metadata_candidates WHERE proposal_id=?',row.id);
  if(input.action==='accept'){
   const value=input.value===undefined?row.value:text(input.value),targetId=input.targetId??row.target_id??undefined,field=fields.find(item=>item.key===proposal.fieldKey);
   const satisfied=equal(proposal.fieldKey,field?.value??null,value)&&(!targetId||targetId===field?.targetId);
   if(!satisfied){
    if((field?.value||field?.targetId)&&!input.replace&&!(!sidecar&&proposal.fieldKey.startsWith('property:')&&targetId))throw new HttpError(409,'This field already has a value. Confirm replacement explicitly.');
    if(!sidecar&&proposal.fieldKey.startsWith('property:')){
     const legacy=new PropertyReview(this.store).list(vault,id,'all',row.id)[0]!;
     if(input.value!==undefined)throw new HttpError(400,'Edit this property through its canonical property editor.');
     new PropertyReview(this.store).review(vault,id,row.id,{action:'accept',fingerprint:legacy.fingerprint,...targetId?{target_id:targetId}:{}});
    }else {if(value===null)throw new HttpError(400,'A literal metadata value is required');this.write(vault,id,proposal.fieldKey,value,targetId,input.preserveAuthoredValues===true,input.value===undefined&&row.origin==='ai'?'ai':'manual');}
    result='changed';
   }
  }
  this.store.run('UPDATE property_proposals SET status=?,updated_at=?,details=? WHERE id=?',expected,now(),row.details+(input.value!==undefined?'\nUser corrected extracted value to: '+input.value:''),row.id);
  if(sidecar)this.store.run('UPDATE source_metadata_candidates SET status=?,decision_json=? WHERE proposal_id=?',expected,JSON.stringify({action:input.action,value:input.value??row.value,at:now()}),row.id);
  return result;
 }
 review(vault:string,id:string,input:MetadataReviewInput){return this.transaction(()=>{this.source(vault,id);this.apply(vault,id,input);return this.snapshot(vault,id);});}
 batch(vault:string,id:string,input:MetadataBatchInput):MetadataBatchResult{return this.transaction(()=>{
  if(!Array.isArray(input.proposals)||input.proposals.length>500||new Set(input.proposals.map(item=>item.proposalId)).size!==input.proposals.length)throw new HttpError(400,'Invalid compatible metadata batch');
  const snapshot=this.snapshot(vault,id),pending=snapshot.fields.flatMap(field=>field.proposals),changed:string[]=[],satisfied:string[]=[],attention:string[]=[];
  // Validate every selected fingerprint before any mutation; later failures roll back all owners.
  for(const item of input.proposals){const current=pending.find(proposal=>proposal.id===item.proposalId);if(!current){const history=snapshot.fields.flatMap(field=>field.history).find(proposal=>proposal.id===item.proposalId);if(history&&['accepted','corroborated'].includes(history.status)){satisfied.push(history.fieldKey);continue;}throw new HttpError(409,'A selected proposal is no longer pending');}if(current.fingerprint!==item.fingerprint)throw new HttpError(409,'Metadata or evidence changed. Reload the batch.');if(!current.compatible)attention.push(current.fieldKey);}
  const competing=new Set(pending.filter(proposal=>input.proposals.some(item=>item.proposalId===proposal.id)&&proposal.compatible).filter(proposal=>pending.some(other=>other.id!==proposal.id&&other.fieldKey===proposal.fieldKey&&input.proposals.some(item=>item.proposalId===other.id)&&other.value!==proposal.value)).map(proposal=>proposal.fieldKey));
  attention.push(...competing);
  for(const item of input.proposals){const current=pending.find(proposal=>proposal.id===item.proposalId);if(!current||!current.compatible||competing.has(current.fieldKey))continue;const fresh=this.snapshot(vault,id).fields.flatMap(field=>field.proposals).find(proposal=>proposal.id===item.proposalId)!;const outcome=this.apply(vault,id,{...item,fingerprint:fresh.fingerprint,action:'accept'});(outcome==='changed'?changed:satisfied).push(current.fieldKey);}
  return {changed:[...new Set(changed)],satisfied:[...new Set(satisfied)],attention:[...new Set(attention)],snapshot:this.snapshot(vault,id)};
 });}
 registerCandidate(vault:string,id:string,candidate:MetadataCandidate):MetadataRegistration{return this.transaction(()=>{
  this.source(vault,id);if(!candidate.fieldKey.startsWith('bibliography:'))throw new HttpError(400,'Unsupported structured metadata target');candidate={...candidate,fieldKey:'bibliography:'+sourceMetadataCanonicalField(candidate.fieldKey.slice(13))};const value=required(candidate.value,10000),field=this.fields(vault,id).find(item=>item.key===candidate.fieldKey);if(!field||!candidate.fieldKey.startsWith('bibliography:'))throw new HttpError(400,'Unsupported structured metadata target');
  const stale=metadataEvidenceStaleReason(this.store,vault,id,candidate);if(stale)throw new HttpError(409,stale);
  const existing=this.store.all<PropertyProposal>('SELECT p.* FROM property_proposals p JOIN source_metadata_candidates c ON c.proposal_id=p.id WHERE p.vault_id=? AND p.entity_id=? AND c.field_key=? ORDER BY p.created_at DESC',vault,id,candidate.fieldKey);
  const same=existing.find(proposal=>equal(candidate.fieldKey,proposal.value,value));
  if(same){const row=this.store.get<CandidateRow>('SELECT * FROM source_metadata_candidates WHERE proposal_id=?',same.id)!,evidence:MetadataEvidence[]=JSON.parse(row.evidence_json);if(!evidence.some(item=>item.runId===candidate.runId&&item.evidenceHash===candidate.evidenceHash))evidence.push(candidate);this.store.run('UPDATE source_metadata_candidates SET evidence_json=? WHERE proposal_id=?',JSON.stringify(evidence),same.id);if(same.status==='pending'&&equal(candidate.fieldKey,field.value,value)){this.store.run("UPDATE source_metadata_candidates SET status='corroborated' WHERE proposal_id=?",same.id);this.store.run("UPDATE property_proposals SET status='accepted',updated_at=? WHERE id=?",now(),same.id);same.status='accepted';}return {...this.preview(vault,id,same,this.fields(vault,id)),registrationOutcome:same.status==='pending'?'pending':equal(candidate.fieldKey,field.value,value)&&['accepted','corroborated'].includes(row.status)?'satisfied':'ignored'};}
  const file=this.store.get<{text:string}>('SELECT text FROM source_files WHERE id=? AND vault_id=? AND entity_id=?',candidate.fileId,vault,id)!;
  const proposal=proposeValue(this.store,vault,{entity_id:id,property_name:candidate.fieldKey,value,origin:'ai',source_file_id:candidate.fileId,source_hash:rawSourceHash(file.text),details:candidate.validationReason});
  const corroborated=equal(candidate.fieldKey,field.value,value);
  this.store.run('INSERT INTO source_metadata_candidates(proposal_id,field_key,target_fingerprint,evidence_json,status) VALUES(?,?,?,?,?)',proposal.id,candidate.fieldKey,field.fingerprint,JSON.stringify([candidate]),corroborated?'corroborated':'pending');
  if(corroborated)this.store.run("UPDATE property_proposals SET status='accepted',updated_at=? WHERE id=?",now(),proposal.id);
  for(const prior of existing.filter(item=>item.status==='pending')){
   const priorEvidence:MetadataEvidence[]=JSON.parse(this.store.get<CandidateRow>('SELECT * FROM source_metadata_candidates WHERE proposal_id=?',prior.id)!.evidence_json);
   if(priorEvidence.every(item=>!!metadataEvidenceStaleReason(this.store,vault,id,item))){this.store.run("UPDATE source_metadata_candidates SET status='superseded' WHERE proposal_id=?",prior.id);this.store.run("UPDATE property_proposals SET status='rejected',updated_at=? WHERE id=?",now(),prior.id);}
  }
  let current=this.preview(vault,id,this.store.get<PropertyProposal>('SELECT * FROM property_proposals WHERE id=?',proposal.id)!,this.fields(vault,id));
  if(current.status==='pending'&&current.compatible&&this.policy(vault,id)==='fill_validated_empty'){this.apply(vault,id,{proposalId:current.id,fingerprint:current.fingerprint,action:'accept'});current=this.snapshot(vault,id).fields.flatMap(item=>item.history).find(item=>item.id===current.id)!;}
  return {...current,registrationOutcome:current.status==='accepted'?'changed':current.status==='corroborated'?'satisfied':'pending'};
 });}
}
