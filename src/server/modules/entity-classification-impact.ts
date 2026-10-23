import {createHash} from 'node:crypto';
import {entityTypes,type EntityType,type Property} from '../../shared/domain.js';
import type {EntitySchema} from '../../shared/entity-schema.js';
import {readPropertySchema} from './property-hierarchy.js';
export {assertNoHierarchyCycle} from './property-hierarchy.js';
import {propertyDefinitionsForSchema,type PropertyDefinition} from '../../shared/property-definitions.js';
import {classifyPropertyValue} from '../../shared/property-values.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {syncPropertyMetadata} from './property-storage.js';

type Classification = {type:EntityType;subtypes:string[]};
type EntityRow = {id:string;vault_id:string;type:EntityType;subtypes:string;name:string;archived_at:string|null;updated_at:string};
type BoundProperty = Property & {definition_id:string|null};
export interface ClassificationImpactValue {propertyId:string;entityId:string;name:string;targetId:string|null;definitionId:string|null;reason:string;archived:boolean}
export interface ClassificationImpact {
 entityId:string;current:Classification;proposed:Classification;outgoing:ClassificationImpactValue[];incoming:ClassificationImpactValue[];
 structuralBlockers:string[];requiresConfirmation:boolean;fingerprint:string;
}
const parseSubtypes=(raw:string):string[]=>{try{const value:unknown=JSON.parse(raw);return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}catch{return [];}};
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const inherited=(definition:PropertyDefinition,classification:Classification)=>definition.scope.type===classification.type&&(definition.scope.kind==='main_type'||classification.subtypes.includes(definition.scope.subtypeId));
const semantic=(definition:PropertyDefinition)=>stable([definition.valueKind,definition.cardinality,[...definition.allowedTargetTypes].sort(),[...definition.allowedTargetSubtypes].sort(),definition.validation]);

