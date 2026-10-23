import {assertNoHierarchyCycle} from './property-hierarchy.js';
import {HttpError} from '../validation.js';
import type {DatabaseSync} from 'node:sqlite';
import {builtinProperties,builtinSubtypes,type EntitySchema} from '../../shared/entity-schema.js';
import {propertyDefinitionsForSchema,resolvePropertyDefinition,propertyDefinitionSignature,type PropertyDefinition} from '../../shared/property-definitions.js';
import {classifyPropertyValue,type PropertyValueMetadata} from '../../shared/property-values.js';
import type {Entity,EntityType,Property} from '../../shared/domain.js';
import {Store} from '../store.js';

type DefinitionRow={id:string;definition_json:string};
type PropertyRow=Property&{type:EntityType;subtypes:string};
function legacySchema(store:Store,vault:string):EntitySchema {
 const properties=Object.fromEntries(Object.entries(builtinProperties).map(([type,names])=>[type,[...names]])) as Record<EntityType,string[]>;
 for(const row of store.all<{type:EntityType;name:string}>('SELECT type,name FROM entity_type_properties WHERE vault_id=?',vault))if(!properties[row.type].some(name=>name.toLowerCase()===row.name.toLowerCase()))properties[row.type].push(row.name);
 const subtypeProperties:Record<string,string[]>={};
 for(const row of store.all<{subtype_id:string;name:string}>('SELECT subtype_id,name FROM entity_subtype_properties WHERE vault_id=?',vault))(subtypeProperties[row.subtype_id]??=[]).push(row.name);
 const persisted=store.all<DefinitionRow>('SELECT id,definition_json FROM property_definitions WHERE vault_id=?',vault).map(row=>JSON.parse(row.definition_json) as PropertyDefinition);
 // Only orphan fields become permissive main-type definitions. Known subtype fields stay scoped.
 for(const row of store.all<{type:EntityType;name:string;subtypes:string}>('SELECT DISTINCT e.type,p.name,e.subtypes FROM properties p JOIN entities e ON e.id=p.entity_id WHERE e.vault_id=?',vault)) {
  const assigned=parseSubtypes(row.subtypes);
  const known=properties[row.type].some(name=>name.toLowerCase()===row.name.toLowerCase())||assigned.some(id=>(subtypeProperties[id]??[]).some(name=>name.toLowerCase()===row.name.toLowerCase()))||persisted.some(item=>item.scope.type===row.type&&item.legacyName.toLowerCase()===row.name.toLowerCase()&&(item.scope.kind==='main_type'||assigned.includes(item.scope.subtypeId)))||!!store.get('SELECT 1 FROM property_value_metadata m JOIN properties p ON p.id=m.property_id JOIN entities e ON e.id=p.entity_id WHERE m.vault_id=? AND e.type=? AND lower(p.name)=lower(?)',vault,row.type,row.name);
  if(!known)properties[row.type].push(row.name);
 }
 return {properties,subtypeProperties,subtypes:[...builtinSubtypes,...store.all<{id:string;name:string;type:EntityType}>('SELECT id,name,type FROM entity_subtypes WHERE vault_id=?',vault)]};
}
export function isStoredPropertyDefinition(value:unknown):value is PropertyDefinition {
 if(!value||typeof value!=='object')return false;
 const item=value as Partial<PropertyDefinition>;
 return typeof item.id==='string'&&!!item.id&&typeof item.key==='string'&&typeof item.legacyName==='string'&&typeof item.label==='string'&&typeof item.description==='string'&&['short_text','long_text','entity_reference','date','datetime','integer','quantity','boolean','enum','url','identifier','coordinates'].includes(item.valueKind??'')&&['one','many'].includes(item.cardinality??'')&&Array.isArray(item.allowedTargetTypes)&&item.allowedTargetTypes.every(type=>Object.hasOwn(builtinProperties,type))&&Array.isArray(item.allowedTargetSubtypes)&&item.allowedTargetSubtypes.every(id=>typeof id==='string')&&!!item.scope&&['main_type','subtype'].includes(item.scope.kind)&&Object.hasOwn(builtinProperties,item.scope.type)&&(item.scope.kind!=='subtype'||typeof item.scope.subtypeId==='string')&&['builtin','user_defined'].includes(item.origin??'')&&['core','suggested','additional'].includes(item.visibility??'')&&Number.isFinite(item.sortOrder)&&typeof item.editable==='boolean'&&!!item.validation&&typeof item.validation==='object'&&!Array.isArray(item.validation)&&item.compatibility==='legacy';
}
/** Fill missing legacy definitions only; imported/persisted identities and metadata win. */
export function ensurePropertyDefinitions(store:Store,vault:string,schema?:EntitySchema) {
 if(!store.get('SELECT 1 FROM vaults WHERE id=?',vault))return;
 const existing=store.all<DefinitionRow>('SELECT id,definition_json FROM property_definitions WHERE vault_id=?',vault).map(row=>JSON.parse(row.definition_json) as PropertyDefinition);
 for(const definition of propertyDefinitionsForSchema(schema??legacySchema(store,vault),vault)) {
  const same=existing.some(item=>item.id===definition.id||definition.origin!=='builtin'&&item.legacyName.toLowerCase()===definition.legacyName.toLowerCase()&&item.scope.type===definition.scope.type&&item.scope.kind===definition.scope.kind&&(item.scope.kind!=='subtype'||definition.scope.kind==='subtype'&&item.scope.subtypeId===definition.scope.subtypeId));
  if(!same){store.run('INSERT OR IGNORE INTO property_definitions (vault_id,id,definition_json) VALUES (?,?,?)',vault,definition.id,JSON.stringify(definition));existing.push(definition);}
 }
}
export function persistedPropertyDefinitions(store:Store,vault:string,schema?:EntitySchema):PropertyDefinition[] {
 if(!store.get('SELECT 1 FROM vaults WHERE id=?',vault))return propertyDefinitionsForSchema(schema??legacySchema(store,vault),vault);
 ensurePropertyDefinitions(store,vault,schema);
 return store.all<DefinitionRow>('SELECT id,definition_json FROM property_definitions WHERE vault_id=? ORDER BY id',vault).map(row=>JSON.parse(row.definition_json) as PropertyDefinition);
}
function parseSubtypes(value:string):string[]{try{const parsed:unknown=JSON.parse(value);return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==='string'):[];}catch{return [];}}
/** Rebuild derived mirrors, preserving authored rows. Existing temporal evidence is authoritative. */
export function syncPropertyMetadata(store:Store,vault:string,entityId?:string) {
 const definitions=persistedPropertyDefinitions(store,vault);
 const rows=store.all<PropertyRow>(`SELECT p.*,e.type,e.subtypes FROM properties p JOIN entities e ON e.id=p.entity_id WHERE e.vault_id=? ${entityId?'AND e.id=?':''} ORDER BY p.id`,...entityId?[vault,entityId]:[vault]);
 const positions=new Map<string,number>(),counts=new Map<string,number>();
 const previousBindings=new Map(store.all<{property_id:string;definition_id:string;position:number}>('SELECT property_id,definition_id,position FROM property_value_metadata WHERE vault_id=?',vault).map(item=>[item.property_id,item]));
 const resolved=new Map(rows.map(row=>[row.id,resolvePropertyDefinition(definitions,row.type,parseSubtypes(row.subtypes),row.name,previousBindings.get(row.id)?.definition_id)]));
 const countKey=(entity:string,definition:PropertyDefinition)=>JSON.stringify([entity,definition.key,propertyDefinitionSignature(definition)]);
 for(const item of store.all<{entity_id:string;definition_id:string;position:number}>('SELECT p.entity_id,m.definition_id,m.position FROM property_value_metadata m JOIN properties p ON p.id=m.property_id WHERE m.vault_id=?',vault)){const key=JSON.stringify([item.entity_id,item.definition_id]);positions.set(key,Math.max(positions.get(key)??0,item.position+1));}
 for(const row of rows){const definition=resolved.get(row.id);if(definition){const key=countKey(row.entity_id,definition);counts.set(key,(counts.get(key)??0)+1);}}
 for(const row of rows) {
  const assigned=parseSubtypes(row.subtypes);
  const candidates=definitions.filter(item=>item.scope.type===row.type&&item.legacyName.toLowerCase()===row.name.toLowerCase()&&(item.scope.kind==='main_type'||assigned.includes(item.scope.subtypeId)));
  const previous=previousBindings.get(row.id);
  const definition=resolved.get(row.id);if(!definition)continue;
  const outOfScope=!candidates.some(item=>item.id===definition.id);
  const target=row.target_id?store.get<{type:EntityType;subtypes:string;vault_id:string}>('SELECT type,subtypes,vault_id FROM entities WHERE id=?',row.target_id):undefined;
  const metadata=classifyPropertyValue(definition,row,target?{...target,subtypes:parseSubtypes(target.subtypes)}:undefined);
  if(outOfScope){metadata.compatibility='legacy_incompatible';metadata.reason='Definition is no longer inherited after reclassification; authored value and binding retained.';}
  if(row.target_id){try{assertNoHierarchyCycle(store,vault,row.entity_id,row.target_id,definition);}catch(error){if(error instanceof HttpError&&error.status===409){metadata.compatibility='legacy_incompatible';metadata.reason='Existing references form a hierarchy cycle requiring review.';}else throw error;}}
  if(target&&target.vault_id!==vault){metadata.compatibility='legacy_incompatible';metadata.reason='Referenced entity belongs to another vault.';metadata.target_id=null;}
  const grouping=JSON.stringify([row.entity_id,definition.id]);
  metadata.position=previous?.definition_id===definition.id?previous.position:(positions.get(grouping)??0);
  positions.set(grouping,Math.max(positions.get(grouping)??0,metadata.position+1));
  const duplicates=counts.get(countKey(row.entity_id,definition))??0;
  if(definition.cardinality==='one'&&duplicates>1){metadata.compatibility='legacy_incompatible';metadata.reason='Multiple authored values require cardinality review.';}
  const evidence=store.get<{date_id:string}>('SELECT date_id FROM temporal_property_values WHERE vault_id=? AND property_id=? AND date_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM temporal_property_dirty WHERE property_id=?)',vault,row.id,row.id);
  metadata.temporal_date_id=definition.valueKind==='date'&&metadata.compatibility==='valid'?evidence?.date_id??null:null;
  store.run(`INSERT INTO property_value_metadata (property_id,vault_id,definition_id,compatibility,reason,integer_value,decimal_value,boolean_value,text_value,latitude,longitude,unit,position,target_id,temporal_date_id)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(property_id) DO UPDATE SET vault_id=excluded.vault_id,definition_id=excluded.definition_id,compatibility=excluded.compatibility,reason=excluded.reason,integer_value=excluded.integer_value,decimal_value=excluded.decimal_value,boolean_value=excluded.boolean_value,text_value=excluded.text_value,latitude=excluded.latitude,longitude=excluded.longitude,unit=excluded.unit,position=excluded.position,target_id=excluded.target_id,temporal_date_id=excluded.temporal_date_id WHERE property_value_metadata.vault_id IS NOT excluded.vault_id OR property_value_metadata.definition_id IS NOT excluded.definition_id OR property_value_metadata.compatibility IS NOT excluded.compatibility OR property_value_metadata.reason IS NOT excluded.reason OR property_value_metadata.integer_value IS NOT excluded.integer_value OR property_value_metadata.decimal_value IS NOT excluded.decimal_value OR property_value_metadata.boolean_value IS NOT excluded.boolean_value OR property_value_metadata.text_value IS NOT excluded.text_value OR property_value_metadata.latitude IS NOT excluded.latitude OR property_value_metadata.longitude IS NOT excluded.longitude OR property_value_metadata.unit IS NOT excluded.unit OR property_value_metadata.position IS NOT excluded.position OR property_value_metadata.target_id IS NOT excluded.target_id OR property_value_metadata.temporal_date_id IS NOT excluded.temporal_date_id`,row.id,vault,metadata.definition_id,metadata.compatibility,metadata.reason,metadata.integer_value,metadata.decimal_value,metadata.boolean_value,metadata.text_value,metadata.latitude,metadata.longitude,metadata.unit,metadata.position,metadata.target_id,metadata.temporal_date_id);
 }
}
/** Bind an explicit typed request after the authored property write, then derive its mirrors. */
export function bindPropertyDefinition(store:Store,vault:string,propertyId:string,definitionId:string) {
 const row=store.get<{entity_id:string}>('SELECT p.entity_id FROM properties p JOIN entities e ON e.id=p.entity_id WHERE p.id=? AND e.vault_id=?',propertyId,vault);
 if(!row)throw new Error('Property not found in this vault');
 syncPropertyMetadata(store,vault,row.entity_id);
 store.run('UPDATE property_value_metadata SET definition_id=? WHERE property_id=? AND vault_id=?',definitionId,propertyId,vault);
 syncPropertyMetadata(store,vault,row.entity_id);
}
export function propertyMetadata(store:Store,vault:string,entityId:string):Map<string,PropertyValueMetadata> {
 syncPropertyMetadata(store,vault,entityId);
 return new Map(store.all<PropertyValueMetadata&{property_id:string;vault_id:string}>('SELECT m.* FROM property_value_metadata m JOIN properties p ON p.id=m.property_id WHERE m.vault_id=? AND p.entity_id=?',vault,entityId).map(({property_id,vault_id:_vault,...metadata})=>[property_id,metadata]));
}
export function setupPropertyStorage(db:DatabaseSync) {
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS entities_vault_identity ON entities(vault_id,id);
 CREATE TABLE IF NOT EXISTS property_definitions (vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,id TEXT NOT NULL,definition_json TEXT NOT NULL,PRIMARY KEY(vault_id,id));
 CREATE TABLE IF NOT EXISTS property_value_metadata (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,vault_id TEXT NOT NULL,definition_id TEXT NOT NULL,
  compatibility TEXT NOT NULL CHECK(compatibility IN ('valid','legacy_incompatible','unresolved','unknown')),reason TEXT,
  integer_value INTEGER,decimal_value REAL,boolean_value INTEGER CHECK(boolean_value IS NULL OR boolean_value IN (0,1)),text_value TEXT,latitude REAL,longitude REAL,unit TEXT,position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0),target_id TEXT,temporal_date_id TEXT,
  FOREIGN KEY(vault_id,definition_id) REFERENCES property_definitions(vault_id,id),FOREIGN KEY(vault_id,target_id) REFERENCES entities(vault_id,id),FOREIGN KEY(vault_id,temporal_date_id) REFERENCES temporal_dates(vault_id,id) ON DELETE CASCADE);
 CREATE INDEX IF NOT EXISTS property_metadata_integer ON property_value_metadata(vault_id,definition_id,integer_value);
 CREATE INDEX IF NOT EXISTS property_metadata_decimal ON property_value_metadata(vault_id,definition_id,decimal_value);
 CREATE INDEX IF NOT EXISTS property_metadata_text ON property_value_metadata(vault_id,definition_id,text_value);
 CREATE INDEX IF NOT EXISTS property_metadata_boolean ON property_value_metadata(vault_id,definition_id,boolean_value);
 CREATE INDEX IF NOT EXISTS property_metadata_coordinates ON property_value_metadata(vault_id,definition_id,latitude,longitude);
 CREATE INDEX IF NOT EXISTS property_metadata_temporal ON property_value_metadata(vault_id,definition_id,temporal_date_id);
 CREATE INDEX IF NOT EXISTS property_metadata_target ON property_value_metadata(vault_id,target_id);
 CREATE TRIGGER IF NOT EXISTS property_metadata_invalidate AFTER UPDATE ON properties BEGIN UPDATE property_value_metadata SET compatibility='legacy_incompatible',reason='Pending compatibility refresh',integer_value=NULL,decimal_value=NULL,boolean_value=NULL,text_value=NULL,latitude=NULL,longitude=NULL,unit=NULL,target_id=NULL,temporal_date_id=NULL WHERE property_id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS entity_property_metadata_invalidate AFTER UPDATE OF type,subtypes ON entities BEGIN UPDATE property_value_metadata SET compatibility='legacy_incompatible',reason='Pending classification refresh',integer_value=NULL,decimal_value=NULL,boolean_value=NULL,text_value=NULL,latitude=NULL,longitude=NULL,unit=NULL,target_id=NULL,temporal_date_id=NULL WHERE property_id IN (SELECT id FROM properties WHERE entity_id=NEW.id OR target_id=NEW.id); END;
 CREATE TRIGGER IF NOT EXISTS property_metadata_owner_insert BEFORE INSERT ON property_value_metadata WHEN NOT EXISTS(SELECT 1 FROM properties p JOIN entities e ON e.id=p.entity_id WHERE p.id=NEW.property_id AND e.vault_id=NEW.vault_id) BEGIN SELECT RAISE(ABORT,'Property metadata must belong to the owner vault'); END;
 CREATE TRIGGER IF NOT EXISTS property_metadata_owner_update BEFORE UPDATE OF vault_id,property_id ON property_value_metadata WHEN NOT EXISTS(SELECT 1 FROM properties p JOIN entities e ON e.id=p.entity_id WHERE p.id=NEW.property_id AND e.vault_id=NEW.vault_id) BEGIN SELECT RAISE(ABORT,'Property metadata must belong to the owner vault'); END;
 CREATE TRIGGER IF NOT EXISTS entity_property_vault_move BEFORE UPDATE OF vault_id ON entities WHEN NEW.vault_id IS NOT OLD.vault_id AND (EXISTS(SELECT 1 FROM properties p JOIN entities other ON other.id=p.target_id WHERE p.entity_id=OLD.id AND other.vault_id<>NEW.vault_id) OR EXISTS(SELECT 1 FROM properties p JOIN entities other ON other.id=p.entity_id WHERE p.target_id=OLD.id AND other.vault_id<>NEW.vault_id) OR EXISTS(SELECT 1 FROM property_value_metadata WHERE property_id IN (SELECT id FROM properties WHERE entity_id=OLD.id))) BEGIN SELECT RAISE(ABORT,'Property references require an explicit vault-move impact path'); END;
 CREATE TRIGGER IF NOT EXISTS property_owner_vault_move BEFORE UPDATE OF entity_id ON properties WHEN (SELECT vault_id FROM entities WHERE id=NEW.entity_id) IS NOT (SELECT vault_id FROM entities WHERE id=OLD.entity_id) BEGIN SELECT RAISE(ABORT,'Property ownership requires an explicit vault-move impact path'); END;
 CREATE TRIGGER IF NOT EXISTS property_same_vault_insert BEFORE INSERT ON properties WHEN NEW.target_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities owner JOIN entities target ON target.vault_id=owner.vault_id WHERE owner.id=NEW.entity_id AND target.id=NEW.target_id) BEGIN SELECT RAISE(ABORT,'Property target must belong to the same vault'); END;
 CREATE TRIGGER IF NOT EXISTS property_same_vault_update BEFORE UPDATE OF entity_id,target_id ON properties WHEN NEW.target_id IS NOT NULL AND (NEW.target_id IS NOT OLD.target_id OR NEW.entity_id IS NOT OLD.entity_id) AND NOT EXISTS(SELECT 1 FROM entities owner JOIN entities target ON target.vault_id=owner.vault_id WHERE owner.id=NEW.entity_id AND target.id=NEW.target_id) BEGIN SELECT RAISE(ABORT,'Property target must belong to the same vault'); END;`);
 if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=5').get()) {
  const store=new Store(db);store.transaction(()=>{
   store.run("INSERT OR IGNORE INTO temporal_property_dirty (property_id,vault_id) SELECT p.id,e.vault_id FROM properties p JOIN entities e ON e.id=p.entity_id WHERE e.type='organization' AND lower(p.name)='founded'");
   for(const vault of store.all<{id:string}>('SELECT id FROM vaults'))syncPropertyMetadata(store,vault.id);
   store.run("INSERT INTO schema_migrations VALUES (5,datetime('now'))");
  });
 }
}
