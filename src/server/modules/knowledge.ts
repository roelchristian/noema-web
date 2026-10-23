import {Vaults} from './vaults.js';
import {sourceProgress} from './source-progress.js';
import {validatedDomainIds} from './domains.js';
import { syncSourceProvenance } from './source-provenance.js';
import { randomUUID } from 'node:crypto';
import { entityPageMentions } from './entity-page-mentions.js';
import { entityMentionName, entityTypes, type EntityType, type Entity, type EntityDetail, type Property, type Relationship } from '../../shared/domain.js';
import { builtinProperties, builtinSubtypes, inheritedPropertyNames, type EntitySchema, type EntitySubtype } from '../../shared/entity-schema.js';
import { persistedPropertyDefinitions, propertyMetadata, syncPropertyMetadata } from './property-storage.js';
import { validatePropertyValue } from '../../shared/property-values.js';
import { TemporalProperties } from './temporal-properties.js';
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
    const schema: EntitySchema = {properties, subtypeProperties, subtypes: [...builtinSubtypes, ...this.store.all<EntitySubtype>('SELECT id,name,type FROM entity_subtypes WHERE vault_id=? ORDER BY name',vault)]};
    return {...schema, propertyDefinitions: persistedPropertyDefinitions(this.store,vault,schema)};
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
    return this.store.all<EntityRow>('SELECT e.*, (SELECT f.size FROM source_files f WHERE f.entity_id=e.id LIMIT 1) AS sourceSize, (SELECT f.status FROM source_files f WHERE f.entity_id=e.id LIMIT 1) AS sourceStatus, (SELECT f.enrichment_status FROM source_files f WHERE f.entity_id=e.id LIMIT 1) AS sourceEnrichmentStatus FROM entities e WHERE e.vault_id=? ORDER BY e.name COLLATE NOCASE',vault).map(row => this.entity(row,assignments.get(row.id)??[]));
  }
  referenceOptions(vault: string, options: {query?: string; types?: string[]; subtypes?: string[]; offset?: number; limit?: number; selected?: string} = {}) {
    const {query = '', types = [], subtypes = [], offset = 0, limit = 30, selected = ''} = options;
    if (query.length > 200 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new HttpError(400,'Invalid reference search bounds.');
    if (types.some(type => !entityTypes.includes(type as EntityType)) || types.length > 9 || subtypes.length > 50) throw new HttpError(400,'Invalid reference target filters.');
    const schema = this.schema(vault);
    if (subtypes.some(id => !schema.subtypes.some(subtype => subtype.id === id))) throw new HttpError(400,'Unknown reference subtype.');
    const filters = ['e.archived_at IS NULL'], params: (string | number)[] = [];
    if (types.length) {filters.push(`e.type IN (${types.map(() => '?').join(',')})`); params.push(...types);}
    if (subtypes.length) {filters.push(`EXISTS (SELECT 1 FROM json_each(e.subtypes) s WHERE s.value IN (${subtypes.map(() => '?').join(',')}))`); params.push(...subtypes);}
    if (query) {filters.push('(instr(lower(e.name),lower(?))>0 OR EXISTS (SELECT 1 FROM json_each(e.aliases) a WHERE instr(lower(a.value),lower(?))>0))'); params.push(query,query);}
    const where = `e.vault_id=? AND (e.id=? OR (${filters.join(' AND ')}))`;
    const total = this.store.get<{count:number}>(`SELECT count(*) AS count FROM entities e WHERE ${where}`,vault,selected,...params)!.count;
    const rows = this.store.all<EntityRow>(`SELECT e.* FROM entities e WHERE ${where} ORDER BY CASE WHEN e.id=? THEN 0 ELSE 1 END,e.name COLLATE NOCASE,e.id LIMIT ? OFFSET ?`,vault,selected,...params,selected,limit,offset);
    return {items:rows.map(row => this.entity(row)), total, nextOffset:offset+rows.length<total?offset+rows.length:null};
  }
  find(vault: string, id: string) {
    const row = this.store.get<EntityRow>('SELECT e.*, (SELECT f.size FROM source_files f WHERE f.entity_id=e.id LIMIT 1) AS sourceSize, (SELECT f.status FROM source_files f WHERE f.entity_id=e.id LIMIT 1) AS sourceStatus, (SELECT f.enrichment_status FROM source_files f WHERE f.entity_id=e.id LIMIT 1) AS sourceEnrichmentStatus FROM entities e WHERE e.id=? AND e.vault_id=?',id,vault);
    return row ? this.entity(row) : undefined;
  }
  require(vault: string, id: string) {
    const entity=this.find(vault,id);
    if (!entity) throw new HttpError(404,'Entity not found');
    return entity;
  }
  detail(vault: string, id: string, preview = false): EntityDetail {
    const limit = preview ? 12 : -1;
    const entity = this.require(vault,id);
    const metadata = propertyMetadata(this.store,vault,id);
    const overview=this.store.get<{content:string;revision:number}>('SELECT content,revision FROM entity_overviews WHERE entity_id=?',id)??{content:'',revision:0};
    const propertyOrder = builtinProperties[entity.type].map(name=>name.toLowerCase());
    const linkedPages=this.store.all<Omit<import('../../shared/domain.js').EntityPageAssociation,'pinned'> & {pinned:number}>(`SELECT p.id,p.title,p.icon,p.updated_at,a.pinned,a.annotation,a.created_at FROM entity_page_associations a JOIN pages p ON p.id=a.page_id WHERE a.entity_id=? AND p.vault_id=? AND p.deleted_at IS NULL ORDER BY a.pinned DESC,a.created_at DESC,p.id LIMIT ?`,id,vault,limit).map(row=>({...row,pinned:!!row.pinned}));
    return {...entity, ...(preview ? {previewLimited:true} : {}), overview, linkedPages, pageMentions: entityPageMentions(this.store, vault, id, preview ? 6 : undefined), ...(entity.type==='source'?{attachments:this.store.all<import('../../shared/domain.js').SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND entity_id=? ORDER BY created_at,id',vault,id).map(file=>({...file,processing_detail:sourceProgress.get(file.id)}))}:{}), propertyNames: inheritedPropertyNames(this.schema(vault),entity.type,entity.subtypes),
      properties:this.store.all<Property>(`SELECT * FROM properties WHERE entity_id=? ORDER BY COALESCE((SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=lower(name)),999),name COLLATE NOCASE,COALESCE((SELECT position FROM property_value_metadata WHERE property_id=properties.id),0),id LIMIT ?`,id,JSON.stringify(propertyOrder),limit).map(property=>({...property,metadata:metadata.get(property.id)})),
      relationships:this.store.all<Relationship>('SELECT * FROM relationships WHERE source_id=? OR target_id=? ORDER BY label COLLATE NOCASE,id LIMIT ?',id,id,limit),
      incomingProperties:this.store.all<Property>('SELECT * FROM properties WHERE target_id=? ORDER BY name COLLATE NOCASE,id LIMIT ?',id,limit)};
  }
  private requireCuratable(vault:string,id:string) {
    new Vaults(this.store).requireOpen(vault);
    const entity=this.require(vault,id);
    if(entity.type==='source')throw new HttpError(400,'Source homepages use their source reader.');
    return entity;
  }
  private requireLivePage(vault:string,pageId:string) {
    new Vaults(this.store).requireOpen(vault);
    if(!this.store.get('SELECT 1 FROM pages WHERE id=? AND vault_id=? AND deleted_at IS NULL',pageId,vault))throw new HttpError(404,'Page not found');
  }
  private touch(vault:string,id:string) {
    const previous=this.require(vault,id).updated_at;
    this.store.run('UPDATE entities SET updated_at=? WHERE id=? AND vault_id=?',new Date(Math.max(Date.now(),Date.parse(previous)+1)).toISOString(),id,vault);
  }
  saveOverview(vault:string,id:string,body:Record<string,unknown>) {
    this.requireCuratable(vault,id);
    const content=text(body.content,100000),revision=body.revision;
    if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0)throw new HttpError(400,'Supply the overview revision.');
    return this.store.transaction(()=>{
      const current=this.store.get<{revision:number;content:string}>('SELECT revision,content FROM entity_overviews WHERE entity_id=?',id)??{revision:0,content:''};
      if(current.revision!==revision)throw new HttpError(409,'This overview changed. Reload it before saving.');
      if(current.content!==content){
        this.store.run('INSERT INTO entity_overviews (entity_id,content,revision) VALUES (?,?,?) ON CONFLICT(entity_id) DO UPDATE SET content=excluded.content,revision=excluded.revision',id,content,revision+1);
        this.touch(vault,id);
      }
      return this.detail(vault,id);
    });
  }
  createPage(vault:string,id:string,body:Record<string,unknown>,pages:import('./pages.js').Pages) {
    this.requireCuratable(vault,id);
    const title=body.title===undefined?'Untitled':text(body.title,500);
    return this.store.transaction(()=>{
      const page=pages.create(vault,{title});
      this.store.run("INSERT INTO entity_page_associations (entity_id,page_id,pinned,annotation,created_at) VALUES (?,?,0,'',?)",id,page.id,now());
      this.touch(vault,id);
      return page;
    });
  }
  associatePage(vault:string,id:string,pageId:string,body:Record<string,unknown>) {
    this.requireCuratable(vault,id);this.requireLivePage(vault,pageId);
    if(body.pinned!==undefined&&typeof body.pinned!=='boolean')throw new HttpError(400,'Pinned must be a boolean.');
    const annotation=body.annotation===undefined?undefined:text(body.annotation,2000);
    return this.store.transaction(()=>{
      const existing=this.store.get<{pinned:number;annotation:string}>('SELECT pinned,annotation FROM entity_page_associations WHERE entity_id=? AND page_id=?',id,pageId);
      const pinned=body.pinned===undefined?existing?.pinned??0:body.pinned?1:0;
      const nextAnnotation=annotation??existing?.annotation??'';
      if(!existing||existing.pinned!==pinned||existing.annotation!==nextAnnotation){
        this.store.run('INSERT INTO entity_page_associations (entity_id,page_id,pinned,annotation,created_at) VALUES (?,?,?,?,?) ON CONFLICT(entity_id,page_id) DO UPDATE SET pinned=excluded.pinned,annotation=excluded.annotation',id,pageId,pinned,nextAnnotation,now());
        this.touch(vault,id);
      }
      return this.detail(vault,id);
    });
  }
  removePage(vault:string,id:string,pageId:string) {
    this.requireCuratable(vault,id);this.requireLivePage(vault,pageId);
    return this.store.transaction(()=>{
      if(this.store.run('DELETE FROM entity_page_associations WHERE entity_id=? AND page_id=?',id,pageId).changes)this.touch(vault,id);
      return this.detail(vault,id);
    });
  }
  pageAssociations(vault:string,pageId:string):import('../../shared/domain.js').PageEntityAssociation[] {
    this.requireLivePage(vault,pageId);
    return this.store.all<{entityId:string;pinned:number;annotation:string}>(`SELECT a.entity_id AS entityId,a.pinned,a.annotation FROM entity_page_associations a JOIN entities e ON e.id=a.entity_id WHERE a.page_id=? AND e.vault_id=? ORDER BY e.name COLLATE NOCASE,e.id`,pageId,vault).map(row=>({...row,pinned:!!row.pinned}));
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
    const add = () => {
      const entity = this.require(vault,id), aliases = entity.aliases ?? [];
      if(entity.type==='source')throw new HttpError(400,'Sources do not support aliases.');
      if ([entity.name, ...aliases].some(name => normalizeEntityName(name) === normalizeEntityName(alias))) return this.detail(vault,id);
      if (aliases.length >= 100) throw new HttpError(400,'This entity already has 100 aliases. Remove an alias before adding another.');
      this.store.run('UPDATE entities SET aliases=?,updated_at=? WHERE id=? AND vault_id=?',JSON.stringify([...aliases,alias]),now(),id,vault);
      return this.detail(vault,id);
    };
    return this.store.db.isTransaction?add():this.store.transaction(add);
  }
  property(vault: string, id: string, body: Record<string, unknown>, propertyId?: string) {
    const entity=this.require(vault,id);
    const existing=propertyId?this.store.get<Property>('SELECT * FROM properties WHERE id=? AND entity_id=?',propertyId,id):undefined;
    if(propertyId&&!existing)throw new HttpError(404,'Property not found');
    if(body.compatibility_mode!==undefined&&body.compatibility_mode!=='legacy')throw new HttpError(400,'Unknown property compatibility mode.');
    if(body.compatibility_mode==='legacy'&&!existing)throw new HttpError(400,'Legacy compatibility is available for existing authored values.');
    const legacy=body.definition_id===undefined||body.compatibility_mode==='legacy';
    const target=body.target_id ? required(body.target_id) : null;
    const referenced=target?this.find(vault,target):undefined;
    if(target&&!referenced&&!(legacy&&existing?.target_id===target))throw new HttpError(400,'Target entity not found');
    const requestedName=required(body.name),value=target?null:text(body.value),schema=this.schema(vault);
    const name=inheritedPropertyNames(schema,entity.type,entity.subtypes).find(field=>field.toLowerCase()===requestedName.toLowerCase())
      ?? (legacy&&existing?.name.toLowerCase()===requestedName.toLowerCase()?existing.name:undefined);
    if(!name)throw new HttpError(400,'Choose an inherited property. Define new fields on the subtype in Settings → Knowledge Entities.');
    const definition=body.definition_id===undefined?undefined:schema.propertyDefinitions?.find(item=>item.id===body.definition_id&&item.legacyName.toLowerCase()===name.toLowerCase()&&item.scope.type===entity.type&&(item.scope.kind==='main_type'||entity.subtypes.includes(item.scope.subtypeId)));
    if(body.definition_id!==undefined&&!definition)throw new HttpError(400,'Choose an inherited definition for this property.');
    if(definition&&!legacy) {
      if(!definition.editable)throw new HttpError(400,'This definition is managed by source metadata.');
      const error=validatePropertyValue(definition,{name,value,target_id:target},referenced);
      if(error)throw new HttpError(400,error+' Existing authored values can use the explicit legacy compatibility path.');
      const others=this.store.all<Property>('SELECT * FROM properties WHERE entity_id=? AND lower(name)=lower(?) AND id<>?',id,name,propertyId??'');
      if(definition.cardinality==='one'&&others.length)throw new HttpError(409,'This single-value field already has authored values. Review them before replacing or use legacy compatibility to retain an existing value.');
      if(others.some(other=>other.value===value&&other.target_id===target))throw new HttpError(409,'This value already exists.');
    }
    return this.store.transaction(()=>{
      const savedId=propertyId??randomUUID();
      if(propertyId)this.store.run('UPDATE properties SET name=?,value=?,target_id=? WHERE id=? AND entity_id=?',name,value,target,savedId,id);
      else this.store.run('INSERT INTO properties VALUES (?,?,?,?,?)',savedId,id,name,value,target);
      if(definition?.valueKind==='date'&&!legacy)new TemporalProperties(this.store).refresh(vault,1,savedId);
      syncPropertyMetadata(this.store,vault,id);
      if(definition)this.store.run('UPDATE property_value_metadata SET definition_id=? WHERE property_id=? AND vault_id=?',definition.id,savedId,vault);
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