export class EntityClassificationImpact {
 constructor(private store:Store) {}
 preview(vault:string,entityId:string,proposed:Classification,schema?:EntitySchema):ClassificationImpact {
  const entity=this.store.get<EntityRow>('SELECT id,vault_id,type,subtypes,name,archived_at,updated_at FROM entities WHERE id=? AND vault_id=?',entityId,vault);
  if(!entity)throw new HttpError(404,'Entity not found');
  const actualSchema=schema??readPropertySchema(this.store,vault),definitions=actualSchema.propertyDefinitions??propertyDefinitionsForSchema(actualSchema,vault);
  if(!entityTypes.includes(proposed.type)||!Array.isArray(proposed.subtypes)||proposed.subtypes.some(id=>typeof id!=='string'||!actualSchema.subtypes.some(item=>item.id===id&&item.type===proposed.type)))throw new HttpError(400,'Choose subtypes belonging to the proposed entity type.');
  const next={type:proposed.type,subtypes:[...new Set(proposed.subtypes)].sort()},current={type:entity.type,subtypes:parseSubtypes(entity.subtypes).sort()};
  const changed=stable(current)!==stable(next);
  const own=this.store.all<BoundProperty>('SELECT p.*,m.definition_id FROM properties p LEFT JOIN property_value_metadata m ON m.property_id=p.id WHERE p.entity_id=? ORDER BY p.id',entityId);
  const incomingRows=this.store.all<BoundProperty&{owner_type:EntityType;owner_subtypes:string;owner_archived:string|null}>('SELECT p.*,m.definition_id,e.type AS owner_type,e.subtypes AS owner_subtypes,e.archived_at AS owner_archived FROM properties p JOIN entities e ON e.id=p.entity_id LEFT JOIN property_value_metadata m ON m.property_id=p.id WHERE p.target_id=? AND e.vault_id=? ORDER BY p.id',entityId,vault);
  const targets=own.filter(row=>row.target_id).map(row=>this.store.get<EntityRow>('SELECT id,vault_id,type,subtypes,name,archived_at,updated_at FROM entities WHERE id=?',row.target_id!)).filter((row):row is EntityRow=>!!row);
  const outgoing:ClassificationImpactValue[]=[],incoming:ClassificationImpactValue[]=[];
  const asImpact=(row:BoundProperty,reason:string,archived:boolean):ClassificationImpactValue=>({propertyId:row.id,entityId:row.entity_id,name:row.name,targetId:row.target_id,definitionId:row.definition_id,reason,archived});
  if(changed)for(const row of own) {
   const oldDefinition=definitions.find(item=>item.id===row.definition_id);
   const candidates=definitions.filter(item=>inherited(item,next)&&(item.legacyName.toLowerCase()===row.name.toLowerCase()||oldDefinition&&item.key===oldDefinition.key));
   const bound=oldDefinition&&inherited(oldDefinition,next)?oldDefinition:undefined;
   let reason:string|null=null;
   if(oldDefinition&&!bound)reason='The stored definition is outside the proposed type or subtype; retain the authored value as a legacy compatibility case.';
   else if(!candidates.length)reason='This authored field is not inherited by the proposed classification.';
   else if(new Set(candidates.map(semantic)).size>1)reason='The proposed classification inherits conflicting definitions for this field.';
   else if(bound) {
    const target=targets.find(item=>item.id===row.target_id);
    const after=classifyPropertyValue(bound,row,target?{...target,subtypes:parseSubtypes(target.subtypes)}:undefined);
    // Existing invalid values are not a reason to block unrelated identity/classification edits.
    if(after.compatibility==='legacy_incompatible'&&!inherited(bound,current))reason=after.reason;
   }
   if(reason)outgoing.push(asImpact(row,reason,!!entity.archived_at));
  }
  if(changed)for(const row of incomingRows) {
   const owner={type:row.owner_type,subtypes:parseSubtypes(row.owner_subtypes)};
   const definition=definitions.find(item=>item.id===row.definition_id)??definitions.find(item=>inherited(item,owner)&&item.legacyName.toLowerCase()===row.name.toLowerCase());
   if(!definition||definition.valueKind!=='entity_reference')continue;
   const before=classifyPropertyValue(definition,row,{type:current.type,subtypes:current.subtypes,vault_id:vault});
   const after=classifyPropertyValue(definition,row,{type:next.type,subtypes:next.subtypes,vault_id:vault});
   if(before.compatibility!=='legacy_incompatible'&&after.compatibility==='legacy_incompatible')incoming.push(asImpact(row,after.reason??'This reference would no longer satisfy its target constraints.',!!row.owner_archived));
  }
  const sourceFiles=this.store.all<{id:string}>('SELECT id FROM source_files WHERE entity_id=? ORDER BY id',entityId);
  const pageSources=this.store.all<{page_id:string}>('SELECT page_id FROM page_sources WHERE source_id=? ORDER BY page_id',entityId);
  const structuralBlockers:string[]=[];
  if(next.type!=='source'&&sourceFiles.length)structuralBlockers.push('A Source with attached files must remain a Source entity.');
  if(next.type==='source'&&current.type!=='source')structuralBlockers.push('Create a Source with an attached file rather than reclassifying this entity.');
  if(next.type!=='source'&&pageSources.length)structuralBlockers.push('Consulted Source page references must be resolved before changing the Source type.');
  const fingerprint=createHash('sha256').update(stable({entity,next,own,incomingRows,targets,definitions:[...definitions].sort((a,b)=>a.id.localeCompare(b.id)),subtypes:actualSchema.subtypes,sourceFiles,pageSources})).digest('hex');
  return {entityId,current,proposed:next,outgoing,incoming,structuralBlockers,requiresConfirmation:!!(outgoing.length||incoming.length),fingerprint};
 }
 assertAllowed(vault:string,entityId:string,proposed:Classification,confirmation:{mode?:unknown;fingerprint?:unknown}={},schema?:EntitySchema):ClassificationImpact {
  const impact=this.preview(vault,entityId,proposed,schema);
  if(impact.structuralBlockers.length)throw new HttpError(400,impact.structuralBlockers.join(' '));
  if(confirmation.mode!==undefined&&confirmation.mode!=='retain_legacy')throw new HttpError(400,'Unknown classification compatibility path.');
  if(confirmation.fingerprint!==undefined&&confirmation.fingerprint!==impact.fingerprint)throw new HttpError(409,'Classification impact changed. Review a fresh preview before applying it.');
  if(impact.requiresConfirmation&&(confirmation.mode!=='retain_legacy'||confirmation.fingerprint!==impact.fingerprint))throw new HttpError(400,'Review classification impact and explicitly retain legacy values before changing this type or its subtypes.');
  return impact;
 }
 /** Invoke inside the classification transaction after updating the entity. No authored row is changed. */
 afterChange(vault:string,entityId:string,impact:ClassificationImpact) {
  syncPropertyMetadata(this.store,vault,entityId);
  const owners=this.store.all<{entity_id:string}>('SELECT DISTINCT p.entity_id FROM properties p JOIN entities e ON e.id=p.entity_id WHERE p.target_id=? AND e.vault_id=?',entityId,vault);
  for(const owner of new Set(owners.map(item=>item.entity_id)))if(owner!==entityId)syncPropertyMetadata(this.store,vault,owner);
 }
}

