import { readFileSync, unlinkSync } from 'node:fs';
import { SourceFiles } from './source-files.js';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {gzip,gunzip} from 'node:zlib';
import type {SQLInputValue} from 'node:sqlite';
import {blockTypes,entityTypes,type EntityType,type Vault} from '../../shared/domain.js';
import {builtinSubtypes} from '../../shared/entity-schema.js';
import {isPageIconId} from '../../shared/page-icons.js';
import {Store} from '../store.js';
import {HttpError,now,object,required,text} from '../validation.js';
import {Images} from './images.js';
import {Knowledge} from './knowledge.js';
import {Pages} from './pages.js';
import {Vaults} from './vaults.js';

export const maxBackupBytes=128*1024*1024;
const maxExpandedBytes=256*1024*1024;
const compress=promisify(gzip),expand=promisify(gunzip);
const pageScope='page_id IN (SELECT id FROM pages WHERE vault_id=?)';
const entityScope='entity_id IN (SELECT id FROM entities WHERE vault_id=?)';
// Explicit, versioned allowlist: credentials, app settings, jobs and activity are never archived.
const tables={
  pages:{columns:'id,title,icon,featured_image_id,blocks,updated_at,revision,deleted_at',scope:'vault_id=?'},
  source_files:{columns:'id,entity_id,name,size,status,text,error,progress,pages,ocr_pages,created_at',scope:'vault_id=? AND entity_id IS NOT NULL'},
  entities:{columns:'id,name,aliases,mention_case,type,subtypes,description,updated_at',scope:'vault_id=?'},
  properties:{columns:'id,entity_id,name,value,target_id',scope:entityScope},
  relationships:{columns:'id,source_id,label,target_id',scope:'source_id IN (SELECT id FROM entities WHERE vault_id=?)'},
  page_sources:{columns:'page_id,source_id',scope:pageScope},
  entity_subtypes:{columns:'id,type,name',scope:'vault_id=?'},
  entity_type_properties:{columns:'type,name',scope:'vault_id=?'},
  entity_subtype_properties:{columns:'subtype_id,name',scope:'vault_id=?'},
  collections:{columns:'id,name',scope:'vault_id=?'},
  folders:{columns:'id,name,parent_id',scope:'vault_id=?'},
  item_locations:{columns:'kind,item_id,folder_id',scope:'vault_id=?'},
  collection_memberships:{columns:'kind,item_id,collection_id',scope:'vault_id=?'},
  favourites:{columns:'kind,item_id',scope:'vault_id=?'},
  page_ai_enrichments:{columns:'page_id,kind,data,revision,model,reasoning_effort,updated_at,content_hash',scope:pageScope},
  embedding_settings:{columns:'automatic,min_characters',scope:'vault_id=?'},
  note_embeddings:{columns:'page_id,model,dimensions,content_hash,revision,vector,tokens,updated_at',scope:pageScope},
} as const;
type Table=keyof typeof tables;
type Row=Record<string,unknown>;
type Backup={format:'noema-vault-backup';version:1;createdAt:string;vault:{name:string};tables:Record<Table,Row[]>;images:{id:string;data:string}[];sourceFiles?:{id:string;data:string}[]};
const invalid=()=>new HttpError(400,'This backup contains invalid data or missing references.');
function string(row:Row,key:string,max=10000) {return text(row[key],max);}
function name(row:Row,key:string) {return required(row[key]);}
function nullable(row:Row,key:string,max=10000) {return row[key]===null?null:string(row,key,max);}
function integer(row:Row,key:string,min=0,max=Number.MAX_SAFE_INTEGER) {
  const value=row[key];if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw invalid();return value;
}
function timestamp(row:Row,key:string) {const value=string(row,key,100);if(!Number.isFinite(Date.parse(value)))throw invalid();return value;}
function json(row:Row,key:string):unknown {try{return JSON.parse(string(row,key,maxExpandedBytes));}catch{throw invalid();}}
function list(value:unknown):unknown[] {if(!Array.isArray(value)||value.length>100000)throw invalid();return value;}
function entityType(row:Row):EntityType {const type=entityTypes.find(type=>type===row.type);if(!type)throw invalid();return type;}

