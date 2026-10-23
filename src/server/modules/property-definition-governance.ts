import {createHash,randomUUID} from 'node:crypto';
import {Store} from '../store.js';
import {HttpError,required,text} from '../validation.js';
import {entityTypes,type Entity,type EntityType,type Property} from '../../shared/domain.js';
import {vaultSubtypes} from '../../shared/entity-schema.js';
import type {PropertyDefinition,PropertyValueKind} from '../../shared/property-definitions.js';
import {classifyPropertyValue} from '../../shared/property-values.js';
import {ensurePropertyDefinitions,syncPropertyMetadata} from './property-storage.js';
import {assertNoHierarchyCycle} from './entity-classification-impact.js';

const kinds:PropertyValueKind[]=['short_text','long_text','entity_reference','date','datetime','integer','quantity','boolean','enum','url','identifier','coordinates'];
type ValueRow=Property&{type:EntityType;subtypes:string;archived_at:string|null;binding:string|null};
export interface DefinitionImpact {fingerprint:string;definition:PropertyDefinition;affectedValues:number;compatibleValues:number;incompatible:{propertyId:string;entityId:string;reason:string}[]}
const parseSubtypes=(raw:string):string[]=>{try{const value:unknown=JSON.parse(raw);return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}catch{return [];}};
const sameScope=(a:PropertyDefinition['scope'],b:PropertyDefinition['scope'])=>a.kind===b.kind&&a.type===b.type&&(a.kind!=='subtype'||b.kind==='subtype'&&a.subtypeId===b.subtypeId);

/** Definition changes never rewrite authored properties. Incompatible changes need a fresh,
 * explicit compatibility decision; builtin definitions and stable identity are protected. */
