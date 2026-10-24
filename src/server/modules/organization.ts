import {embeddingModel,embeddingDimensions} from '../../shared/embeddings.js';
import {isDeepStrictEqual} from 'node:util';
import {parseSmartRule,parseSemanticCollection} from '../../shared/smart-collections.js';
import {parseExampleCollection} from '../../shared/example-collections.js';
import {organizationDescription,saveOrganizationDescription} from './organization-descriptions.js';
import {Vaults} from './vaults.js';
import {SmartCollections} from './smart-collections.js';
import { randomUUID } from 'node:crypto';
import type { Collection, CollectionMembership, Folder, ItemKind, Organization } from '../../shared/domain.js';
import { Store } from '../store.js';
import { HttpError, required } from '../validation.js';
import {syncReadingNotesCollection} from './reading-notes-collection.js';

export class Organizer {
  readonly smart:SmartCollections;
  constructor(private store: Store) {this.smart=new SmartCollections(store);}
  list(vault: string): Organization {
    new Vaults(this.store).requireOpen(vault);
    this.store.transaction(()=>syncReadingNotesCollection(this.store,vault));
    return this.smart.decorate(vault,{
      folderLinks: this.store.all('SELECT folder_id,collection_id FROM collection_folders WHERE vault_id=? ORDER BY collection_id,folder_id', vault),
      collections: this.store.all<Collection & {description:string|null}>('SELECT c.id,c.name,d.description FROM collections c LEFT JOIN collection_descriptions d ON d.collection_id=c.id AND d.vault_id=c.vault_id WHERE c.vault_id=? ORDER BY c.name,c.id', vault).map(({description,...row})=>description===null?row:{...row,description}),
      folders: this.store.all<Folder & {description:string|null}>('SELECT f.id,f.name,f.parent_id,d.description FROM folders f LEFT JOIN folder_descriptions d ON d.folder_id=f.id AND d.vault_id=f.vault_id WHERE f.vault_id=? ORDER BY f.name,f.id', vault).map(({description,...row})=>description===null?row:{...row,description}),
      locations: this.store.all(`SELECT kind,item_id,folder_id FROM item_locations WHERE vault_id=? AND (kind='entity' OR EXISTS (SELECT 1 FROM pages WHERE pages.id=item_locations.item_id AND pages.vault_id=item_locations.vault_id AND pages.deleted_at IS NULL AND pages.archived_at IS NULL))`, vault),
      memberships: this.store.all<Omit<CollectionMembership,'automatic'> & {automatic:number}>(`SELECT kind,item_id,collection_id,
        EXISTS (SELECT 1 FROM collections c JOIN page_reading_notes n ON n.vault_id=c.vault_id
          WHERE c.id=collection_memberships.collection_id AND c.name='Reading Notes'
          AND n.page_id=collection_memberships.item_id AND collection_memberships.kind='page') AS automatic
        FROM collection_memberships WHERE vault_id=? AND (kind='entity' OR EXISTS (SELECT 1 FROM pages WHERE pages.id=collection_memberships.item_id AND pages.vault_id=collection_memberships.vault_id AND pages.deleted_at IS NULL AND pages.archived_at IS NULL))`, vault).map(row=>({...row,automatic:!!row.automatic})),
      favourites: this.store.all(`SELECT kind,item_id FROM favourites WHERE vault_id=? AND (kind IN ('entity','folder') OR EXISTS (SELECT 1 FROM pages WHERE pages.id=favourites.item_id AND pages.vault_id=favourites.vault_id AND pages.deleted_at IS NULL AND pages.archived_at IS NULL))`, vault),
    });
  }
  private collection(vault: string, id: string) {
    const row = this.store.get<Collection>('SELECT * FROM collections WHERE vault_id=? AND id=?', vault, id);
    if (!row) throw new HttpError(404, 'Collection not found');
    return row;
  }
  private folder(vault: string, id: string) {
    const row = this.store.get<Folder>('SELECT * FROM folders WHERE vault_id=? AND id=?', vault, id);
    if (!row) throw new HttpError(404, 'Folder not found');
    return row;
  }
  private nullable(value: unknown): string | null { return value === null || value === undefined ? null : required(value); }
  private matchingUnchanged(definition:NonNullable<ReturnType<SmartCollections['definition']>>,body:Record<string,unknown>):boolean {
    if(body.matching!==undefined&&body.matching!==definition.matching)return false;
    const compare=(key:'rule'|'semantic'|'examples',stored:string|null,parse:(value:unknown)=>unknown)=>{
      if(body[key]===undefined)return true;
      let saved:unknown;try{saved=stored===null?undefined:JSON.parse(stored);}catch{return false;}
      if(isDeepStrictEqual(body[key],saved))return true;
      try{return isDeepStrictEqual(parse(body[key]),parse(saved));}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid matching definition');}
    };
    if((definition.matching==='rules'||definition.matching==='hybrid')&&!compare('rule',definition.rule_json,parseSmartRule))return false;
    if((definition.matching==='semantic'||definition.matching==='hybrid')&&!compare('semantic',definition.semantic_json,parseSemanticCollection))return false;
    if(definition.matching==='examples'&&!compare('examples',definition.examples_json,parseExampleCollection))return false;
    // Explicit description evaluation may repair an incompatible model or replace
    // a query vector. Identical verified vectors leave matching state intact.
    if(body.evaluationToken!==undefined&&(definition.matching==='semantic'||definition.matching==='hybrid')) {
      const semantic=this.smart.semantic.parse(body.semantic??JSON.parse(definition.semantic_json!));
      const vector=this.smart.semantic.vector(definition.vault_id,semantic,body,definition.collection_id);
      if(definition.query_model!==embeddingModel||definition.query_dimensions!==embeddingDimensions)return false;
      try{if(!isDeepStrictEqual(vector,JSON.parse(definition.query_vector!)))return false;}catch{return false;}
    }
    return true;
  }
  saveCollection(vault: string, body: Record<string, unknown>, id?: string) {
    new Vaults(this.store).requireOpen(vault);
    if (body.parent_id != null || body.collection_id != null) throw new HttpError(400, 'Collections cannot be nested');
    const existing=id?this.collection(vault,id):null;
    const name = required(body.name===undefined&&existing?existing.name:body.name);
    const description=body.description===undefined?undefined:organizationDescription(body.description);
    if(body.kind!==undefined&&body.kind!=='manual'&&body.kind!=='smart')throw new HttpError(400,'Invalid collection type');
    const wasSmart=id?!!this.smart.definition(vault,id):false;
    if(wasSmart&&body.kind==='manual')throw new HttpError(400,'Keep smart rules or create a new manual collection');
    const definition=id?this.smart.definition(vault,id):undefined;
    const unchanged=!!definition&&this.matchingUnchanged(definition,body);
    const matching=body.matching??definition?.matching??'rules';
    if(!['rules','semantic','hybrid','examples'].includes(String(matching)))throw new HttpError(400,'Invalid matching method');
    const isSmart=body.kind==='smart'||wasSmart;
    const semantic=isSmart&&!unchanged&&(matching==='semantic'||matching==='hybrid')?this.smart.semantic.parse(body.semantic??(definition?.semantic_json?JSON.parse(definition.semantic_json):undefined)):undefined;
    const vector=semantic?this.smart.semantic.vector(vault,semantic,body,id):undefined;
    const rule=isSmart&&!unchanged&&(matching==='rules'||matching==='hybrid')?this.smart.parse(vault,body.rule??((definition?.matching==='rules'||definition?.matching==='hybrid')?JSON.parse(definition.rule_json):undefined)):undefined;
    const examples=isSmart&&!unchanged&&matching==='examples'?this.smart.parseExamples(body.examples??(definition?.examples_json?JSON.parse(definition.examples_json):undefined)):undefined;
    const collectionId=id??randomUUID();
    this.store.transaction(()=>{
      if(existing)this.store.run('UPDATE collections SET name=? WHERE id=? AND vault_id=?',name,collectionId,vault);
      else this.store.run('INSERT INTO collections VALUES (?,?,?)',collectionId,vault,name);
      if(description!==undefined)saveOrganizationDescription(this.store,vault,'collection',collectionId,description);
      if(examples)this.smart.saveExamples(vault,collectionId,examples);
      else if(semantic&&vector){this.smart.semantic.save(vault,collectionId,semantic,vector);if(matching==='hybrid'&&rule)this.store.run("UPDATE smart_collection_definitions SET matching='hybrid',rule_json=? WHERE vault_id=? AND collection_id=?",JSON.stringify(rule),vault,collectionId);}
      else if(rule)this.smart.save(vault,collectionId,rule);
    });
    return this.list(vault);
  }
  saveFolder(vault: string, body: Record<string, unknown>, id?: string) {
    new Vaults(this.store).requireOpen(vault);
    const existing = id ? this.folder(vault, id) : null;
    const name = required(body.name===undefined&&existing?existing.name:body.name);
    const description=body.description===undefined?undefined:organizationDescription(body.description);
    if (body.collection_id != null) throw new HttpError(400, 'Folders are independent of collections');
    const parent = body.parent_id === undefined ? existing?.parent_id ?? null : this.nullable(body.parent_id);
    if (parent) {
      let ancestor: Folder | undefined = this.folder(vault, parent);
      const seen=new Set<string>();
      while (ancestor) {
        if(seen.has(ancestor.id))throw new HttpError(400,'Cyclic folder ancestry');seen.add(ancestor.id);
        if (ancestor.id === id) throw new HttpError(400, 'Folders cannot contain themselves');
        ancestor = ancestor.parent_id ? this.folder(vault, ancestor.parent_id) : undefined;
      }
    }
    const folderId=id??randomUUID();
    this.store.transaction(()=>{
      if(existing){if(name!==existing.name||parent!==existing.parent_id)this.store.run('UPDATE folders SET name=?,parent_id=? WHERE id=? AND vault_id=?',name,parent,folderId,vault);}
      else this.store.run('INSERT INTO folders VALUES (?,?,?,?)',folderId,vault,name,parent);
      if(description!==undefined)saveOrganizationDescription(this.store,vault,'folder',folderId,description);
    });
    return this.list(vault);
  }
  remove(vault: string, type: 'collections' | 'folders', id: string) {
    if (type === 'collections') this.collection(vault, id); else this.folder(vault, id);
    // Removing containers preserves canonical content; deleted folders lose their own favourites.
    this.store.run(`DELETE FROM ${type} WHERE id=? AND vault_id=?`, id, vault);
    return this.list(vault);
  }
  private item(vault: string, body: Record<string, unknown>): {kind: ItemKind; id: string} {
    const kind = body.kind;
    if (kind !== 'page' && kind !== 'entity') throw new HttpError(400, 'Invalid item kind');
    const id = required(body.item_id);
    if (!this.store.get(`SELECT id FROM ${kind === 'page' ? 'pages' : 'entities'} WHERE id=? AND vault_id=?${kind === 'page' ? ' AND deleted_at IS NULL AND archived_at IS NULL' : ''}`, id, vault)) throw new HttpError(404, 'Item not found');
    return {kind, id};
  }
  locate(vault: string, body: Record<string, unknown>) {
    const {kind, id} = this.item(vault, body);
    if (body.collection_id != null) throw new HttpError(400, 'Use memberships to change collections');
    if ('expected_folder_id' in body) {
      const expected=this.nullable(body.expected_folder_id);
      const current=this.store.get<{folder_id:string}>('SELECT folder_id FROM item_locations WHERE vault_id=? AND kind=? AND item_id=?',vault,kind,id)?.folder_id ?? null;
      if(current!==expected)throw new HttpError(409,'This page location changed. Refresh Inbox before filing.');
    }
    const folder = this.nullable(body.folder_id);
    if (folder) this.folder(vault, folder);
    if (body.remove !== undefined && typeof body.remove !== 'boolean') throw new HttpError(400, 'Invalid remove flag');
    if (body.remove || !folder) this.store.run('DELETE FROM item_locations WHERE vault_id=? AND kind=? AND item_id=?', vault, kind, id);
    else this.store.run('INSERT INTO item_locations VALUES (?,?,?,?) ON CONFLICT(vault_id,kind,item_id) DO UPDATE SET folder_id=excluded.folder_id', vault, kind, id, folder);
    return this.list(vault);
  }
  membership(vault: string, body: Record<string, unknown>) {
    const {kind, id} = this.item(vault, body);
    const collection = required(body.collection_id);
    const target=this.collection(vault, collection);
    if (body.folder_id != null) throw new HttpError(400, 'Collection membership cannot change a folder');
    if (body.remove !== undefined && typeof body.remove !== 'boolean') throw new HttpError(400, 'Invalid remove flag');
    if(this.smart.definition(vault,collection)){this.smart.override(vault,body,collection,kind,id);return this.list(vault);}
    if (body.remove && kind==='page' && target.name==='Reading Notes' && this.store.get('SELECT 1 FROM page_reading_notes WHERE vault_id=? AND page_id=?',vault,id)) throw new HttpError(400,'Reading notes belong to Reading Notes automatically.');
    if (body.remove) this.store.run('DELETE FROM collection_memberships WHERE vault_id=? AND kind=? AND item_id=? AND collection_id=?', vault, kind, id, collection);
    else this.store.run('INSERT OR IGNORE INTO collection_memberships VALUES (?,?,?,?)', vault, kind, id, collection);
    return this.list(vault);
  }
  folderMembership(vault: string, body: Record<string, unknown>) {
    const folder = this.folder(vault, required(body.folder_id));
    const collection = this.collection(vault, required(body.collection_id));
    if (body.remove !== undefined && typeof body.remove !== 'boolean') throw new HttpError(400, 'Invalid remove flag');
    if (body.remove) {
      this.store.run('DELETE FROM collection_folders WHERE vault_id=? AND folder_id=? AND collection_id=?', vault, folder.id, collection.id);
    } else if (body.mode === 'linked') {
      this.store.run('INSERT OR IGNORE INTO collection_folders VALUES (?,?,?)', vault, folder.id, collection.id);
    } else if (body.mode === 'pages') {
      // Copy only current, non-trashed pages; canonical folder locations stay intact.
      this.store.run(`WITH RECURSIVE subtree(id) AS (
        SELECT id FROM folders WHERE vault_id=? AND id=?
        UNION SELECT folders.id FROM folders JOIN subtree ON folders.parent_id=subtree.id WHERE folders.vault_id=?
      ) INSERT OR IGNORE INTO collection_memberships(vault_id,kind,item_id,collection_id)
        SELECT l.vault_id,'page',l.item_id,? FROM item_locations l JOIN pages p ON p.id=l.item_id AND p.vault_id=l.vault_id
        WHERE l.vault_id=? AND l.kind='page' AND l.folder_id IN (SELECT id FROM subtree) AND p.deleted_at IS NULL AND p.archived_at IS NULL`, vault, folder.id, vault, collection.id, vault);
    } else throw new HttpError(400, 'Choose a linked folder or current pages');
    return this.list(vault);
  }
  favourite(vault: string, body: Record<string, unknown>) {
    const {kind, id} = body.kind === 'folder' ? {kind: 'folder' as const, id: this.folder(vault, required(body.item_id)).id} : this.item(vault, body);
    if (typeof body.favourite !== 'boolean') throw new HttpError(400, 'A favourite flag is required');
    if (body.favourite) this.store.run('INSERT OR IGNORE INTO favourites VALUES (?,?,?)', vault, kind, id);
    else this.store.run('DELETE FROM favourites WHERE vault_id=? AND kind=? AND item_id=?', vault, kind, id);
    return this.list(vault);
  }
}