export class VaultBackups {
  private images:Images;
  private vaults:Vaults;
  constructor(private store:Store) {this.images=new Images(store);this.vaults=new Vaults(store);}
  async export(vault:string) {
    this.vaults.requireOpen(vault);
    const backup=this.store.transaction(()=>{
      const name=this.store.get<{name:string}>('SELECT name FROM vaults WHERE id=?',vault)!.name;
      const data={} as Record<Table,Row[]>;
      for(const table of Object.keys(tables) as Table[]) {
        const spec=tables[table];data[table]=this.store.all<Row>(`SELECT ${spec.columns} FROM ${table} WHERE ${spec.scope}`,vault);
        if(data[table].length>100000)throw new HttpError(413,'This vault contains too many records for a single backup.');
      }
      if(Object.values(data).reduce((count,rows)=>count+rows.length,0)>200000)throw new HttpError(413,'This vault contains too many records for a single backup.');
      let estimated=Buffer.byteLength(JSON.stringify(data));
      if(estimated>maxExpandedBytes)throw new HttpError(413,'This vault exceeds the 256 MB expanded backup limit.');
      const imageIds=new Set<string>();
      for(const page of data.pages) {
        if(typeof page.featured_image_id==='string')imageIds.add(page.featured_image_id);
        for(const block of JSON.parse(page.blocks as string))if(block.type==='image'&&block.imageId)imageIds.add(block.imageId);
      }
      const images=[...imageIds].map(id=>{
        const bytes=this.images.get(vault,id).bytes;
        estimated+=Math.ceil(bytes.length/3)*4+id.length+32;
        if(estimated>maxExpandedBytes)throw new HttpError(413,'This vault exceeds the 256 MB expanded backup limit.');
        return {id,data:bytes.toString('base64')};
      });
      return {format:'noema-vault-backup',version:1,createdAt:now(),vault:{name},tables:data,images,sourceFiles:data.source_files.map(file=>{
        const bytes=readFileSync(new SourceFiles(this.store).filename(vault,file.id as string));
        estimated+=Math.ceil(bytes.length/3)*4;
        if(estimated>maxExpandedBytes)throw new HttpError(413,'This vault exceeds the 256 MB expanded backup limit.');
        return {id:file.id as string,data:bytes.toString('base64')};
      })} satisfies Backup;
    });
    const payload=Buffer.from(JSON.stringify(backup));
    if(payload.length>maxExpandedBytes)throw new HttpError(413,'This vault exceeds the 256 MB expanded backup limit.');
    const bytes=await compress(payload,{level:9});
    if(bytes.length>maxBackupBytes)throw new HttpError(413,'This vault exceeds the 128 MB compressed backup limit.');
    this.vaults.requireOpen(vault);
    return {bytes,filename:(backup.vault.name.replace(/[\\/\x00-\x1f\x7f]/g,'-').slice(0,100)||'Vault')+'.noemabkp'};
  }
  async import(bytes:Buffer,requestedName?:string):Promise<Vault> {
    if(!bytes.length||bytes.length>maxBackupBytes)throw new HttpError(413,'Choose a nonempty backup of 128 MB or smaller.');
    let archive:Row;
    try {archive=object(JSON.parse((await expand(bytes,{maxOutputLength:maxExpandedBytes})).toString('utf8')));}
    catch(error) {if((error as NodeJS.ErrnoException).code==='ERR_BUFFER_TOO_LARGE')throw new HttpError(413,'This backup exceeds the 256 MB expanded limit.');throw new HttpError(400,'This is not a valid .noemabkp backup, or the file is damaged.');}
    if(archive.format!=='noema-vault-backup'||archive.version!==1)throw new HttpError(400,'This backup format or version is not supported.');
    const vaultName=required(requestedName?.trim()||object(archive.vault).name);
    const data=object(archive.tables),rows={} as Record<Table,Row[]>;
    let total=0;
    for(const table of Object.keys(tables) as Table[]) {rows[table]=list(table==='source_files'||table==='entity_subtype_properties'?(data[table]??[]):data[table]).map(object);total+=rows[table].length;}
    if(total>200000)throw new HttpError(413,'This backup contains too many records.');
    const assets=list(archive.images).map(object);
    const sourceAssets=list(archive.sourceFiles??[]).map(object);
    const sourceAssetMap=new Map(sourceAssets.map(asset=>[name(asset,'id'),asset]));
    if(sourceAssetMap.size!==sourceAssets.length||sourceAssets.length!==rows.source_files.length)throw invalid();
    const ids=(records:Row[])=>{
      const map=new Map<string,string>();
      for(const row of records){const id=name(row,'id');if(map.has(id))throw invalid();map.set(id,randomUUID());}return map;
    };
    const pageIds=ids(rows.pages),entityIds=ids(rows.entities),folderIds=ids(rows.folders),collectionIds=ids(rows.collections),subtypeIds=ids(rows.entity_subtypes),imageIds=new Map<string,string>();
    const subtypeTypes=new Map(rows.entity_subtypes.map(row=>[row.id,row.type]));
    const ref=(map:Map<string,string>,value:unknown)=>{if(typeof value!=='string'||!map.has(value))throw invalid();return map.get(value)!;};
    const subtype=(value:unknown,type:EntityType)=>{
      if(typeof value!=='string')throw invalid();
      const builtin=builtinSubtypes.find(item=>item.id===value&&item.type===type);if(builtin)return builtin.id;
      if(subtypeTypes.get(value)!==type)throw invalid();
      return ref(subtypeIds,value);
    };
    const item=(row:Row,allowFolder=false)=>{
      const maps:{[key:string]:Map<string,string>}={page:pageIds,entity:entityIds,...(allowFolder?{folder:folderIds}:{})};
      const kind=string(row,'kind',20);if(!Object.hasOwn(maps,kind))throw invalid();return {kind,item_id:ref(maps[kind]!,row.item_id)};
    };
    // Check parent chains before writing anything; arbitrary folder insertion order is supported.
    const parents=new Map(rows.folders.map(row=>[name(row,'id'),row.parent_id]));
    const verified=new Set<string>();
    for(const id of parents.keys()) {
      const seen=new Set<string>();let ancestor:unknown=id;
      while(ancestor!==null){if(typeof ancestor!=='string'||seen.has(ancestor)||!parents.has(ancestor))throw invalid();if(verified.has(ancestor))break;seen.add(ancestor);ancestor=parents.get(ancestor);}
      for(const ancestor of seen)verified.add(ancestor);
    }
    const vault=randomUUID(),writtenImages:string[]=[],writtenSources:string[]=[];
    const sourceFiles=new SourceFiles(this.store);
    const insert=(table:Table,values:Record<string,SQLInputValue>)=>{
      const columns=Object.keys(values);
      this.store.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,...Object.values(values));
    };
    try {
      this.store.transaction(()=>{
        this.store.run('INSERT INTO vaults (id,name,updated_at) VALUES (?,?,?)',vault,vaultName,now());
        for(const asset of assets) {
          const id=name(asset,'id');if(imageIds.has(id))throw invalid();
          const encoded=string(asset,'data',28*1024*1024);
          const content=Buffer.from(encoded,'base64');if(content.toString('base64')!==encoded)throw invalid();
          const added=this.images.add(vault,content);imageIds.set(id,added.id);writtenImages.push(added.id);
        }
        for(const row of rows.entity_subtypes)insert('entity_subtypes',{id:ref(subtypeIds,row.id),vault_id:vault,type:entityType(row),name:name(row,'name')});
        for(const row of rows.entity_type_properties)insert('entity_type_properties',{vault_id:vault,type:entityType(row),name:name(row,'name')});
        for(const row of rows.entity_subtype_properties) {
          const id=name(row,'subtype_id');
          const type=builtinSubtypes.find(item=>item.id===id)?.type ?? subtypeTypes.get(id);
          if(!entityTypes.includes(type as EntityType))throw invalid();
          insert('entity_subtype_properties',{vault_id:vault,subtype_id:subtype(id,type as EntityType),name:name(row,'name')});
        }
        for(const row of rows.entities) {
          const type=entityType(row),aliases=list(json(row,'aliases')).map(value=>required(value,200)),subtypes=list(json(row,'subtypes')).map(value=>subtype(value,type));
          if(aliases.length>100||new Set(subtypes).size!==subtypes.length)throw invalid();
          const mentionCase=row.mention_case??'canonical';
          if(mentionCase!=='canonical'&&mentionCase!=='lowercase')throw invalid();
          insert('entities',{id:ref(entityIds,row.id),vault_id:vault,name:name(row,'name'),type,aliases:JSON.stringify(aliases),mention_case:mentionCase,subtypes:JSON.stringify(subtypes),description:string(row,'description'),updated_at:timestamp(row,'updated_at')});
        }
        for(const row of rows.source_files) {
          const asset=sourceAssetMap.get(name(row,'id'));if(!asset)throw invalid();
          const encoded=string(asset,'data',70*1024*1024),bytes=Buffer.from(encoded,'base64');
          if(bytes.toString('base64')!==encoded || bytes.length!==integer(row,'size',1,50*1024*1024))throw invalid();
          const added=sourceFiles.add(vault,name(row,'name'),bytes,ref(entityIds,row.entity_id));writtenSources.push(added.id);
          const status=string(row,'status',20);if(!['queued','processing','ready','failed'].includes(status))throw invalid();
          this.store.run('UPDATE source_files SET status=?,text=?,error=?,progress=?,pages=?,ocr_pages=?,created_at=? WHERE id=?',status==='processing'?'queued':status,string(row,'text',16*1024*1024),nullable(row,'error',2000),integer(row,'progress',0,100),integer(row,'pages',0,1000),integer(row,'ocr_pages',0,1000),timestamp(row,'created_at'),added.id);
        }
        for(const row of rows.properties)insert('properties',{id:randomUUID(),entity_id:ref(entityIds,row.entity_id),name:name(row,'name'),value:nullable(row,'value'),target_id:row.target_id===null?null:ref(entityIds,row.target_id)});
        for(const row of rows.relationships)insert('relationships',{id:randomUUID(),source_id:ref(entityIds,row.source_id),label:name(row,'label'),target_id:ref(entityIds,row.target_id)});
        const pages=new Pages(this.store,new Knowledge(this.store));
        for(const row of rows.pages) {
          if(row.icon!==null&&!isPageIconId(row.icon))throw invalid();
          const blocks=list(json(row,'blocks')).map(value=>{
            const block={...object(value)};
            if(!blockTypes.includes(block.type as typeof blockTypes[number]))throw invalid();
            const segments=(value:unknown)=>list(value).map(value=>{
              const segment={...object(value)};if(segment.entityId)segment.entityId=ref(entityIds,segment.entityId);return segment;
            });
            block.content=segments(block.content);
            if(block.type==='image')block.imageId=ref(imageIds,block.imageId);
            if((block.type==='table'||block.type==='columns'))block.rows=list(block.rows).map(row=>list(row).map(segments));
            return block;
          });
          const validated=pages.validateBlocks(vault,blocks);
          insert('pages',{id:ref(pageIds,row.id),vault_id:vault,title:string(row,'title',500),icon:row.icon as string|null,featured_image_id:row.featured_image_id==null?null:ref(imageIds,row.featured_image_id),blocks:JSON.stringify(validated),updated_at:timestamp(row,'updated_at'),revision:integer(row,'revision',1),deleted_at:row.deleted_at===null?null:timestamp(row,'deleted_at')});
        }
        for(const row of rows.page_sources) {
          const source=ref(entityIds,row.source_id);
          if(this.store.get<{type:string}>('SELECT type FROM entities WHERE id=?',source)?.type!=='source')throw invalid();
          insert('page_sources',{page_id:ref(pageIds,row.page_id),source_id:source});
        }
        for(const row of rows.collections)insert('collections',{id:ref(collectionIds,row.id),vault_id:vault,name:name(row,'name')});
        for(const row of rows.folders)insert('folders',{id:ref(folderIds,row.id),vault_id:vault,name:name(row,'name'),parent_id:null});
        for(const row of rows.folders)if(row.parent_id!==null)this.store.run('UPDATE folders SET parent_id=? WHERE id=?',ref(folderIds,row.parent_id),ref(folderIds,row.id));
        for(const row of rows.item_locations)insert('item_locations',{vault_id:vault,...item(row),folder_id:row.folder_id===null?null:ref(folderIds,row.folder_id)});
        for(const row of rows.collection_memberships)insert('collection_memberships',{vault_id:vault,...item(row),collection_id:ref(collectionIds,row.collection_id)});
        for(const row of rows.favourites)insert('favourites',{vault_id:vault,...item(row,true)});
        for(const row of rows.page_ai_enrichments) {
          const kind=name(row,'kind'),data=object(json(row,'data'));
          if(kind==='entity_scan') {
            const scan=object(data.scan);scan.id=randomUUID();
            const proposalIds = new Map<string,string>();
            const proposals = list(scan.subtypeSuggestions ?? []).map(value => {
              const proposal = {...object(value)}, type = entityType(proposal), id = string(proposal,'id');
              if (proposalIds.has(id) || !['pending','accepted','rejected'].includes(proposal.status as string)) throw invalid();
              proposalIds.set(id,randomUUID());
              return {...proposal,id:proposalIds.get(id),name:string(proposal,'name',200),type,...(proposal.resolvedId === undefined ? {} : {resolvedId:subtype(proposal.resolvedId,type)})};
            });
            if (scan.subtypeSuggestions !== undefined) scan.subtypeSuggestions = proposals;
            scan.suggestions=list(scan.suggestions).map(value=>{
              const suggestion={...object(value)},type=entityType(suggestion);
              return {...suggestion,...(suggestion.proposedSubtypeIds === undefined ? {} : {proposedSubtypeIds:list(suggestion.proposedSubtypeIds).map(value=>ref(proposalIds,value))}),id:randomUUID(),existingId:suggestion.existingId===null?null:ref(entityIds,suggestion.existingId),subtypes:list(suggestion.subtypes).map(value=>subtype(value,type))};
            });
          }
          if(kind==='concept_classification') {
            data.subtypeIds=list(data.subtypeIds).map(value=>subtype(value,'concept'));
            if(typeof data.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(data.contentHash))throw invalid();
            if(data.schemaKey!==undefined&&(typeof data.schemaKey!=='string'||!/^[a-f0-9]{64}$/.test(data.schemaKey)))throw invalid();
            if(data.generatedTitle!==undefined&&(typeof data.generatedTitle!=='string'||data.generatedTitle.length>500))throw invalid();
          }
          if(kind==='summary'&&typeof data.summary!=='string')throw invalid();
          insert('page_ai_enrichments',{page_id:ref(pageIds,row.page_id),kind,data:JSON.stringify(data),revision:integer(row,'revision',1),model:name(row,'model'),reasoning_effort:string(row,'reasoning_effort',20),updated_at:timestamp(row,'updated_at'),content_hash:nullable(row,'content_hash',100)});
        }
        if(rows.embedding_settings.length>1)throw invalid();
        for(const row of rows.embedding_settings)insert('embedding_settings',{vault_id:vault,automatic:integer(row,'automatic',0,1),min_characters:integer(row,'min_characters',20,2000)});
        for(const row of rows.note_embeddings) {
          const dimensions=integer(row,'dimensions',1,4096),vector=list(json(row,'vector'));
          if(vector.length!==dimensions||vector.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw invalid();
          insert('note_embeddings',{page_id:ref(pageIds,row.page_id),model:name(row,'model'),dimensions,content_hash:string(row,'content_hash',100),revision:integer(row,'revision',1),vector:JSON.stringify(vector),tokens:integer(row,'tokens'),updated_at:timestamp(row,'updated_at')});
        }
        // Recompute after validation/remapping instead of trusting a supplied page fingerprint.
        for(const id of pageIds.values())if(!this.store.get<{deleted_at:string|null}>('SELECT deleted_at FROM pages WHERE id=?',id)!.deleted_at)pages.get(vault,id);
      });
    } catch(error) {
      for(const id of writtenSources){try{unlinkSync(sourceFiles.filename(vault,id));}catch{/* Rollback removes only newly written files. */}}
      for(const id of writtenImages)this.images.remove(vault,id);
      if(error instanceof HttpError)throw error;
      throw invalid();
    }
    return this.vaults.list().find(item=>item.id===vault)!;
  }
}
