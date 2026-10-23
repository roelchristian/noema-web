import {builtinProperties,builtinSubtypes,type EntitySchema} from '../../shared/entity-schema.js';
import {propertyDefinitionsForSchema,type PropertyDefinition} from '../../shared/property-definitions.js';
import type {EntityType,Property} from '../../shared/domain.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
type BoundProperty=Property&{definition_id:string|null};
const parseSubtypes=(raw:string):string[]=>{try{const value:unknown=JSON.parse(raw);return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}catch{return [];}};
const inherited=(definition:PropertyDefinition,classification:{type:EntityType;subtypes:string[]})=>definition.scope.type===classification.type&&(definition.scope.kind==='main_type'||classification.subtypes.includes(definition.scope.subtypeId));

/** A read adapter only: impact inspection never creates definitions or refreshes evidence. */
export function readPropertySchema(store:Store,vault:string):EntitySchema {
 const properties=Object.fromEntries(Object.entries(builtinProperties).map(([type,names])=>[type,[...names]])) as Record<EntityType,string[]>;
 for(const row of store.all<{type:EntityType;name:string}>('SELECT type,name FROM entity_type_properties WHERE vault_id=? ORDER BY type,name',vault))if(!properties[row.type].some(name=>name.toLowerCase()===row.name.toLowerCase()))properties[row.type].push(row.name);
 const subtypeProperties:Record<string,string[]>={};
 for(const row of store.all<{subtype_id:string;name:string}>('SELECT subtype_id,name FROM entity_subtype_properties WHERE vault_id=? ORDER BY subtype_id,name',vault))(subtypeProperties[row.subtype_id]??=[]).push(row.name);
 const subtypes=[...builtinSubtypes,...store.all<{id:string;name:string;type:EntityType}>('SELECT id,name,type FROM entity_subtypes WHERE vault_id=? ORDER BY id',vault)];
 const schema:EntitySchema={properties,subtypeProperties,subtypes};
 const stored=store.all<{definition_json:string}>('SELECT definition_json FROM property_definitions WHERE vault_id=? ORDER BY id',vault).map(row=>JSON.parse(row.definition_json) as PropertyDefinition);
 schema.propertyDefinitions=[...stored,...propertyDefinitionsForSchema(schema,vault).filter(item=>!stored.some(existing=>existing.id===item.id))];
 return schema;
}
type HierarchyDefinition=Pick<PropertyDefinition,'key'|'legacyName'|'validation'>;
const normalizedKey=(name:string)=>name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const hierarchyFamilies:Record<string,string>={parent_taxon:'parent_taxon',parent_organization:'parent_organization',parent_company:'parent_organization',parent_place:'parent_place',administrative_parent:'parent_place',language_family:'language_family',parent_tradition:'parent_tradition'};
function hierarchyFamily(definition:HierarchyDefinition|string):string|null {
 const key=normalizedKey(typeof definition==='string'?definition:definition.key);
 return hierarchyFamilies[key]??(typeof definition!=='string'&&definition.validation.hierarchical===true?key:null);
}
/** Reject a new/changed hierarchical edge that reaches its owner, including archived and
 * name-only legacy links. Existing unchanged legacy cycles remain readable/editable. */
export function assertNoHierarchyCycle(store:Store,vault:string,entityId:string,targetId:string,definition:HierarchyDefinition|string,propertyId?:string) {
 const family=hierarchyFamily(definition);if(!family)return;
 const schema=readPropertySchema(store,vault),definitions=schema.propertyDefinitions??[];
 const rows=store.all<BoundProperty&{type:EntityType;subtypes:string}>('SELECT p.*,m.definition_id,e.type,e.subtypes FROM properties p JOIN entities e ON e.id=p.entity_id JOIN entities target ON target.id=p.target_id AND target.vault_id=e.vault_id LEFT JOIN property_value_metadata m ON m.property_id=p.id WHERE e.vault_id=? AND p.target_id IS NOT NULL ORDER BY p.id',vault);
 const rowFamily=(row:typeof rows[number])=>{
  const bound=definitions.find(item=>item.id===row.definition_id)??definitions.find(item=>item.legacyName.toLowerCase()===row.name.toLowerCase()&&inherited(item,{type:row.type,subtypes:parseSubtypes(row.subtypes)}));
  const existing=bound??row.name;
  if(typeof definition!=='string'&&definition.validation.hierarchical===true&&normalizedKey(typeof existing==='string'?existing:existing.key)===normalizedKey(definition.key))return family;
  return hierarchyFamily(existing);
 };
 const previous=rows.find(row=>row.id===propertyId&&row.entity_id===entityId);
 if(previous&&previous.target_id===targetId&&rowFamily(previous)===family)return;
 if(entityId===targetId)throw new HttpError(409,'A hierarchical property cannot reference its own entity.');
 const edges=new Map<string,string[]>();
 for(const row of rows)if(row.id!==propertyId&&rowFamily(row)===family)(edges.get(row.entity_id)??(edges.set(row.entity_id,[]),edges.get(row.entity_id)!)).push(row.target_id!);
 const pending=[targetId],visited=new Set<string>();
 while(pending.length) {
  const id=pending.pop()!;if(id===entityId)throw new HttpError(409,'This hierarchical reference would create a cycle. Review the existing parent links first.');
  if(visited.has(id))continue;visited.add(id);pending.push(...edges.get(id)??[]);
 }
}