export class PropertyDefinitionGovernance {
 constructor(private store:Store) {}
 private definitions(vault:string):PropertyDefinition[]{return this.store.all<{definition_json:string}>('SELECT definition_json FROM property_definitions WHERE vault_id=?',vault).map(row=>JSON.parse(row.definition_json) as PropertyDefinition);}
 private subtypes(vault:string){return vaultSubtypes(this.store.all<{id:string;type:EntityType;name:string}>('SELECT id,type,name FROM entity_subtypes WHERE vault_id=?',vault));}
 private require(vault:string,id:string){const definition=this.definitions(vault).find(item=>item.id===id);if(!definition)throw new HttpError(404,'Property definition not found');return definition;}
 private scope(vault:string,value:unknown):PropertyDefinition['scope'] {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'Choose a definition scope.');
  const scope=value as Record<string,unknown>,type=scope.type as EntityType;
  if(!entityTypes.includes(type))throw new HttpError(400,'Invalid definition category.');
  if(scope.kind==='main_type')return {kind:'main_type',type};
  if(scope.kind==='subtype'&&typeof scope.subtypeId==='string'&&this.subtypes(vault).some(item=>item.id===scope.subtypeId&&item.type===type))return {kind:'subtype',type,subtypeId:scope.subtypeId};
  throw new HttpError(400,'Choose a subtype from this vault and category.');
 }
 private patch(vault:string,base:PropertyDefinition,body:Record<string,unknown>) {
  for(const field of ['id','key','legacyName','origin','compatibility','editable'])if(body[field]!==undefined&&JSON.stringify(body[field])!==JSON.stringify(base[field as keyof PropertyDefinition]))throw new HttpError(400,'Definition identity and protected metadata cannot be changed.');
  if(body.name!==undefined&&body.name!==base.legacyName)throw new HttpError(400,'Stored property names are stable; edit the display label instead.');
  if(body.scope!==undefined&&!sameScope(this.scope(vault,body.scope),base.scope))throw new HttpError(400,'Definition scope is stable. Create a separate definition to change scope.');
  const result:PropertyDefinition={...base,label:body.label===undefined?base.label:required(body.label),description:body.description===undefined?base.description:text(body.description,2000)};
  if(body.valueKind!==undefined){if(!kinds.includes(body.valueKind as PropertyValueKind))throw new HttpError(400,'Invalid property value kind.');result.valueKind=body.valueKind as PropertyValueKind;}
  if(body.cardinality!==undefined){if(body.cardinality!=='one'&&body.cardinality!=='many')throw new HttpError(400,'Choose single or multiple values.');result.cardinality=body.cardinality;}
  if(body.visibility!==undefined){if(!['core','suggested','additional'].includes(String(body.visibility)))throw new HttpError(400,'Invalid property visibility.');result.visibility=body.visibility as PropertyDefinition['visibility'];}
  if(body.sortOrder!==undefined){if(typeof body.sortOrder!=='number'||!Number.isSafeInteger(body.sortOrder)||body.sortOrder<0||body.sortOrder>100000)throw new HttpError(400,'Invalid display order.');result.sortOrder=body.sortOrder;}
  for(const field of ['allowedTargetTypes','allowedTargetSubtypes'] as const)if(body[field]!==undefined){const values=body[field];if(!Array.isArray(values)||values.length>50||values.some(value=>typeof value!=='string')||new Set(values).size!==values.length)throw new HttpError(400,'Invalid target constraints.');if(field==='allowedTargetTypes'&&values.some(value=>!entityTypes.includes(value as EntityType)))throw new HttpError(400,'Invalid target category.');if(field==='allowedTargetSubtypes'&&values.some(value=>!this.subtypes(vault).some(item=>item.id===value)))throw new HttpError(400,'Target subtype must belong to this vault.');result[field]=values as EntityType[]&string[];}
  if(result.allowedTargetSubtypes.some(id=>{const subtype=this.subtypes(vault).find(item=>item.id===id)!;return result.allowedTargetTypes.length&&!result.allowedTargetTypes.includes(subtype.type);}))throw new HttpError(400,'Target subtypes must belong to permitted target categories.');
  if(result.valueKind!=='entity_reference'&&(result.allowedTargetTypes.length||result.allowedTargetSubtypes.length))throw new HttpError(400,'Target constraints require an entity-reference definition.');
  if(body.validation!==undefined){const constraints=body.validation;if(!constraints||typeof constraints!=='object'||Array.isArray(constraints))throw new HttpError(400,'Invalid property constraints.');const values=constraints as Record<string,unknown>;for(const [name,value]of Object.entries(values)){if(['min','max','minLength','maxLength'].includes(name)){if(typeof value!=='number'||!Number.isFinite(value)||name.endsWith('Length')&&(!Number.isSafeInteger(value)||value<0))throw new HttpError(400,'Invalid numeric constraint.');}else if(name==='pattern'){if(typeof value!=='string'||value.length>200)throw new HttpError(400,'Invalid format constraint.');try{new RegExp(value);}catch{throw new HttpError(400,'Invalid format expression.');}}else if(name==='values'){if(!Array.isArray(value)||!value.length||value.length>100||value.some(item=>typeof item!=='string'||!item||item.length>200)||new Set(value).size!==value.length)throw new HttpError(400,'Choose unique enum values.');}else if(name==='hierarchical'){if(typeof value!=='boolean'||result.valueKind!=='entity_reference')throw new HttpError(400,'Hierarchy constraints require references.');}else throw new HttpError(400,'Unsupported validation constraint.');}if(typeof values.min==='number'&&typeof values.max==='number'&&values.min>values.max||typeof values.minLength==='number'&&typeof values.maxLength==='number'&&values.minLength>values.maxLength)throw new HttpError(400,'Constraint minimum exceeds maximum.');result.validation={...values};}
  if(result.validation.hierarchical===true&&result.valueKind!=='entity_reference')throw new HttpError(400,'Hierarchy constraints require an entity-reference definition.');
  if(result.valueKind==='enum'&&(!Array.isArray(result.validation.values)||!result.validation.values.length))throw new HttpError(400,'Declare the allowed enum values.');
  return result;
 }
 create(vault:string,body:Record<string,unknown>):PropertyDefinition {
  const create=()=>{
   ensurePropertyDefinitions(this.store,vault);
   const scope=this.scope(vault,body.scope),name=required(body.name),key=body.key===undefined?name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''):required(body.key);
   if(!/^[a-z][a-z0-9_]{0,99}$/.test(key))throw new HttpError(400,'Use a stable key beginning with a letter and containing lowercase letters, digits and underscores.');
   const existing=this.definitions(vault);
   if(existing.some(item=>item.scope.type===scope.type&&(item.legacyName.toLowerCase()===name.toLowerCase()||item.origin==='builtin'&&item.key===key||sameScope(item.scope,scope)&&item.key===key)))throw new HttpError(409,'This stored property name or key is already defined. Reuse its existing definition or choose a unique stored name; display labels can be shared. Builtin keys are protected.');
   const initial:PropertyDefinition={id:'custom:'+randomUUID(),key,legacyName:name,label:name,description:'',valueKind:'short_text',cardinality:'many',allowedTargetTypes:[],allowedTargetSubtypes:[],scope,origin:'user_defined',visibility:scope.kind==='subtype'?'suggested':'additional',sortOrder:100,editable:true,validation:{},compatibility:'legacy'};
   const definition=this.patch(vault,initial,body);
   this.store.run('INSERT INTO property_definitions (vault_id,id,definition_json) VALUES (?,?,?)',vault,definition.id,JSON.stringify(definition));
   if(scope.kind==='main_type')this.store.run('INSERT OR IGNORE INTO entity_type_properties (vault_id,type,name) VALUES (?,?,?)',vault,scope.type,name);
   else this.store.run('INSERT OR IGNORE INTO entity_subtype_properties (vault_id,subtype_id,name) VALUES (?,?,?)',vault,scope.subtypeId,name);
   return definition;
  };
  return this.store.db.isTransaction?create():this.store.transaction(create);
 }
 private values(vault:string,definition:PropertyDefinition):ValueRow[]{return this.store.all<ValueRow>('SELECT p.*,e.type,e.subtypes,e.archived_at,m.definition_id AS binding FROM properties p JOIN entities e ON e.id=p.entity_id LEFT JOIN property_value_metadata m ON m.property_id=p.id WHERE e.vault_id=? ORDER BY p.id',vault).filter(row=>row.binding===definition.id||row.binding===null&&row.name.toLowerCase()===definition.legacyName.toLowerCase()&&row.type===definition.scope.type&&(definition.scope.kind==='main_type'||parseSubtypes(row.subtypes).includes(definition.scope.subtypeId)));}
 impact(vault:string,id:string,body:Record<string,unknown>):DefinitionImpact {
  const before=this.require(vault,id);if(before.origin==='builtin')throw new HttpError(403,'Builtin definitions have protected keys and semantics.');
  const definition=this.patch(vault,before,body),values=this.values(vault,before),targets=[...new Set(values.map(row=>row.target_id).filter((id):id is string=>!!id))].sort().flatMap(id=>{const target=this.store.get<{id:string;type:EntityType;subtypes:string;vault_id:string;archived_at:string|null}>('SELECT id,type,subtypes,vault_id,archived_at FROM entities WHERE id=?',id);return target?[target]:[];});
  const incompatible:DefinitionImpact['incompatible']=[];
  for(const row of values){const target=targets.find(item=>item.id===row.target_id),metadata=classifyPropertyValue(definition,row,target&&target.vault_id===vault?{...target,subtypes:parseSubtypes(target.subtypes)}:undefined);const duplicate=definition.cardinality==='one'&&values.filter(other=>other.entity_id===row.entity_id).length>1;let cyclic=false;if(definition.validation.hierarchical===true&&row.target_id){try{assertNoHierarchyCycle(this.store,vault,row.entity_id,row.target_id,definition);}catch(error){if(error instanceof HttpError&&error.status===409)cyclic=true;else throw error;}}const reason=cyclic?'Existing references form a hierarchy cycle requiring review.':duplicate?'Multiple authored values require cardinality review.':metadata.compatibility==='legacy_incompatible'?metadata.reason:null;if(reason)incompatible.push({propertyId:row.id,entityId:row.entity_id,reason});}
  const hierarchy=definition.validation.hierarchical===true?this.store.all('SELECT p.id,p.entity_id,p.name,p.target_id,e.type,e.subtypes,m.definition_id FROM properties p JOIN entities e ON e.id=p.entity_id LEFT JOIN property_value_metadata m ON m.property_id=p.id WHERE e.vault_id=? AND p.target_id IS NOT NULL ORDER BY p.id',vault):[];
  const fingerprint=createHash('sha256').update(JSON.stringify([vault,before,definition,values,targets,hierarchy,definition.validation.hierarchical===true?this.definitions(vault).sort((a,b)=>a.id.localeCompare(b.id)):[]])).digest('hex');
  return {fingerprint,definition,affectedValues:values.length,compatibleValues:values.length-incompatible.length,incompatible};
 }
 update(vault:string,id:string,body:Record<string,unknown>):PropertyDefinition {
  const update=()=>{
   const impact=this.impact(vault,id,body);
   if(body.impactFingerprint!==undefined&&body.impactFingerprint!==impact.fingerprint)throw new HttpError(409,'Property values or classification changed. Review a fresh impact preview.');
   if(impact.incompatible.length&&(body.impactFingerprint!==impact.fingerprint||body.confirmCompatibility!==true))throw new HttpError(409,'Review the impact preview and explicitly retain incompatible authored values before applying this definition.');
   const rows=this.values(vault,impact.definition);
   this.store.run('UPDATE property_definitions SET definition_json=? WHERE vault_id=? AND id=?',JSON.stringify(impact.definition),vault,id);
   for(const row of rows)this.store.run('INSERT INTO temporal_property_dirty (property_id,vault_id) VALUES (?,?) ON CONFLICT(property_id) DO UPDATE SET vault_id=excluded.vault_id',row.id,vault);
   syncPropertyMetadata(this.store,vault);
   // Archived/reclassified owners can retain bindings outside current inheritance.
   for(const item of impact.incompatible)this.store.run("UPDATE property_value_metadata SET compatibility='legacy_incompatible',reason=?,integer_value=NULL,decimal_value=NULL,boolean_value=NULL,text_value=NULL,latitude=NULL,longitude=NULL,unit=NULL,target_id=NULL,temporal_date_id=NULL WHERE property_id=? AND vault_id=? AND definition_id=?",item.reason,item.propertyId,vault,id);
   return impact.definition;
  };
  return this.store.db.isTransaction?update():this.store.transaction(update);
 }
}
