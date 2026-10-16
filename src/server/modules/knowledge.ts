import { randomUUID } from 'node:crypto';
import { entityTypes, type EntityType, type Entity, type EntityDetail, type Property, type Relationship } from '../../shared/domain.js';
import { builtinProperties, builtinSubtypes, type EntitySchema, type EntitySubtype } from '../../shared/entity-schema.js';
import { Store } from '../store.js';
import { HttpError, now, required, text } from '../validation.js';
export class Knowledge {
  constructor(private store: Store) {}
  schema(vault: string): EntitySchema {
    const properties = {...builtinProperties};
    for (const type of entityTypes) {
      const names = [...builtinProperties[type], ...this.store.all<{name: string}>('SELECT name FROM entity_type_properties WHERE vault_id=? AND type=? ORDER BY name',vault,type).map(p => p.name)];
      properties[type] = names.filter((name,index) => names.findIndex(candidate => candidate.toLowerCase() === name.toLowerCase()) === index);
    }
    return {properties, subtypes: [...builtinSubtypes, ...this.store.all<EntitySubtype>('SELECT id,name,type FROM entity_subtypes WHERE vault_id=? ORDER BY name',vault)]};
  }
  addSubtype(vault: string, body: Record<string, unknown>) {
    const type = this.mainType(body.type), name = required(body.name);
    if (body.properties !== undefined) throw new HttpError(400,'Subtypes inherit properties from their main type');
    if (this.schema(vault).subtypes.some(s => s.type === type && s.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409,'This subtype already exists');
    this.store.run('INSERT INTO entity_subtypes VALUES (?,?,?,?)',randomUUID(),vault,type,name);
    return this.schema(vault);
  }
  addTypeProperty(vault: string, body: Record<string, unknown>) {
    const type = this.mainType(body.type);
    if (body.subtype != null || (body.subtypes !== undefined && (!Array.isArray(body.subtypes) || body.subtypes.length > 0))) throw new HttpError(400,'Add properties to the main type, not a subtype');
    this.registerProperty(vault,type,required(body.name));
    return this.schema(vault);
  }
  private mainType(value: unknown) {
    const type = entityTypes.find(t => t === value);
    if (!type) throw new HttpError(400,'Invalid entity type');
    return type;
  }
  private registerProperty(vault: string, type: EntityType, name: string) {
    this.store.run('INSERT OR IGNORE INTO entity_type_properties VALUES (?,?,?)',vault,type,name);
  }
  private entity(row: Omit<Entity, 'subtypes'> & {subtypes: string; subtype?: string | null}): Entity {
    const {subtype: _legacy, subtypes, ...entity} = row;
    return {...entity, subtypes: JSON.parse(subtypes) as string[]};
  }
  list(vault: string) { return this.store.all<Omit<Entity, 'subtypes'> & {subtypes: string}>('SELECT * FROM entities WHERE vault_id=? ORDER BY name COLLATE NOCASE',vault).map(row => this.entity(row)); }
  find(vault: string, id: string) {
    const row = this.store.get<Omit<Entity, 'subtypes'> & {subtypes: string}>('SELECT * FROM entities WHERE id=? AND vault_id=?',id,vault);
    return row ? this.entity(row) : undefined;
  }
  require(vault: string, id: string) {
    const entity=this.find(vault,id);
    if (!entity) throw new HttpError(404,'Entity not found');
    return entity;
  }
  detail(vault: string, id: string): EntityDetail {
    const entity = this.require(vault,id);
    return {...entity, propertyNames: this.schema(vault).properties[entity.type],
      properties:this.store.all<Property>('SELECT * FROM properties WHERE entity_id=?',id),
      relationships:this.store.all<Relationship>('SELECT * FROM relationships WHERE source_id=? OR target_id=?',id,id),
      incomingProperties:this.store.all<Property>('SELECT * FROM properties WHERE target_id=?',id)};
  }
  private input(vault: string, body: Record<string, unknown>, current?: Entity) {
    const type=this.mainType(body.type);
    if (body.subtypes !== undefined && body.subtype !== undefined) throw new HttpError(400,'Supply subtypes only');
    // Continue accepting the former single-subtype input for older clients.
    const selection = body.subtypes !== undefined ? body.subtypes : body.subtype !== undefined ? (body.subtype === null ? [] : [body.subtype]) : current?.type === type ? current.subtypes : [];
    if (!Array.isArray(selection) || selection.length > 1000 || selection.some(id => typeof id !== 'string')) throw new HttpError(400,'Subtypes must be an array of subtype IDs');
    const subtypes = [...new Set(selection as string[])];
    const available = this.schema(vault).subtypes.filter(s => s.type === type);
    if (subtypes.some(id => !available.some(s => s.id === id))) throw new HttpError(400,'Invalid subtype for this main type');
    return {name:required(body.name),type,subtypes,description:text(body.description ?? '')};
  }
  create(vault: string, body: Record<string, unknown>) {
    const e=this.input(vault,body),id=randomUUID();
    this.store.run('INSERT INTO entities (id,name,type,subtypes,description,updated_at,vault_id) VALUES (?,?,?,?,?,?,?)',id,e.name,e.type,JSON.stringify(e.subtypes),e.description,now(),vault);
    return this.detail(vault,id);
  }
  update(vault: string, id: string, body: Record<string, unknown>) {
    const current=this.require(vault,id),e=this.input(vault,body,current);
    const properties=this.detail(vault,id).properties;
    const inherited = this.schema(vault).properties[e.type];
    if (e.subtypes.length && properties.some(p => !inherited.some(name => name.toLowerCase() === p.name.toLowerCase()))) throw new HttpError(400,'This entity has properties outside the selected main type. Add those fields to the main type first.');
    if (e.type!=='source' && this.store.get('SELECT 1 FROM page_sources WHERE source_id=? LIMIT 1',id)) throw new HttpError(400,'Remove page source references before changing this Source to another type');
    this.store.transaction(() => {
      this.store.run('UPDATE entities SET name=?,type=?,subtype=NULL,subtypes=?,description=?,updated_at=? WHERE id=? AND vault_id=?',e.name,e.type,JSON.stringify(e.subtypes),e.description,now(),id,vault);
      if (!e.subtypes.length) for (const p of properties) this.registerProperty(vault,e.type,p.name);
    });
    return this.detail(vault,id);
  }
  property(vault: string, id: string, body: Record<string, unknown>, propertyId?: string) {
    const entity=this.require(vault,id);
    const target=body.target_id ? required(body.target_id) : null;
    if (target && !this.find(vault,target)) throw new HttpError(400,'Target entity not found');
    const name=required(body.name),value=target?null:text(body.value);
    if (entity.subtypes.length && !this.schema(vault).properties[entity.type].some(p => p.toLowerCase() === name.toLowerCase())) throw new HttpError(400,'Subtypes can only use properties inherited from their main type');
    return this.store.transaction(() => {
      if (propertyId) {
        if (!this.store.run('UPDATE properties SET name=?,value=?,target_id=? WHERE id=? AND entity_id=?',name,value,target,propertyId,id).changes) throw new HttpError(404,'Property not found');
      } else this.store.run('INSERT INTO properties VALUES (?,?,?,?,?)',randomUUID(),id,name,value,target);
      if (!entity.subtypes.length) this.registerProperty(vault,entity.type,name);
      return this.detail(vault,id);
    });
  }
  relationship(vault: string, id: string, body: Record<string, unknown>, relationshipId?: string) {
    this.require(vault,id);const target=required(body.target_id),label=required(body.label);
    if (!this.find(vault,target)) throw new HttpError(400,'Target entity not found');
    if (relationshipId) {
      if (!this.store.run('UPDATE relationships SET label=?,target_id=? WHERE id=? AND source_id=?',label,target,relationshipId,id).changes) throw new HttpError(404,'Relationship not found');
    } else this.store.run('INSERT INTO relationships VALUES (?,?,?,?)',randomUUID(),id,label,target);
    return this.detail(vault,id);
  }
  remove(vault: string, id: string, kind: 'properties' | 'relationships', childId: string) {
    this.require(vault,id);
    this.store.run(`DELETE FROM ${kind} WHERE id=? AND ${kind==='properties'?'entity_id':'source_id'}=?`,childId,id);
    return this.detail(vault,id);
  }
}
