import {validatedDomainIds} from './domains.js';
import { syncSourceProvenance } from './source-provenance.js';
import { randomUUID } from 'node:crypto';
import { makeSearchSnippet } from '../../shared/search-snippets.js';
import { blockSegments, entityMentionName, entityTypes, type EntityType, type Entity, type EntityDetail, type EntityPageMention, type Block, type Property, type Relationship } from '../../shared/domain.js';
import { builtinProperties, builtinSubtypes, inheritedPropertyNames, type EntitySchema, type EntitySubtype } from '../../shared/entity-schema.js';
import { Store } from '../store.js';
import { HttpError, now, required, text } from '../validation.js';
import { normalizeEntityName } from '../../shared/auto-entities.js';
type EntityRow = Omit<Entity, 'subtypes' | 'aliases' | 'mentionCase' | 'inactive'> & {inactive:number;subtypes: string; aliases: string; mention_case: 'canonical' | 'lowercase'; subtype?: string | null};
export class Knowledge {
  constructor(private store: Store) {}
  schema(vault: string): EntitySchema {
    const properties = {...builtinProperties};
    for (const type of entityTypes) {
      const names = [...builtinProperties[type], ...this.store.all<{name: string}>('SELECT name FROM entity_type_properties WHERE vault_id=? AND type=? ORDER BY name',vault,type).map(p => p.name)];
      properties[type] = names.filter((name,index) => names.findIndex(candidate => candidate.toLowerCase() === name.toLowerCase()) === index);
    }
    const subtypeProperties: Record<string, string[]> = Object.create(null);
    for (const row of this.store.all<{subtype_id: string; name: string}>('SELECT subtype_id,name FROM entity_subtype_properties WHERE vault_id=? ORDER BY name',vault)) {
      (subtypeProperties[row.subtype_id] ??= []).push(row.name);
    }
    return {properties, subtypeProperties, subtypes: [...builtinSubtypes, ...this.store.all<EntitySubtype>('SELECT id,name,type FROM entity_subtypes WHERE vault_id=? ORDER BY name',vault)]};
  }
  addSubtype(vault: string, body: Record<string, unknown>) {
    const type = this.mainType(body.type), name = required(body.name);
    if (body.properties !== undefined) throw new HttpError(400,'Create the subtype before adding its property definitions');
    if (this.schema(vault).subtypes.some(s => s.type === type && s.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409,'This subtype already exists');
    this.store.run('INSERT INTO entity_subtypes VALUES (?,?,?,?)',randomUUID(),vault,type,name);
    return this.schema(vault);
  }
  addTypeProperty(vault: string, body: Record<string, unknown>) {
    const type = this.mainType(body.type);
    const subtype = required(body.subtype), name = required(body.name);
    const schema = this.schema(vault);
    if (!schema.subtypes.some(item => item.id === subtype && item.type === type)) throw new HttpError(400,'Choose a subtype in this category');
    if (!inheritedPropertyNames(schema,type,[subtype]).some(field => field.toLowerCase() === name.toLowerCase())) {
      this.store.run('INSERT OR IGNORE INTO entity_subtype_properties (vault_id,subtype_id,name) VALUES (?,?,?)',vault,subtype,name);
    }
    return this.schema(vault);
  }
  private mainType(value: unknown) {
    const type = entityTypes.find(t => t === value);
    if (!type) throw new HttpError(400,'Invalid entity type');
    return type;
  }
  private entity(row: EntityRow, domainIds?:string[]): Entity {
    const {subtype: _legacy, subtypes, aliases, mention_case, ...entity} = row;
    return {...entity, domainIds:domainIds??this.store.all<{domain_id:string}>('SELECT domain_id FROM entity_domains WHERE entity_id=? ORDER BY domain_id',entity.id).map(row=>row.domain_id), inactive:!!entity.inactive, mentionCase: mention_case, aliases: entity.type==='source'?[]:JSON.parse(aliases) as string[], subtypes: JSON.parse(subtypes) as string[]};
  }
  list(vault: string) {
    const assignments=new Map<string,string[]>();
    for(const row of this.store.all<{entity_id:string;domain_id:string}>('SELECT d.entity_id,d.domain_id FROM entity_domains d JOIN entities e ON e.id=d.entity_id WHERE e.vault_id=? ORDER BY d.domain_id',vault)) {
      const ids=assignments.get(row.entity_id)??[];ids.push(row.domain_id);assignments.set(row.entity_id,ids);
    }
    return this.store.all<EntityRow>('SELECT e.*, (SELECT f.status FROM source_files f WHERE f.entity_id=e.id LIMIT 1) AS sourceStatus, (SELECT f.enrichment_status FROM source_files f WHERE f.entity_id=e.id LIMIT 1) AS sourceEnrichmentStatus FROM entities e WHERE e.vault_id=? ORDER BY e.name COLLATE NOCASE',vault).map(row => this.entity(row,assignments.get(row.id)??[]));
  }
  find(vault: string, id: string) {
    const row = this.store.get<EntityRow>('SELECT e.*, (SELECT f.status FROM source_files f WHERE f.entity_id=e.id LIMIT 1) AS sourceStatus, (SELECT f.enrichment_status FROM source_files f WHERE f.entity_id=e.id LIMIT 1) AS sourceEnrichmentStatus FROM entities e WHERE e.id=? AND e.vault_id=?',id,vault);
    return row ? this.entity(row) : undefined;
  }
  require(vault: string, id: string) {
    const entity=this.find(vault,id);
    if (!entity) throw new HttpError(404,'Entity not found');
    return entity;
  }
  private pageMentions(vault: string, id: string): EntityPageMention[] {
    const pages = this.store.all<Omit<EntityPageMention, 'excerpt' | 'mentionCount'> & {blocks: string}>(`
      SELECT p.id,p.title,p.icon,p.updated_at,p.blocks FROM pages p
      WHERE p.vault_id=? AND p.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM json_tree(p.blocks) mention WHERE mention.key='entityId' AND mention.value=?)
      ORDER BY p.updated_at DESC,p.id`, vault, id);
    if (!pages.length) return [];
    const names = new Map(this.list(vault).map(entity => [entity.id, entityMentionName(entity) ?? entity.name]));
    return pages.map(({blocks, ...page}) => {
      const parsed = JSON.parse(blocks) as Block[];
      const mentionCount = parsed.flatMap(blockSegments).filter(segment => segment.entityId === id).length;
      const match = parsed.find(block => blockSegments(block).some(segment => segment.entityId === id));
      const segments = match ? blockSegments(match) : [];
      const mention = segments.find(segment => segment.entityId === id);
      const label = mention?.mentionText ?? names.get(id) ?? '';
      const passage = segments.map(segment => segment.entityId ? segment.mentionText ?? names.get(segment.entityId) ?? '' : segment.text ?? '').join('');
      return {...page, mentionCount, excerpt: makeSearchSnippet(passage, label, 200)};
    }).filter(page => page.mentionCount > 0);
  }
  detail(vault: string, id: string): EntityDetail {
    const entity = this.require(vault,id);
    return {...entity, pageMentions: this.pageMentions(vault, id), ...(entity.type==='source'?{attachments:this.store.all<import('../../shared/domain.js').SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND entity_id=? ORDER BY created_at,id',vault,id)}:{}), propertyNames: inheritedPropertyNames(this.schema(vault),entity.type,entity.subtypes),
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
    const inputAliases = type==='source'?[]:body.aliases === undefined ? current?.aliases ?? [] : body.aliases;
    if (!Array.isArray(inputAliases) || inputAliases.length > 100 || inputAliases.some(alias => typeof alias !== 'string' || !alias.trim() || alias.trim().length > 200)) throw new HttpError(400,'Aliases must be up to 100 non-empty names of at most 200 characters');
    const aliases = [...new Map(inputAliases.map((alias: string) => [alias.trim().replace(/\s+/g, ' ').toLowerCase(), alias.trim().replace(/\s+/g, ' ')])).values()];
    const mentionCase=body.mentionCase===undefined?current?.mentionCase??'canonical':body.mentionCase;
    if(mentionCase!=='canonical'&&mentionCase!=='lowercase')throw new HttpError(400,'Choose entity-name or lowercase tag casing.');
    const domainIds=validatedDomainIds(body.domainIds??(current?.type===type?current.domainIds??[]:[]));
    if(type!=='concept'&&domainIds.length)throw new HttpError(400,'Only Concepts support disciplinary domains.');
    return {domainIds,name:required(body.name),aliases,mentionCase,type,subtypes,description:text(body.description ?? '')};
  }
  create(vault: string, body: Record<string, unknown>) {
    const attachmentIds=body.type==='source'?this.attachments(vault,body.attachmentIds):[];
    const filename=attachmentIds.length?this.store.get<{name:string}>('SELECT name FROM source_files WHERE id=? AND vault_id=?',attachmentIds[0]!,vault)?.name:undefined;
    const e=this.input(vault,{...body,name:typeof body.name==='string'&&body.name.trim()?body.name:filename?.slice(0,200)}),id=randomUUID();
    const create=() => {
      const attachments=attachmentIds;
      this.store.run('INSERT INTO entities (id,name,aliases,mention_case,type,subtypes,description,updated_at,vault_id) VALUES (?,?,?,?,?,?,?,?,?)',id,e.name,JSON.stringify(e.aliases),e.mentionCase,e.type,JSON.stringify(e.subtypes),e.description,now(),vault);
      for(const domainId of e.domainIds)this.store.run("INSERT INTO entity_domains (entity_id,domain_id,origin) VALUES (?,?,'manual')",id,domainId);
      for(const file of attachments)this.store.run('UPDATE source_files SET entity_id=? WHERE id=? AND vault_id=?',id,file,vault);
      if(e.type==='source'){
        this.store.run("UPDATE entities SET inactive=CASE WHEN EXISTS (SELECT 1 FROM source_files WHERE entity_id=? AND status='failed') THEN 1 ELSE 0 END WHERE id=?",id,id);
        syncSourceProvenance(this.store,vault,id);
      }
    };
    if(this.store.db.isTransaction)create();else this.store.transaction(create);
    return this.detail(vault,id);
  }
  private attachments(vault:string,value:unknown): string[] {
    if(!Array.isArray(value)||value.length!==1||value.some(id=>typeof id!=='string'))throw new HttpError(400,'A source requires exactly one file or URL.');
    const ids=[...new Set(value as string[])];
    for(const id of ids)if(!this.store.get('SELECT 1 FROM source_files WHERE id=? AND vault_id=? AND entity_id IS NULL',id,vault))throw new HttpError(400,'Choose an unattached source file from this vault.');
    return ids;
  }
  update(vault: string, id: string, body: Record<string, unknown>) {
    const current=this.require(vault,id),e=this.input(vault,body,current);
    const properties=this.detail(vault,id).properties;
    const inherited = inheritedPropertyNames(this.schema(vault),e.type,e.subtypes);
    if (properties.some(p => !inherited.some(name => name.toLowerCase() === p.name.toLowerCase()))) throw new HttpError(400,'This entity has values outside the selected category and subtypes. Clear those values or define the fields on the new subtype first.');
    if (e.type!=='source' && this.store.get('SELECT 1 FROM source_files WHERE entity_id=?',id)) throw new HttpError(400,'A source with attached files must remain a Source entity');
    if (e.type==='source' && current.type!=='source') throw new HttpError(400,'Create a source with an attached file instead of changing this entity type');
    if (e.type!=='source' && this.store.get('SELECT 1 FROM page_sources WHERE source_id=? LIMIT 1',id)) throw new HttpError(400,'Remove page source references before changing this Source to another type');
    this.store.transaction(() => {
      this.store.run('UPDATE entities SET name=?,aliases=?,mention_case=?,type=?,subtype=NULL,subtypes=?,description=?,updated_at=? WHERE id=? AND vault_id=?',e.name,JSON.stringify(e.aliases),e.mentionCase,e.type,JSON.stringify(e.subtypes),e.description,now(),id,vault);
      this.store.run('DELETE FROM entity_domains WHERE entity_id=?',id);
      for(const domainId of e.domainIds)this.store.run("INSERT INTO entity_domains (entity_id,domain_id,origin) VALUES (?,?,'manual')",id,domainId);
    });
    return this.detail(vault,id);
  }
  addAlias(vault: string, id: string, body: Record<string, unknown>) {
    const alias = required(body.alias,200).replace(/\s+/g, ' ');
    return this.store.transaction(() => {
      const entity = this.require(vault,id), aliases = entity.aliases ?? [];
      if(entity.type==='source')throw new HttpError(400,'Sources do not support aliases.');
      if ([entity.name, ...aliases].some(name => normalizeEntityName(name) === normalizeEntityName(alias))) return this.detail(vault,id);
      if (aliases.length >= 100) throw new HttpError(400,'This entity already has 100 aliases. Remove an alias before adding another.');
      this.store.run('UPDATE entities SET aliases=?,updated_at=? WHERE id=? AND vault_id=?',JSON.stringify([...aliases,alias]),now(),id,vault);
      return this.detail(vault,id);
    });
  }
  property(vault: string, id: string, body: Record<string, unknown>, propertyId?: string) {
    const entity=this.require(vault,id);
    const target=body.target_id ? required(body.target_id) : null;
    if (target && !this.find(vault,target)) throw new HttpError(400,'Target entity not found');
    const requestedName=required(body.name),value=target?null:text(body.value);
    const name=inheritedPropertyNames(this.schema(vault),entity.type,entity.subtypes).find(field => field.toLowerCase() === requestedName.toLowerCase());
    if (!name) throw new HttpError(400,'Choose an inherited property. Define new fields on the subtype in Settings → Knowledge Entities.');
    return this.store.transaction(() => {
      if (propertyId) {
        if (!this.store.run('UPDATE properties SET name=?,value=?,target_id=? WHERE id=? AND entity_id=?',name,value,target,propertyId,id).changes) throw new HttpError(404,'Property not found');
      } else this.store.run('INSERT INTO properties VALUES (?,?,?,?,?)',randomUUID(),id,name,value,target);
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
