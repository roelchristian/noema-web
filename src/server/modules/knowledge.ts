import { randomUUID } from 'node:crypto';
import { entityTypes, type Entity, type EntityDetail, type Property, type Relationship } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, now, required, text } from '../validation.js';
export class Knowledge {
  constructor(private store: Store) {}
  list(vault: string) { return this.store.all<Entity>('SELECT * FROM entities WHERE vault_id=? ORDER BY name COLLATE NOCASE',vault); }
  find(vault: string, id: string) { return this.store.get<Entity>('SELECT * FROM entities WHERE id=? AND vault_id=?',id,vault); }
  require(vault: string, id: string) {
    const entity=this.find(vault,id);
    if (!entity) throw new HttpError(404,'Entity not found');
    return entity;
  }
  detail(vault: string, id: string): EntityDetail {
    return {...this.require(vault,id),
      properties:this.store.all<Property>('SELECT * FROM properties WHERE entity_id=?',id),
      relationships:this.store.all<Relationship>('SELECT * FROM relationships WHERE source_id=? OR target_id=?',id,id),
      incomingProperties:this.store.all<Property>('SELECT * FROM properties WHERE target_id=?',id)};
  }
  private input(body: Record<string, unknown>) {
    const type=entityTypes.find(t=>t===body.type);
    if (!type) throw new HttpError(400,'Invalid entity type');
    return {name:required(body.name),type,description:text(body.description ?? '')};
  }
  create(vault: string, body: Record<string, unknown>) {
    const e=this.input(body),id=randomUUID();
    this.store.run('INSERT INTO entities (id,name,type,description,updated_at,vault_id) VALUES (?,?,?,?,?,?)',id,e.name,e.type,e.description,now(),vault);
    return this.detail(vault,id);
  }
  update(vault: string, id: string, body: Record<string, unknown>) {
    this.require(vault,id);const e=this.input(body);
    if (e.type!=='source' && this.store.get('SELECT 1 FROM page_sources WHERE source_id=? LIMIT 1',id)) throw new HttpError(400,'Remove page source references before changing this Source to another type');
    this.store.run('UPDATE entities SET name=?,type=?,description=?,updated_at=? WHERE id=? AND vault_id=?',e.name,e.type,e.description,now(),id,vault);
    return this.detail(vault,id);
  }
  property(vault: string, id: string, body: Record<string, unknown>, propertyId?: string) {
    this.require(vault,id);
    const target=body.target_id ? required(body.target_id) : null;
    if (target && !this.find(vault,target)) throw new HttpError(400,'Target entity not found');
    const name=required(body.name),value=target?null:text(body.value);
    if (propertyId) {
      if (!this.store.run('UPDATE properties SET name=?,value=?,target_id=? WHERE id=? AND entity_id=?',name,value,target,propertyId,id).changes) throw new HttpError(404,'Property not found');
    } else this.store.run('INSERT INTO properties VALUES (?,?,?,?,?)',randomUUID(),id,name,value,target);
    return this.detail(vault,id);
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
