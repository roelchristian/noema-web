import type {DatabaseSync} from 'node:sqlite';
import {builtinProperties} from '../../shared/entity-schema.js';
import type {EntityType} from '../../shared/domain.js';
import {propertyDefinitionFor} from '../../shared/property-definitions.js';
import {adaptTemporalProperty} from '../../shared/temporal-properties.js';

type Row = Record<string, unknown>;
const key = (name:string) => name.trim().toLowerCase().replace(/[\s_-]+/g,'_');
const synonyms:Record<string,string> = {url:'website',source_url:'website',published:'publication_date',pages:'page_count',founder:'founded_by'};
/** Read-only preflight: never invokes openDatabase (which runs migrations), temporal refresh,
 * providers, or writes. Callers must explicitly choose a synthetic/exported database and vault. */
export function inventoryProperties(db:DatabaseSync,vault:string) {
 const tableExists=(table:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
 const columns=(table:string)=>tableExists(table)?db.prepare(`PRAGMA table_info(${table})`).all().map(row=>String(row.name)):[];
 const entityColumns=columns('entities');
 if(!tableExists('properties')||!entityColumns.includes('vault_id'))throw new Error('Inventory requires properties and vault-scoped entities; no migration was attempted');
 const projection=['id','vault_id','type','subtypes','subtype','archived_at'].filter(column=>entityColumns.includes(column));
 const entities=db.prepare(`SELECT ${projection.join(',')} FROM entities`).all() as Row[];
 const allEntities=new Map(entities.map(row=>[String(row.id),row]));
 const selected=entities.filter(row=>row.vault_id===vault);
 const properties=db.prepare('SELECT p.* FROM properties p JOIN entities e ON e.id=p.entity_id WHERE e.vault_id=? ORDER BY p.rowid').all(vault) as Row[];
 const readScoped=(table:string)=>tableExists(table)?(db.prepare(`SELECT * FROM ${table} WHERE vault_id=?`).all(vault) as Row[]):[];
 const subtypeDefinitions=readScoped('entity_subtypes');
 const subtypeFields=readScoped('entity_subtype_properties');
 const mainTypeFields=readScoped('entity_type_properties');
 const temporalValues=readScoped('temporal_property_values');
 const temporalRelations=readScoped('temporal_relations');
 const names=new Map<string,{name:string;count:number;text:number;references:number}>();
 const groups=new Map<string,string[]>();
 const repeated=new Map<string,Row[]>();
 const problematicReferences: {propertyId:string;targetId:string;reasons:string[]}[]=[];
 const incompatible: {propertyId:string;name:string;reason:string}[]=[];
 const legacyDates: {propertyId:string;raw:string;adaptation:ReturnType<typeof adaptTemporalProperty>;evidence:Row[];relations:Row[]}[]=[];
 const managed: {propertyId:string;name:string;workflow:string}[]=[];
 for(const row of properties) {
  const name=String(row.name),normalized=key(name),entity=allEntities.get(String(row.entity_id))!;
  const definition=propertyDefinitionFor(String(entity.type) as EntityType,name);
  const count=names.get(name)??{name,count:0,text:0,references:0};count.count++;count[row.target_id===null?'text':'references']++;names.set(name,count);
  const variants=groups.get(normalized)??[];if(!variants.includes(name))variants.push(name);groups.set(normalized,variants);
  const groupKey=JSON.stringify([row.entity_id,normalized]);repeated.set(groupKey,[...(repeated.get(groupKey)??[]),row]);
  if(row.target_id!==null) {
   const target=allEntities.get(String(row.target_id)),reasons:string[]=[];
   if(!target)reasons.push('dangling');
   else {
    if(target.vault_id!==vault)reasons.push('cross-vault');
    if(target.archived_at)reasons.push('archived');
    if(definition?.allowedTargetTypes.length&&!definition.allowedTargetTypes.includes(String(target.type) as EntityType))reasons.push('target-type');
    if(definition?.allowedTargetSubtypes.length&&!definition.allowedTargetSubtypes.some(subtype=>subtypeIds(target).includes(subtype)))reasons.push('target-subtype');
   }
   if(reasons.length)problematicReferences.push({propertyId:String(row.id),targetId:String(row.target_id),reasons});
  } else if(typeof row.value==='string') {
   const adapted=adaptTemporalProperty(String(entity.type),name,row.value);
   if(adapted||definition?.valueKind==='date') {
    legacyDates.push({propertyId:String(row.id),raw:row.value,adaptation:adapted,evidence:temporalValues.filter(item=>item.property_id===row.id),relations:temporalRelations.filter(item=>item.property_id===row.id)});
    if(adapted&&!adapted.date)incompatible.push({propertyId:String(row.id),name,reason:'ambiguous-or-unsupported-date'});
   }
   if(definition?.valueKind==='url'&&!validUrl(row.value))incompatible.push({propertyId:String(row.id),name,reason:'invalid-http-url'});
   // Text on reference fields is an explicit unresolved literal, never a conversion error.
  }
  if(entity.type==='source'&&['Import method','Source URL'].includes(name))managed.push({propertyId:String(row.id),name,workflow:'syncSourceProvenance deletes/recreates these rows'});
 }
 const cardinalityViolations=[...repeated.values()].filter(rows=>rows.length>1&&propertyDefinitionFor(String(allEntities.get(String(rows[0]!.entity_id))!.type) as EntityType,String(rows[0]!.name))?.cardinality==='one').map(rows=>({entityId:String(rows[0]!.entity_id),key:key(String(rows[0]!.name)),propertyIds:rows.map(row=>String(row.id))}));
 const duplicateValues=[...repeated.values()].flatMap(rows=>rows.filter((row,index)=>rows.findIndex(other=>other.value===row.value&&other.target_id===row.target_id)<index).map(row=>({entityId:String(row.entity_id),propertyId:String(row.id),name:String(row.name)})));
 const subtypeOverlaps=selected.flatMap(entity=>{
  const assigned=subtypeIds(entity),fields=subtypeFields.filter(field=>assigned.includes(String(field.subtype_id))),byKey=new Map<string,Row[]>();
  for(const field of fields){const normalized=key(String(field.name));byKey.set(normalized,[...(byKey.get(normalized)??[]),field]);}
  return [...byKey.entries()].filter(([,fields])=>fields.length>1).map(([fieldKey,fields])=>({entityId:String(entity.id),key:fieldKey,subtypeIds:fields.map(field=>String(field.subtype_id)),status:'requires-definition-comparison'}));
 });
 return {version:1,vault,totalProperties:properties.length,distinctNames:[...names.values()].sort((a,b)=>a.name.localeCompare(b.name)),caseVariants:[...groups.entries()].filter(([,variants])=>variants.length>1).map(([normalized,variants])=>({key:normalized,names:variants})),probableSynonyms:[...groups.keys()].filter(normalized=>synonyms[normalized]&&groups.has(synonyms[normalized]!)).map(normalized=>({key:normalized,candidate:synonyms[normalized],reviewRequired:true})),representation:{text:properties.filter(row=>row.target_id===null).length,references:properties.filter(row=>row.target_id!==null).length,textProportion:properties.length?properties.filter(row=>row.target_id===null).length/properties.length:0,referenceProportion:properties.length?properties.filter(row=>row.target_id!==null).length/properties.length:0,unresolvedLiterals:properties.filter(row=>row.target_id===null&&propertyDefinitionFor(String(allEntities.get(String(row.entity_id))!.type) as EntityType,String(row.name))?.valueKind==='entity_reference').map(row=>String(row.id))},incompatible,cardinalityViolations,duplicateValues,problematicReferences,legacyDates,systemManagedProperties:managed,customSubtypeDefinitions:subtypeDefinitions,subtypeFields,mainTypeFields:mainTypeFields.filter(row=>!(builtinProperties[String(row.type) as keyof typeof builtinProperties]??[]).some(name=>key(name)===key(String(row.name)))),subtypeOverlaps,limitations:['Proposed type/cardinality checks are advisory for known native fields; no authored value is converted or rejected.','Synonyms are candidates for human review, never automatic merges; nationality is not citizenship.','Legacy subtype fields store names only; incompatible typed constraints cannot be compared until definitions exist.','Date evidence is reported as stored, without refreshing temporal authority; null adaptation means that native date has no existing temporal mapping.', 'Scalar compatibility checks currently cover URL and mapped temporal values; coordinates and custom scalar constraints require later typed validation.','Dangling properties whose owning entity is missing cannot be attributed safely to this vault.']};
}
function subtypeIds(row:Row):string[] {
 if(row.subtypes===null||row.subtypes===undefined)return row.subtype?[String(row.subtype)]:[];
 try{const parsed=JSON.parse(String(row.subtypes??'[]'));return Array.isArray(parsed)?parsed.filter((value):value is string=>typeof value==='string'):[];}catch{return row.subtype?[String(row.subtype)]:[];}
}
function validUrl(value:string) {try{const url=new URL(value);return url.protocol==='https:'||url.protocol==='http:';}catch{return false;}}
