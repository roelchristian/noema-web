import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {propertyOrigins,type PropertyProvenance,type EntityNameProvenance,type ProvenanceInput,type PropertyProposal,type PropertyProposalInput} from '../../shared/property-provenance.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';

export const rawSourceHash=(text:string):string=>createHash('sha256').update(text).digest('hex');
export function proposalIdentity(vault:string,input:PropertyProposalInput):string {
 return createHash('sha256').update(JSON.stringify([vault,input.entity_id,input.kind??'property',input.property_name??null,input.value??null,input.target_id??null,input.source_file_id??null,input.source_hash??null])).digest('hex');
}
function evidence(store:Store,vault:string,input:ProvenanceInput) {
 if(!propertyOrigins.includes(input.origin))throw new HttpError(400,'Unknown property origin.');
 if(input.source_file_id!==undefined&&input.source_file_id!==null&&(typeof input.source_file_id!=='string'||!input.source_file_id.trim()))throw new HttpError(400,'Invalid provenance source.');
 if(input.stale!==undefined&&typeof input.stale!=='boolean')throw new HttpError(400,'Invalid provenance stale state.');
 const source=input.source_file_id?store.get<{text:string}>('SELECT text FROM source_files WHERE id=? AND vault_id=?',input.source_file_id,vault):undefined;
 if(input.source_file_id&&!source)throw new HttpError(400,'Provenance source must belong to this vault.');
 if(input.source_hash!==undefined&&input.source_hash!==null&&(typeof input.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(input.source_hash)))throw new HttpError(400,'Invalid provenance source fingerprint.');
 if(input.details!==undefined&&(typeof input.details!=='string'||input.details.length>10000))throw new HttpError(400,'Invalid provenance details.');
 return {origin:input.origin,source_file_id:input.source_file_id??null,source_hash:input.source_hash??null,details:input.details??'',stale:input.stale||source&&input.source_hash&&rawSourceHash(source.text)!==input.source_hash?1:0};
}
export function recordPropertyProvenance(store:Store,vault:string,propertyId:string,input:ProvenanceInput):PropertyProvenance {
 if(!store.get('SELECT 1 FROM properties p JOIN entities e ON e.id=p.entity_id WHERE p.id=? AND e.vault_id=?',propertyId,vault))throw new HttpError(404,'Property not found in this vault.');
 const value=evidence(store,vault,input),timestamp=now();
 store.run(`INSERT INTO property_provenance(property_id,vault_id,origin,source_file_id,source_hash,details,stale,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
 ON CONFLICT(property_id) DO UPDATE SET vault_id=excluded.vault_id,origin=excluded.origin,source_file_id=excluded.source_file_id,source_hash=excluded.source_hash,details=excluded.details,stale=excluded.stale,updated_at=excluded.updated_at`,propertyId,vault,value.origin,value.source_file_id,value.source_hash,value.details,value.stale,timestamp,timestamp);
 return getPropertyProvenance(store,vault,propertyId)!;
}
export function recordEntityNameProvenance(store:Store,vault:string,entityId:string,input:ProvenanceInput):EntityNameProvenance {
 if(!store.get('SELECT 1 FROM entities WHERE id=? AND vault_id=?',entityId,vault))throw new HttpError(404,'Entity not found in this vault.');
 const value=evidence(store,vault,input),timestamp=now();
 store.run(`INSERT INTO entity_name_provenance(entity_id,vault_id,origin,source_file_id,source_hash,details,stale,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
 ON CONFLICT(entity_id) DO UPDATE SET vault_id=excluded.vault_id,origin=excluded.origin,source_file_id=excluded.source_file_id,source_hash=excluded.source_hash,details=excluded.details,stale=excluded.stale,updated_at=excluded.updated_at`,entityId,vault,value.origin,value.source_file_id,value.source_hash,value.details,value.stale,timestamp,timestamp);
 return getNameProvenance(store,vault,entityId)!;
}
function evidenceIsStale(store:Store,vault:string,row:{stale:number;source_file_id:string|null;source_hash:string|null}):boolean {
 if(row.stale)return true;
 if(!row.source_file_id||!row.source_hash)return false;
 const source=store.get<{text:string}>('SELECT text FROM source_files WHERE id=? AND vault_id=?',row.source_file_id,vault);
 return !source||rawSourceHash(source.text)!==row.source_hash;
}
export function getPropertyProvenance(store:Store,vault:string,propertyId:string):PropertyProvenance|undefined {
 const row=store.get<Omit<PropertyProvenance,'stale'>&{stale:number}>('SELECT * FROM property_provenance WHERE property_id=? AND vault_id=?',propertyId,vault);
 return row?{...row,stale:evidenceIsStale(store,vault,row)}:undefined;
}
export function getNameProvenance(store:Store,vault:string,entityId:string):EntityNameProvenance|undefined {
 const row=store.get<Omit<EntityNameProvenance,'stale'>&{stale:number}>('SELECT * FROM entity_name_provenance WHERE entity_id=? AND vault_id=?',entityId,vault);
 return row?{...row,stale:evidenceIsStale(store,vault,row)}:undefined;
}
export function proposeValue(store:Store,vault:string,input:PropertyProposalInput):PropertyProposal {
 if(!store.get('SELECT 1 FROM entities WHERE id=? AND vault_id=?',input.entity_id,vault))throw new HttpError(404,'Entity not found in this vault.');
 if(input.kind!==undefined&&input.kind!=='property'&&input.kind!=='entity_name')throw new HttpError(400,'Unknown proposal kind.');
 const kind=input.kind??'property',value=evidence(store,vault,input);
 if(kind==='property'&&(typeof input.property_name!=='string'||!input.property_name.trim()||input.property_name.length>200))throw new HttpError(400,'A property proposal requires its stored field name.');
 if(kind==='entity_name'&&(input.property_name!==undefined&&input.property_name!==null||input.target_id!==undefined&&input.target_id!==null))throw new HttpError(400,'Name proposals contain a literal name only.');
 if((input.value===null||input.value===undefined)===(input.target_id===null||input.target_id===undefined))throw new HttpError(400,'A proposal contains one literal or one entity reference.');
 if(input.value!==undefined&&input.value!==null&&(typeof input.value!=='string'||!input.value.trim()||input.value.length>10000))throw new HttpError(400,'Invalid proposed value.');
 if(input.target_id!==undefined&&input.target_id!==null&&(typeof input.target_id!=='string'||!input.target_id.trim()))throw new HttpError(400,'Invalid proposed target.');
 if(input.property_id!==undefined&&input.property_id!==null&&(typeof input.property_id!=='string'||!input.property_id.trim()))throw new HttpError(400,'Invalid related property.');
 if(input.target_id&&!store.get('SELECT 1 FROM entities WHERE id=? AND vault_id=?',input.target_id,vault))throw new HttpError(400,'Proposed target must belong to this vault.');
 if(input.property_id&&!store.get('SELECT 1 FROM properties WHERE id=? AND entity_id=?',input.property_id,input.entity_id))throw new HttpError(400,'Related property must belong to the proposal entity.');
 const normalized={...input,kind,property_name:kind==='entity_name'?null:input.property_name??null},id=proposalIdentity(vault,normalized),timestamp=now();
 store.run(`INSERT OR IGNORE INTO property_proposals(id,vault_id,entity_id,kind,property_id,property_name,value,target_id,origin,source_file_id,source_hash,details,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,id,vault,input.entity_id,kind,input.property_id??null,normalized.property_name,input.value??null,input.target_id??null,value.origin,value.source_file_id,value.source_hash,value.details,timestamp,timestamp);
 return store.get<PropertyProposal>('SELECT * FROM property_proposals WHERE id=? AND vault_id=?',id,vault)!;
}
export const proposePropertyValue=proposeValue;

export function setupPropertyProvenanceSchema(db:DatabaseSync) {
 db.exec(`CREATE TABLE IF NOT EXISTS source_automation_pauses(file_id TEXT PRIMARY KEY REFERENCES source_files(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,reason TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS source_automation_pause_vault_insert BEFORE INSERT ON source_automation_pauses WHEN NOT EXISTS(SELECT 1 FROM source_files WHERE id=NEW.file_id AND vault_id=NEW.vault_id) BEGIN SELECT RAISE(ABORT,'Source automation pause must belong to its vault'); END;
 CREATE TRIGGER IF NOT EXISTS source_automation_pause_vault_update BEFORE UPDATE ON source_automation_pauses WHEN NOT EXISTS(SELECT 1 FROM source_files WHERE id=NEW.file_id AND vault_id=NEW.vault_id) BEGIN SELECT RAISE(ABORT,'Source automation pause must belong to its vault'); END;
 CREATE TABLE IF NOT EXISTS property_provenance(
 property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 origin TEXT NOT NULL CHECK(origin IN ('manual','imported','ai','derived','legacy_unknown')),source_file_id TEXT REFERENCES source_files(id) ON DELETE SET NULL,source_hash TEXT,details TEXT NOT NULL DEFAULT '',stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS entity_name_provenance(
 entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
 origin TEXT NOT NULL CHECK(origin IN ('manual','imported','ai','derived','legacy_unknown')),source_file_id TEXT REFERENCES source_files(id) ON DELETE SET NULL,source_hash TEXT,details TEXT NOT NULL DEFAULT '',stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS property_proposals(
 id TEXT PRIMARY KEY,vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('property','entity_name')),property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,property_name TEXT,value TEXT,target_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
 origin TEXT NOT NULL CHECK(origin IN ('manual','imported','ai','derived','legacy_unknown')),source_file_id TEXT REFERENCES source_files(id) ON DELETE SET NULL,source_hash TEXT,details TEXT NOT NULL DEFAULT '',status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS property_provenance_origin ON property_provenance(vault_id,origin,stale);
 CREATE INDEX IF NOT EXISTS property_provenance_source ON property_provenance(source_file_id,source_hash);
 CREATE INDEX IF NOT EXISTS property_proposals_status ON property_proposals(vault_id,entity_id,status,created_at);
 CREATE INDEX IF NOT EXISTS property_proposals_source ON property_proposals(source_file_id,source_hash);
 CREATE TRIGGER IF NOT EXISTS property_provenance_insert AFTER INSERT ON properties BEGIN INSERT OR IGNORE INTO property_provenance SELECT NEW.id,e.vault_id,'legacy_unknown',NULL,NULL,'',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM entities e WHERE e.id=NEW.entity_id; END;
 CREATE TRIGGER IF NOT EXISTS property_provenance_invalidate AFTER UPDATE OF name,value,target_id,entity_id ON properties WHEN NEW.name IS NOT OLD.name OR NEW.value IS NOT OLD.value OR NEW.target_id IS NOT OLD.target_id OR NEW.entity_id IS NOT OLD.entity_id BEGIN UPDATE property_provenance SET stale=1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE property_id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS entity_name_provenance_insert AFTER INSERT ON entities BEGIN INSERT OR IGNORE INTO entity_name_provenance VALUES(NEW.id,NEW.vault_id,'legacy_unknown',NULL,NULL,'',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
 CREATE TRIGGER IF NOT EXISTS entity_name_provenance_invalidate AFTER UPDATE OF name ON entities WHEN NEW.name IS NOT OLD.name BEGIN UPDATE entity_name_provenance SET stale=1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE entity_id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS property_source_provenance_invalidate AFTER UPDATE OF text,entity_id,source_url,import_method ON source_files WHEN NEW.text IS NOT OLD.text OR NEW.entity_id IS NOT OLD.entity_id OR NEW.source_url IS NOT OLD.source_url OR NEW.import_method IS NOT OLD.import_method BEGIN UPDATE property_provenance SET stale=1 WHERE source_file_id=NEW.id AND (NEW.entity_id IS NOT OLD.entity_id OR (source_hash IS NOT NULL AND NEW.text IS NOT OLD.text) OR (source_hash IS NULL AND (NEW.source_url IS NOT OLD.source_url OR NEW.import_method IS NOT OLD.import_method))); UPDATE entity_name_provenance SET stale=1 WHERE source_file_id=NEW.id AND (NEW.entity_id IS NOT OLD.entity_id OR (source_hash IS NOT NULL AND NEW.text IS NOT OLD.text)); END;
 CREATE TRIGGER IF NOT EXISTS property_provenance_source_delete BEFORE DELETE ON source_files BEGIN UPDATE property_provenance SET stale=1 WHERE source_file_id=OLD.id; UPDATE entity_name_provenance SET stale=1 WHERE source_file_id=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS provenance_entity_vault_move BEFORE UPDATE OF vault_id ON entities WHEN NEW.vault_id IS NOT OLD.vault_id AND (EXISTS(SELECT 1 FROM entity_name_provenance WHERE entity_id=OLD.id) OR EXISTS(SELECT 1 FROM property_proposals WHERE entity_id=OLD.id OR target_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Entity provenance requires an explicit vault-move impact path'); END;
 CREATE TRIGGER IF NOT EXISTS provenance_source_vault_move BEFORE UPDATE OF vault_id ON source_files WHEN NEW.vault_id IS NOT OLD.vault_id AND (EXISTS(SELECT 1 FROM property_provenance WHERE source_file_id=OLD.id) OR EXISTS(SELECT 1 FROM entity_name_provenance WHERE source_file_id=OLD.id) OR EXISTS(SELECT 1 FROM property_proposals WHERE source_file_id=OLD.id) OR EXISTS(SELECT 1 FROM source_automation_pauses WHERE file_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Source provenance requires an explicit vault-move impact path'); END;`);
 for(const [table,owner,ownerTable] of [['property_provenance','property_id','properties'],['entity_name_provenance','entity_id','entities'],['property_proposals','entity_id','entities']] as const) {
  const ownerCondition=ownerTable==='properties'?`EXISTS(SELECT 1 FROM properties p JOIN entities e ON e.id=p.entity_id WHERE p.id=NEW.${owner} AND e.vault_id=NEW.vault_id)`:`EXISTS(SELECT 1 FROM entities e WHERE e.id=NEW.${owner} AND e.vault_id=NEW.vault_id)`;
  const additional=table==='property_proposals'?` OR (NEW.target_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.target_id AND vault_id=NEW.vault_id)) OR (NEW.property_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM properties p WHERE p.id=NEW.property_id AND p.entity_id=NEW.entity_id))`:'';
  for(const action of ['INSERT','UPDATE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_vault_${action.toLowerCase()} BEFORE ${action} ON ${table} WHEN NOT ${ownerCondition} OR (NEW.source_file_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_files WHERE id=NEW.source_file_id AND vault_id=NEW.vault_id))${additional} BEGIN SELECT RAISE(ABORT,'Provenance references must belong to the owner vault'); END;`);
 }
 if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=6').get()) {
  const store=new Store(db);store.transaction(()=>{
   const timestamp=now();
   store.run("INSERT OR IGNORE INTO property_provenance SELECT p.id,e.vault_id,'legacy_unknown',NULL,NULL,'',0,?,? FROM properties p JOIN entities e ON e.id=p.entity_id",timestamp,timestamp);
   store.run("INSERT OR IGNORE INTO entity_name_provenance SELECT id,vault_id,'legacy_unknown',NULL,NULL,'',0,?,? FROM entities",timestamp,timestamp);
   store.run("INSERT INTO schema_migrations VALUES(6,?)",timestamp);
  });
 }
}
