import {parsePageGenerationMetadata} from '../../shared/page-generation.js';
import {sourceTextHash} from './source-math-text.js';
import {syncReadingNotesCollection} from './reading-notes-collection.js';
import {domainById} from '../../shared/domains.js';
import {sourceStructureKinds,type SourceStructureKind} from '../../shared/domain.js';
import {isPageIndexPolicy} from '../../shared/embeddings.js';
import {syncSourceReferences} from './source-references.js';
import {limitSummaryWords} from '../../shared/summary-text.js';
import {pageLanguage} from './page-language.js';
import {isPageAIStatus} from '../../shared/page-ai-status.js';
import {isAIExplanation} from '../../shared/semantic-blocks.js';
import {highlightColors,readingNoteMaxWords,readingNoteWordCount,type HighlightColor} from '../../shared/source-reading.js';
import {projectPageText} from '../../shared/page-text.js';
import { syncSourceProvenance } from './source-provenance.js';
import { readFileSync, unlinkSync } from 'node:fs';
import { SourceFiles } from './source-files.js';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {gzip,gunzip} from 'node:zlib';
import type {SQLInputValue} from 'node:sqlite';
import {blockTypes,entityTypes,entityMentionName,type Block,type EntityType,type Vault} from '../../shared/domain.js';
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
// Explicit, versioned allowlist: credentials, global app settings, jobs and activity are never archived.
const tables={
  pages:{columns:'id,title,icon,featured_image_id,blocks,ai_status,generation_metadata,language,created_at,updated_at,revision,deleted_at',scope:'vault_id=?'},
  source_math_documents:{columns:'file_id,raw_hash,algorithm_version,cleaned_text,uncertainty_json,updated_at',scope:'file_id IN (SELECT id FROM source_files WHERE vault_id=? AND entity_id IS NOT NULL)'},
  source_files:{columns:'id,entity_id,name,size,status,text,error,progress,pages,ocr_pages,created_at,import_method,source_url,pdf_flattened,admitted,format,page_start_lines,structural_nodes,original_filename,language,summary,generated_name,enrichment_status,contains_math',scope:'vault_id=? AND entity_id IS NOT NULL'},
  highlights:{columns:'id,source_id,file_id,source_hash,start_offset,end_offset,excerpt,color,reference_json,created_at',scope:'vault_id=?'},
  page_reading_notes:{columns:'page_id,source_id,file_id,source_hash,start_offset,end_offset,excerpt,reference_json,created_at',scope:'vault_id=?'},
  entities:{columns:'id,name,aliases,mention_case,type,subtypes,description,updated_at,inactive',scope:'vault_id=?'},
  properties:{columns:'id,entity_id,name,value,target_id',scope:entityScope},
  relationships:{columns:'id,source_id,label,target_id',scope:'source_id IN (SELECT id FROM entities WHERE vault_id=?)'},
  page_edit_locks:{columns:'page_id,password_hash,salt',scope:'vault_id=?'},
  page_domains:{columns:'page_id,domain_id,role,origin,updated_at',scope:pageScope},
  page_domain_state:{columns:'page_id,origin,content_hash,taxonomy_version,revision',scope:pageScope},
  entity_domains:{columns:'entity_id,domain_id,origin',scope:entityScope},
  page_sources:{columns:'page_id,source_id',scope:pageScope},
  page_source_dismissals:{columns:'page_id,source_id',scope:pageScope},
  entity_subtypes:{columns:'id,type,name',scope:'vault_id=?'},
  entity_type_properties:{columns:'type,name',scope:'vault_id=?'},
  entity_subtype_properties:{columns:'subtype_id,name',scope:'vault_id=?'},
  collections:{columns:'id,name',scope:'vault_id=?'},
  folders:{columns:'id,name,parent_id',scope:'vault_id=?'},
  item_locations:{columns:'kind,item_id,folder_id',scope:'vault_id=?'},
  collection_folders:{columns:'folder_id,collection_id',scope:'vault_id=?'},
  collection_memberships:{columns:'kind,item_id,collection_id',scope:'vault_id=?'},
  favourites:{columns:'kind,item_id',scope:'vault_id=?'},
  page_ai_enrichments:{columns:'page_id,kind,data,revision,model,reasoning_effort,updated_at,content_hash',scope:pageScope},
  embedding_settings:{columns:'automatic,min_characters,page_policy',scope:'vault_id=?'},
  page_enrichment_settings:{columns:'automatic_summaries',scope:'vault_id=?'},
  page_segment_cache:{columns:'page_id,content_hash,model,dimensions,vector,tokens,updated_at',scope:pageScope},
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
        const bytes=readFileSync(new SourceFiles(this.store).assetFilename(vault,file.id as string));
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
    for(const table of Object.keys(tables) as Table[]) {rows[table]=list(table==='page_domains'||table==='page_domain_state'||table==='entity_domains'||table==='page_segment_cache'||table==='source_math_documents'||table==='source_files'||table==='entity_subtype_properties'||table==='collection_folders'||table==='page_edit_locks'||table==='page_enrichment_settings'||table==='page_source_dismissals'||table==='highlights'||table==='page_reading_notes'?(data[table]??[]):data[table]).map(object);total+=rows[table].length;}
    const sourceOwners=new Set<unknown>(),legacyEntities=new Map(rows.entities.map(row=>[row.id,row]));
    const legacyProperties=[...rows.properties],legacyLinks=[...rows.page_sources];
    for(const file of rows.source_files) {
      if(!sourceOwners.has(file.entity_id)){sourceOwners.add(file.entity_id);continue;}
      const owner=legacyEntities.get(file.entity_id);
      if(!owner||owner.type!=='source')throw invalid();
      const id=randomUUID(),original=file.entity_id;
      const properties=legacyProperties.filter(row=>row.entity_id===original),links=legacyLinks.filter(row=>row.source_id===original);
      total+=1+properties.length+links.length;
      if(total>200000)throw new HttpError(413,'This backup contains too many records.');
      rows.entities.push({...owner,id,name:name(file,'name').slice(0,200),aliases:'[]'});
      rows.properties.push(...properties.map(row=>({...row,id:randomUUID(),entity_id:id})));
      rows.page_sources.push(...links.map(row=>({...row,source_id:id})));
      file.entity_id=id;
      // Legacy archives may attach several files to one source entity.
      for(const record of [...rows.highlights,...rows.page_reading_notes])if(record.file_id===file.id) {
        record.source_id=id;
        const reference=object(json(record,'reference_json'));
        record.reference_json=JSON.stringify({...reference,sourceId:id});
      }
    }
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
          if(row.inactive!==undefined&&row.inactive!==0&&row.inactive!==1)throw invalid();
          insert('entities',{inactive:row.inactive??0,id:ref(entityIds,row.id),vault_id:vault,name:name(row,'name'),type,aliases:JSON.stringify(type==='source'?[]:aliases),mention_case:mentionCase,subtypes:JSON.stringify(subtypes),description:string(row,'description'),updated_at:timestamp(row,'updated_at')});
        }
        const restoredSourceFiles=new Map<string,string>();
        for(const row of rows.source_files) {
          const asset=sourceAssetMap.get(name(row,'id'));if(!asset)throw invalid();
          const encoded=string(asset,'data',70*1024*1024),bytes=Buffer.from(encoded,'base64');
          if(bytes.toString('base64')!==encoded || bytes.length!==integer(row,'size',1,50*1024*1024))throw invalid();
          if(row.import_method!==undefined&&!['url','upload'].includes(String(row.import_method)))throw invalid();
          const sourceUrl=row.source_url===undefined||row.source_url===null?undefined:string(row,'source_url',4096);
          if(row.import_method==='url'&&!sourceUrl||row.import_method==='upload'&&sourceUrl)throw invalid();
          const sourceEntity=ref(entityIds,row.entity_id);
          if(this.store.get<{type:string}>('SELECT type FROM entities WHERE id=? AND vault_id=?',sourceEntity,vault)?.type!=='source')throw invalid();
          const pdfFlattened=row.pdf_flattened??0;
          if(pdfFlattened!==0&&pdfFlattened!==1)throw invalid();
          const containsMath=row.contains_math??0;
          if(containsMath!==0&&containsMath!==1)throw invalid();
          const admitted=row.admitted??1;
          if(admitted!==0&&admitted!==1)throw invalid();
          const format=row.format??name(row,'name').split('.').at(-1)?.toLowerCase();
          if(!['txt','md','pdf','html','url'].includes(String(format))||format==='url'&&(!sourceUrl||admitted!==0))throw invalid();
          const added=sourceFiles.add(vault,name(row,'name'),bytes,undefined,sourceUrl,pdfFlattened===1,admitted===0,format as import('../../shared/domain.js').SourceFile['format'],containsMath===1);writtenSources.push(added.id);restoredSourceFiles.set(name(row,'id'),added.id);
          this.store.run('UPDATE source_files SET entity_id=? WHERE id=?',sourceEntity,added.id);
          if(row.page_start_lines!==undefined) {
            const starts=list(json(row,'page_start_lines'));
            if(starts.length>1000||starts.some((value,index)=>!Number.isSafeInteger(value)||(value as number)<1||index===0&&value!==1||index>0&&(value as number)<=(starts[index-1] as number)))throw invalid();
            this.store.run('UPDATE source_files SET page_start_lines=? WHERE id=?',JSON.stringify(starts),added.id);
          }
          if(row.structural_nodes!==undefined) {
            const nodes=list(json(row,'structural_nodes'));
            const sourceLineCount=string(row,'text',16*1024*1024).replace(/\r\n?/g,'\n').split('\n').length;
            if(nodes.length>sourceLineCount)throw invalid();
            for(const value of nodes) {
              if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
              const node=value as Record<string,unknown>;
              if(typeof node.text!=='string'||!node.text.trim()||node.text.length>2000||!Number.isSafeInteger(node.startLine)||(node.startLine as number)<1||(node.startLine as number)>sourceLineCount||node.level!==undefined&&(!Number.isSafeInteger(node.level)||(node.level as number)<1||(node.level as number)>6))throw invalid();
              if(node.kind!==undefined&&!sourceStructureKinds.includes(node.kind as SourceStructureKind)||node.endLine!==undefined&&(!Number.isSafeInteger(node.endLine)||(node.endLine as number)<(node.startLine as number)||(node.endLine as number)>sourceLineCount))throw invalid();
            }
            this.store.run('UPDATE source_files SET structural_nodes=? WHERE id=?',JSON.stringify(nodes),added.id);
          }
          const enrichmentStatus=row.enrichment_status??'pending';
          if(!['pending','running','completed','failed'].includes(String(enrichmentStatus)))throw invalid();
          this.store.run('UPDATE source_files SET original_filename=?,generated_name=?,language=?,summary=?,enrichment_status=? WHERE id=?',
            row.original_filename===undefined?name(row,'name'):string(row,'original_filename',255),row.generated_name==null?null:string(row,'generated_name',200),pageLanguage(row.language),row.summary==null?null:limitSummaryWords(string(row,'summary',12000)),enrichmentStatus==='running'?'pending':String(enrichmentStatus),added.id);
          const status=string(row,'status',20);if(!['queued','processing','ready','failed'].includes(status)||status==='ready'&&admitted!==1)throw invalid();
          this.store.run('UPDATE source_files SET status=?,text=?,error=?,progress=?,pages=?,ocr_pages=?,created_at=? WHERE id=?',status==='processing'?'queued':status,string(row,'text',16*1024*1024),nullable(row,'error',2000),integer(row,'progress',0,100),integer(row,'pages',0,1000),integer(row,'ocr_pages',0,1000),timestamp(row,'created_at'),added.id);
        }
        for(const row of rows.source_math_documents) {
          const fileId=restoredSourceFiles.get(name(row,'file_id'));if(!fileId)throw invalid();
          const raw=this.store.get<{text:string}>('SELECT text FROM source_files WHERE id=?',fileId)!;
          const cleaned=string(row,'cleaned_text',32*1024*1024),rawHash=string(row,'raw_hash',64);
          if(sourceTextHash(raw.text)!==rawHash||cleaned.split('\n').length!==raw.text.replace(/\r\n?/g,'\n').split('\n').length)throw invalid();
          const uncertainty=JSON.parse(string(row,'uncertainty_json',4*1024*1024));
          if(!Array.isArray(uncertainty)||uncertainty.some(issue=>!issue||!Number.isInteger(issue.id)||issue.id<0||issue.id>=cleaned.split('\n').length||typeof issue.text!=='string'||issue.text.length>1000))throw invalid();
          const algorithmVersion=row.algorithm_version===undefined?1:integer(row,'algorithm_version',1,2);
          this.store.run('INSERT INTO source_math_documents(file_id,raw_hash,cleaned_text,uncertainty_json,updated_at,algorithm_version) VALUES(?,?,?,?,?,?)',fileId,rawHash,cleaned,JSON.stringify(uncertainty),now(),algorithmVersion);
        }
        this.store.run("UPDATE entities SET inactive=CASE WHEN EXISTS (SELECT 1 FROM source_files WHERE entity_id=entities.id AND status='failed') THEN 1 ELSE 0 END WHERE vault_id=? AND type='source'",vault);
        for(const row of rows.properties)insert('properties',{id:randomUUID(),entity_id:ref(entityIds,row.entity_id),name:name(row,'name'),value:nullable(row,'value'),target_id:row.target_id===null?null:ref(entityIds,row.target_id)});
        for(const entityId of entityIds.values())if(this.store.get<{type:string}>('SELECT type FROM entities WHERE id=?',entityId)?.type==='source')syncSourceProvenance(this.store,vault,entityId);
        for(const row of rows.relationships)insert('relationships',{id:randomUUID(),source_id:ref(entityIds,row.source_id),label:name(row,'label'),target_id:ref(entityIds,row.target_id)});
        const pages=new Pages(this.store,new Knowledge(this.store));
        for(const row of rows.pages) {
          if(row.icon!==null&&!isPageIconId(row.icon))throw invalid();
          const blocks=list(json(row,'blocks')).map(value=>{
            const block={...object(value)};
            if(!blockTypes.includes(block.type as typeof blockTypes[number]))throw invalid();
            const segments=(value:unknown)=>list(value).map(value=>{
              const segment={...object(value)};
              if(segment.entityId)segment.entityId=ref(entityIds,segment.entityId);
              if(segment.sourceReference) {
                const citation=object(segment.sourceReference),fileId=restoredSourceFiles.get(name(citation,'fileId'));
                if(!fileId)throw invalid();
                segment.sourceReference={...citation,id:randomUUID(),sourceId:ref(entityIds,citation.sourceId),fileId};
              }
              return segment;
            });
            block.content=segments(block.content);
            if(block.type==='image')block.imageId=ref(imageIds,block.imageId);
            if((block.type==='table'||block.type==='columns'))block.rows=list(block.rows).map(row=>list(row).map(segments));
            return block;
          });
          const validated=pages.validateBlocks(vault,blocks);
          if(row.ai_status!==undefined&&!isPageAIStatus(row.ai_status))throw invalid();
          const aiStatus=row.ai_status==='ai_generated'||row.ai_status==='ai_generated_edited'?row.ai_status:validated.some(isAIExplanation)?'regular_with_ai_explanations':'regular';
          insert('pages',{id:ref(pageIds,row.id),vault_id:vault,title:string(row,'title',500),icon:row.icon as string|null,featured_image_id:row.featured_image_id==null?null:ref(imageIds,row.featured_image_id),blocks:JSON.stringify(validated),ai_status:aiStatus,generation_metadata:row.generation_metadata==null?null:JSON.stringify(parsePageGenerationMetadata(row.generation_metadata)),language:pageLanguage(row.language),created_at:row.created_at==null?null:timestamp(row,'created_at'),updated_at:timestamp(row,'updated_at'),revision:integer(row,'revision',1),deleted_at:row.deleted_at===null?null:timestamp(row,'deleted_at')});
        }
        for(const row of rows.pages) {
          const pageId=ref(pageIds,row.id);
          const saved=this.store.get<{blocks:string}>('SELECT blocks FROM pages WHERE id=?',pageId)!;
          const blocks=JSON.parse(saved.blocks);
          syncSourceReferences(this.store,pageId,blocks);
          this.store.run('UPDATE pages SET blocks=? WHERE id=?',JSON.stringify(blocks),pageId);
        }
        const detachedSources=new Map<string,string>(),detachedFiles=new Map<string,string>();
        const detached=(map:Map<string,string>,value:unknown)=>{
          if(typeof value!=='string'||!value.trim())throw invalid();
          if(!map.has(value))map.set(value,randomUUID());
          return map.get(value)!;
        };
        const readingAnchor=(row:Row,allowDetached:boolean)=>{
          const source=row.source_id===null&&allowDetached?null:ref(entityIds,row.source_id);
          const file=row.file_id===null&&allowDetached?null:ref(restoredSourceFiles,row.file_id);
          if(source!==null&&this.store.get<{type:string}>('SELECT type FROM entities WHERE id=?',source)?.type!=='source')throw invalid();
          if(file!==null) {
            const owner=this.store.get<{entity_id:string}>('SELECT entity_id FROM source_files WHERE id=?',file);
            if(!owner||owner.entity_id!==source)throw invalid();
          }
          const hash=string(row,'source_hash',64),start=integer(row,'start_offset'),end=integer(row,'end_offset'),excerpt=string(row,'excerpt',65536);
          if(!/^[a-f0-9]{64}$/.test(hash)||end<=start||!excerpt.trim()||excerpt.length!==end-start)throw invalid();
          const reference=object(json(row,'reference_json'));
          const startLine=integer(reference,'startLine',1),endLine=integer(reference,'endLine',startLine);
          if(reference.sourceHash!==hash||reference.startOffset!==start||reference.endOffset!==end||reference.excerpt!==excerpt)throw invalid();
          if((source!==null&&reference.sourceId!==row.source_id)||(file!==null&&reference.fileId!==row.file_id))throw invalid();
          const restoredReference={...reference,id:randomUUID(),sourceId:source??detached(detachedSources,reference.sourceId),fileId:file??detached(detachedFiles,reference.fileId),startLine,endLine,...(source===null||file===null?{stale:true}:{})};
          return {vault_id:vault,source_id:source,file_id:file,source_hash:hash,start_offset:start,end_offset:end,excerpt,reference_json:JSON.stringify(restoredReference),created_at:timestamp(row,'created_at')};
        };
        const highlightIds=ids(rows.highlights);
        for(const row of rows.highlights) {
          if(!highlightColors.includes(row.color as HighlightColor))throw invalid();
          insert('highlights',{id:ref(highlightIds,row.id),...readingAnchor(row,false),color:String(row.color)});
        }
        for(const row of rows.page_reading_notes) {
          const pageId=ref(pageIds,row.page_id),page=this.store.get<{blocks:string}>('SELECT blocks FROM pages WHERE id=?',pageId)!;
          const content=projectPageText(JSON.parse(page.blocks) as Block[],id=>entityMentionName(new Knowledge(this.store).find(vault,id))).text;
          if(readingNoteWordCount(content)>readingNoteMaxWords)throw invalid();
          insert('page_reading_notes',{page_id:pageId,...readingAnchor(row,true)});
        }
        for(const row of rows.page_domain_state) {
          if(row.origin!=='manual'&&row.origin!=='inferred')throw invalid();
          const hash=row.content_hash===null?null:string(row,'content_hash',100);
          if(hash!==null&&!/^[a-f0-9]{64}$/.test(hash))throw invalid();
          insert('page_domain_state',{page_id:ref(pageIds,row.page_id),origin:row.origin,content_hash:hash,taxonomy_version:name(row,'taxonomy_version'),revision:integer(row,'revision')});
        }
        for(const row of rows.page_domains) {
          const domainId=name(row,'domain_id');
          if(!domainById(domainId)||!['primary','secondary'].includes(String(row.role))||!['manual','inferred'].includes(String(row.origin)))throw invalid();
          const pageId=ref(pageIds,row.page_id);
          const state=rows.page_domain_state.find(state=>state.page_id===row.page_id);
          if(!state||state.origin!==row.origin)throw invalid();
          insert('page_domains',{page_id:pageId,domain_id:domainId,role:String(row.role),origin:String(row.origin),updated_at:timestamp(row,'updated_at')});
        }
        for(const row of rows.entity_domains) {
          const domainId=name(row,'domain_id'),entityId=ref(entityIds,row.entity_id);
          if(!domainById(domainId)||!['manual','scan','inferred'].includes(String(row.origin))||this.store.get<{type:string}>('SELECT type FROM entities WHERE id=?',entityId)?.type!=='concept')throw invalid();
          insert('entity_domains',{entity_id:entityId,domain_id:domainId,origin:String(row.origin)});
        }
        for(const row of rows.page_edit_locks) {
          const passwordHash=row.password_hash, salt=row.salt;
          if (passwordHash===null ? salt!==null : typeof passwordHash!=='string'||!/^[a-f0-9]{128}$/.test(passwordHash)||typeof salt!=='string'||!/^[a-f0-9-]{36}$/.test(salt)) throw invalid();
          insert('page_edit_locks',{page_id:ref(pageIds,row.page_id),vault_id:vault,password_hash:passwordHash as string|null,salt:salt as string|null});
        }
        for(const row of rows.page_sources) {
          const source=ref(entityIds,row.source_id);
          if(this.store.get<{type:string}>('SELECT type FROM entities WHERE id=?',source)?.type!=='source')throw invalid();
          insert('page_sources',{page_id:ref(pageIds,row.page_id),source_id:source});
        }
        for(const row of rows.page_source_dismissals) {
          const source=ref(entityIds,row.source_id);
          if(this.store.get<{type:string}>('SELECT type FROM entities WHERE id=?',source)?.type!=='source')throw invalid();
          insert('page_source_dismissals',{page_id:ref(pageIds,row.page_id),source_id:source});
        }
        for(const row of rows.collections)insert('collections',{id:ref(collectionIds,row.id),vault_id:vault,name:name(row,'name')});
        for(const row of rows.folders)insert('folders',{id:ref(folderIds,row.id),vault_id:vault,name:name(row,'name'),parent_id:null});
        for(const row of rows.folders)if(row.parent_id!==null)this.store.run('UPDATE folders SET parent_id=? WHERE id=?',ref(folderIds,row.parent_id),ref(folderIds,row.id));
        for(const row of rows.item_locations)insert('item_locations',{vault_id:vault,...item(row),folder_id:row.folder_id===null?null:ref(folderIds,row.folder_id)});
        for(const row of rows.collection_folders)insert('collection_folders',{vault_id:vault,folder_id:ref(folderIds,row.folder_id),collection_id:ref(collectionIds,row.collection_id)});
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
          if(kind==='domain_classification') {
            if(data.primaryDomainId!==null&&(typeof data.primaryDomainId!=='string'||!domainById(data.primaryDomainId)))throw invalid();
            if(list(data.secondaryDomainIds).some(id=>typeof id!=='string'||!domainById(id)))throw invalid();
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
        if(rows.page_enrichment_settings.length>1)throw invalid();
        for(const row of rows.page_enrichment_settings)insert('page_enrichment_settings',{
          vault_id:vault,automatic_summaries:integer(row,'automatic_summaries',0,1),
        });
        if(rows.embedding_settings.length>1)throw invalid();
        for(const row of rows.embedding_settings) {
          const policy=row.page_policy==null?null:json(row,'page_policy');
          if(policy!==null&&!isPageIndexPolicy(policy))throw invalid();
          insert('embedding_settings',{vault_id:vault,automatic:integer(row,'automatic',0,1),min_characters:integer(row,'min_characters',20,2000),page_policy:policy===null?null:JSON.stringify(policy)});
        }
        for(const row of rows.page_segment_cache) {
          const dimensions=integer(row,'dimensions',1,4096),vector=list(json(row,'vector'));
          if(vector.length!==dimensions||vector.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw invalid();
          insert('page_segment_cache',{page_id:ref(pageIds,row.page_id),model:name(row,'model'),dimensions,content_hash:string(row,'content_hash',100),vector:JSON.stringify(vector),tokens:integer(row,'tokens'),updated_at:timestamp(row,'updated_at')});
        }
        for(const row of rows.note_embeddings) {
          const dimensions=integer(row,'dimensions',1,4096),vector=list(json(row,'vector'));
          if(vector.length!==dimensions||vector.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw invalid();
          insert('note_embeddings',{page_id:ref(pageIds,row.page_id),model:name(row,'model'),dimensions,content_hash:string(row,'content_hash',100),revision:integer(row,'revision',1),vector:JSON.stringify(vector),tokens:integer(row,'tokens'),updated_at:timestamp(row,'updated_at')});
        }
        // Recompute after validation/remapping instead of trusting a supplied page fingerprint.
        syncReadingNotesCollection(this.store,vault);
        for(const id of pageIds.values())if(!this.store.get<{deleted_at:string|null}>('SELECT deleted_at FROM pages WHERE id=?',id)!.deleted_at)pages.get(vault,id);
      });
    } catch(error) {
      for(const id of writtenSources){try{sourceFiles.removeAssets(vault,id);}catch{/* Rollback removes only newly written files. */}}
      for(const id of writtenImages)this.images.remove(vault,id);
      if(error instanceof HttpError)throw error;
      throw invalid();
    }
    return this.vaults.list().find(item=>item.id===vault)!;
  }
}
