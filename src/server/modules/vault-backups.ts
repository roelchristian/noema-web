import {parseExampleCollection} from '../../shared/example-collections.js';
import {parseSmartRule,parseSemanticCollection,type SmartRuleNode} from '../../shared/smart-collections.js';
import {propertyOrigins,type PropertyOrigin} from '../../shared/property-provenance.js';
import {proposalIdentity,rawSourceHash} from './property-provenance.js';
import {adaptTemporalProperty} from '../../shared/temporal-properties.js';
import {propertyFingerprint} from './temporal-properties.js';
import {syncPropertyMetadata,isStoredPropertyDefinition,bindPropertyDefinition} from './property-storage.js';
import type {PropertyDefinition} from '../../shared/property-definitions.js';
import {recommendedPropertyDefinitions,builtinPropertyDefinitions} from '../../shared/property-definitions.js';
import {temporalDate} from '../../shared/temporal.js';
import {temporalMentionId} from './temporal.js';
import {restoreSourceRevision} from './source-reprocessing-backup.js';
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
// Explicit, versioned allowlist: credentials, global settings and activity are never archived.
// Editorial evidence is retained, but restored revisions never resume paid background jobs.
const tables={
  temporal_dates:{columns:'id,value,precision,calendar',scope:'vault_id=?'},
  temporal_curation:{columns:'id,label,annotation,pinned,importance,personal_priority,layer',scope:'vault_id=?'},
  temporal_mentions:{columns:'id,page_id,block_id,block_hash,start_offset,end_offset,original_text,date_id,reason,revision,stale',scope:'vault_id=?'},
  temporal_source_mentions:{columns:'id,file_id,source_id,passage_id,generation_id,source_hash,passage_hash,start_offset,end_offset,start_line,end_line,original_text,date_id,reason,stale',scope:'vault_id=?'},
  temporal_property_dirty:{columns:'property_id',scope:'vault_id=?'},
  temporal_property_values:{columns:'property_id,entity_id,date_id,raw_hash,reason',scope:'vault_id=?'},
  property_provenance:{columns:'property_id,origin,source_file_id,source_hash,details,stale,created_at,updated_at',scope:'vault_id=?'},
  entity_name_provenance:{columns:'entity_id,origin,source_file_id,source_hash,details,stale,created_at,updated_at',scope:'vault_id=?'},
  property_proposals:{columns:'id,entity_id,kind,property_id,property_name,value,target_id,origin,source_file_id,source_hash,details,status,created_at,updated_at',scope:'vault_id=?'},
  source_author_jobs:{columns:'file_id,status,content_hash,attempts,next_attempt_at,error,updated_at',scope:'vault_id=? AND file_id IN (SELECT id FROM source_files WHERE entity_id IS NOT NULL)'},
  property_definitions:{columns:'id,definition_json',scope:'vault_id=?'},
  property_value_metadata:{columns:'property_id,definition_id,compatibility,reason,integer_value,decimal_value,boolean_value,text_value,latitude,longitude,unit,position,target_id,temporal_date_id',scope:'vault_id=?'},
  temporal_relations:{columns:'id,date_id,entity_id,mention_id,kind,origin,status,confidence,source_mention_id,property_id,property_hash',scope:'vault_id=?'},
  pages:{columns:'id,title,icon,featured_image_id,blocks,ai_status,ai_review_accepted,generation_metadata,language,created_at,updated_at,revision,deleted_at',scope:'vault_id=?'},
  source_reprocessing:{columns:'id,file_id,status,created_at,updated_at,payload',scope:'vault_id=? AND file_id IN (SELECT id FROM source_files WHERE entity_id IS NOT NULL)'},
  source_math_documents:{columns:'file_id,raw_hash,algorithm_version,cleaned_text,uncertainty_json,updated_at',scope:'file_id IN (SELECT id FROM source_files WHERE vault_id=? AND entity_id IS NOT NULL)'},
  source_files:{columns:'id,entity_id,name,size,status,text,error,progress,pages,ocr_pages,created_at,import_method,source_url,pdf_flattened,admitted,format,page_start_lines,structural_nodes,original_filename,language,summary,generated_name,enrichment_status,contains_math',scope:'vault_id=? AND entity_id IS NOT NULL'},
  source_reading_locations:{columns:'file_id,id,label,anchor_json',scope:'vault_id=? AND file_id IN (SELECT id FROM source_files WHERE entity_id IS NOT NULL)'},
  highlights:{columns:'id,source_id,file_id,source_hash,start_offset,end_offset,excerpt,color,reference_json,created_at',scope:'vault_id=?'},
  page_reading_notes:{columns:'page_id,source_id,file_id,source_hash,start_offset,end_offset,excerpt,reference_json,created_at',scope:'vault_id=?'},
  entities:{columns:'id,name,aliases,mention_case,type,subtypes,description,updated_at,inactive,archived_at',scope:'vault_id=?'},
  entity_overviews:{columns:'entity_id,content,revision',scope:entityScope},
  entity_page_associations:{columns:'entity_id,page_id,pinned,annotation,created_at',scope:entityScope},
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
  smart_collection_definitions:{columns:'collection_id,rule_json,matching,semantic_json,examples_json,query_vector,query_model,query_dimensions',scope:'vault_id=?'},
  smart_collection_overrides:{columns:'collection_id,kind,item_id,decision',scope:'vault_id=?'},
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
type Backup={format:'noema-vault-backup';version:1;createdAt:string;vault:{name:string};tables:Record<Table,Row[]>;images:{id:string;data:string}[];sourceFiles?:{id:string;data:string;evidence?:Record<string,unknown>}[]};
const invalid=()=>new HttpError(400,'This backup contains invalid data or missing references.');
function string(row:Row,key:string,max=10000) {return text(row[key],max);}
function name(row:Row,key:string) {return required(row[key]);}
function propertyName(row:Row) {const value=string(row,'name',200);if(!value.trim())throw invalid();return value;}
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
      syncPropertyMetadata(this.store,vault);
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
        const evidence=new SourceFiles(this.store).exportEvidence(vault,file.id as string);
        estimated+=Buffer.byteLength(JSON.stringify(evidence));
        if(estimated>maxExpandedBytes)throw new HttpError(413,'This vault exceeds the 256 MB expanded backup limit.');
        return {id:file.id as string,data:bytes.toString('base64'),evidence};
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
    for(const table of Object.keys(tables) as Table[]) {rows[table]=list(table.startsWith('smart_collection_')||table.startsWith('temporal_')||table==='property_provenance'||table==='entity_name_provenance'||table==='property_proposals'||table==='source_author_jobs'||table==='property_definitions'||table==='property_value_metadata'||table==='entity_overviews'||table==='entity_page_associations'||table==='source_reading_locations'||table==='source_reprocessing'||table==='page_domains'||table==='page_domain_state'||table==='entity_domains'||table==='page_segment_cache'||table==='source_math_documents'||table==='source_files'||table==='entity_subtype_properties'||table==='collection_folders'||table==='page_edit_locks'||table==='page_enrichment_settings'||table==='page_source_dismissals'||table==='highlights'||table==='page_reading_notes'?(data[table]??[]):data[table]).map(object);total+=rows[table].length;}
    const splitSourceOwners=new Set<unknown>(),sourceOwners=new Set<unknown>(),legacyEntities=new Map(rows.entities.map(row=>[row.id,row]));
    const legacyProperties=[...rows.properties],legacyLinks=[...rows.page_sources];
    for(const file of rows.source_files) {
      if(!sourceOwners.has(file.entity_id)){sourceOwners.add(file.entity_id);continue;}
      const owner=legacyEntities.get(file.entity_id);
      if(!owner||owner.type!=='source')throw invalid();
      const id=randomUUID(),original=file.entity_id;splitSourceOwners.add(original);splitSourceOwners.add(id);
      const properties=legacyProperties.filter(row=>row.entity_id===original),links=legacyLinks.filter(row=>row.source_id===original),clonedPropertyIds=new Map<unknown,string>();
      total+=1+properties.length+links.length;
      if(total>200000)throw new HttpError(413,'This backup contains too many records.');
      rows.entities.push({...owner,id,name:name(file,'name').slice(0,200),aliases:'[]'});
      for(const row of properties) {
        const propertyId=randomUUID();clonedPropertyIds.set(row.id,propertyId);rows.properties.push({...row,id:propertyId,entity_id:id});
        const provenance=rows.property_provenance.find(item=>item.property_id===row.id);
        if(provenance){rows.property_provenance.push({...provenance,property_id:propertyId});total++;}
        const metadata=rows.property_value_metadata.find(item=>item.property_id===row.id);
        if(metadata){rows.property_value_metadata.push({...metadata,property_id:propertyId});total++;}
        const temporal=rows.temporal_property_values.find(item=>item.property_id===row.id);
        if(temporal){rows.temporal_property_values.push({...temporal,property_id:propertyId,entity_id:id});total++;}
        if(rows.temporal_property_dirty.some(item=>item.property_id===row.id)){rows.temporal_property_dirty.push({property_id:propertyId});total++;}
      }
      for(const proposal of rows.property_proposals)if(proposal.entity_id===original&&proposal.source_file_id===file.id){proposal.entity_id=id;if(proposal.property_id!=null){const mapped=clonedPropertyIds.get(proposal.property_id);if(mapped)proposal.property_id=mapped;}}
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
    const propertyIds=ids(rows.properties),pageIds=ids(rows.pages),entityIds=ids(rows.entities),folderIds=ids(rows.folders),collectionIds=ids(rows.collections),subtypeIds=ids(rows.entity_subtypes),imageIds=new Map<string,string>();
    const subtypeTypes=new Map(rows.entity_subtypes.map(row=>[row.id,row.type]));
    const ref=(map:Map<string,string>,value:unknown)=>{if(typeof value!=='string'||!map.has(value))throw invalid();return map.get(value)!;};
    const subtype=(value:unknown,type:EntityType)=>{
      if(typeof value!=='string')throw invalid();
      // A legacy custom identity may predate a newly introduced builtin ID.
      // Its archived ownership takes precedence; never reinterpret it as native.
      if(subtypeTypes.has(value)){if(subtypeTypes.get(value)!==type)throw invalid();return ref(subtypeIds,value);}
      const builtin=builtinSubtypes.find(item=>item.id===value&&item.type===type);if(builtin)return builtin.id;
      throw invalid();
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
    const removedManagedProperty=(oldId:unknown,propertyId:string)=>{
      const authored=rows.properties.find(item=>item.id===oldId),owner=authored&&rows.entities.find(item=>item.id===authored.entity_id);
      return !!authored&&owner?.type==='source'&&authored.target_id===null&&['Import method','Source URL'].includes(String(authored.name))&&!this.store.get('SELECT 1 FROM properties WHERE id=?',propertyId);
    };
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
          const type=subtypeTypes.get(id) ?? builtinSubtypes.find(item=>item.id===id)?.type;
          if(!entityTypes.includes(type as EntityType))throw invalid();
          insert('entity_subtype_properties',{vault_id:vault,subtype_id:subtype(id,type as EntityType),name:name(row,'name')});
        }
        for(const row of rows.entities) {
          const type=entityType(row),aliases=list(json(row,'aliases')).map(value=>required(value,200)),subtypes=list(json(row,'subtypes')).map(value=>subtype(value,type));
          if(aliases.length>100||new Set(subtypes).size!==subtypes.length)throw invalid();
          const mentionCase=row.mention_case??'canonical';
          if(mentionCase!=='canonical'&&mentionCase!=='lowercase')throw invalid();
          if(row.inactive!==undefined&&row.inactive!==0&&row.inactive!==1)throw invalid();
          insert('entities',{archived_at:row.archived_at==null?null:timestamp(row,'archived_at'),inactive:row.inactive??0,id:ref(entityIds,row.id),vault_id:vault,name:name(row,'name'),type,aliases:JSON.stringify(type==='source'?[]:aliases),mention_case:mentionCase,subtypes:JSON.stringify(subtypes),description:string(row,'description'),updated_at:timestamp(row,'updated_at')});
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
          this.store.run('INSERT INTO source_automation_pauses (file_id,vault_id,reason,created_at) VALUES (?,?,?,?)',added.id,vault,'Restored source: resume enrichment only after an explicit retry.',now());
          if(asset.evidence!==undefined)sourceFiles.restoreEvidence(vault,added.id,asset.evidence);
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
            row.original_filename===undefined?name(row,'name'):string(row,'original_filename',255),row.generated_name==null?null:string(row,'generated_name',200),pageLanguage(row.language),row.summary==null?null:limitSummaryWords(string(row,'summary',12000)),enrichmentStatus==='running'||enrichmentStatus==='pending'?'failed':String(enrichmentStatus),added.id);
          if(enrichmentStatus==='running'||enrichmentStatus==='pending')this.store.run('UPDATE source_files SET enrichment_error=? WHERE id=?','Restored pending enrichment is paused; retry explicitly to resume.',added.id);
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
        const editorialIds=ids(rows.source_reprocessing);
        for(const row of rows.source_reprocessing) {
          const oldId=name(row,'id'),oldFile=name(row,'file_id'),fileId=ref(restoredSourceFiles,oldFile);
          const payload=object(json(row,'payload')),revision=restoreSourceRevision(payload,oldId,oldFile,ref(editorialIds,oldId),fileId);
          if(row.status!==payload.status||timestamp(row,'created_at')!==revision.createdAt||timestamp(row,'updated_at')!==revision.updatedAt)throw invalid();
          insert('source_reprocessing',{id:revision.id,file_id:fileId,vault_id:vault,status:revision.status,created_at:revision.createdAt,updated_at:revision.updatedAt,payload:JSON.stringify(revision)});
        }
        this.store.run("UPDATE entities SET inactive=CASE WHEN EXISTS (SELECT 1 FROM source_files WHERE entity_id=entities.id AND status='failed') THEN 1 ELSE 0 END WHERE vault_id=? AND type='source'",vault);
        for(const row of rows.properties)insert('properties',{id:ref(propertyIds,row.id),entity_id:ref(entityIds,row.entity_id),name:propertyName(row),value:nullable(row,'value'),target_id:row.target_id===null?null:ref(entityIds,row.target_id)});
        const sourceRef=(value:unknown)=>value===null?null:ref(restoredSourceFiles,value);
        const nullableHash=(row:Row,key:string)=>{const hash=row[key]===null?null:string(row,key,64);if(hash!==null&&!/^[a-f0-9]{64}$/.test(hash))throw invalid();return hash;};
        const evidence=(row:Row)=>{
          if(!propertyOrigins.includes(row.origin as PropertyOrigin))throw invalid();
          const source_file_id=sourceRef(row.source_file_id),source_hash=nullableHash(row,'source_hash'),stale=integer(row,'stale',0,1);
          if(source_file_id&&source_hash&&!stale&&rawSourceHash(this.store.get<{text:string}>('SELECT text FROM source_files WHERE id=?',source_file_id)!.text)!==source_hash)throw invalid();
          return {origin:String(row.origin),source_file_id,source_hash,details:string(row,'details'),stale,created_at:timestamp(row,'created_at'),updated_at:timestamp(row,'updated_at')};
        };
        const provenanceIds=new Set<string>(),nameProvenanceIds=new Set<string>();
        for(const row of rows.property_provenance) {
          const property_id=ref(propertyIds,row.property_id);if(provenanceIds.has(property_id))throw invalid();provenanceIds.add(property_id);
          const value=evidence(row),fields={property_id,vault_id:vault,...value};
          const columns=Object.keys(fields),values=Object.values(fields);
          this.store.run(`INSERT INTO property_provenance (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')}) ON CONFLICT(property_id) DO UPDATE SET ${columns.filter(column=>column!=='property_id').map(column=>`${column}=excluded.${column}`).join(',')}`,...values);
        }
        for(const row of rows.entity_name_provenance) {
          const entity_id=ref(entityIds,row.entity_id);if(nameProvenanceIds.has(entity_id))throw invalid();nameProvenanceIds.add(entity_id);
          const value=evidence(row),fields={entity_id,vault_id:vault,...value};
          const columns=Object.keys(fields),values=Object.values(fields);
          this.store.run(`INSERT INTO entity_name_provenance (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')}) ON CONFLICT(entity_id) DO UPDATE SET ${columns.filter(column=>column!=='entity_id').map(column=>`${column}=excluded.${column}`).join(',')}`,...values);
        }
        const receiptIds=new Set<string>();
        for(const row of rows.source_author_jobs) {
          const file_id=ref(restoredSourceFiles,row.file_id);if(receiptIds.has(file_id))throw invalid();receiptIds.add(file_id);
          const status=string(row,'status',20);if(!['pending','running','completed','failed'].includes(status))throw invalid();
          const hash=nullableHash(row,'content_hash'),file=this.store.get<{text:string}>('SELECT text FROM source_files WHERE id=?',file_id)!;
          if(hash!==null&&hash!==rawSourceHash(file.text))throw invalid();
          const error=row.error===null?null:string(row,'error',2000),updated_at=timestamp(row,'updated_at'),nextAttempt=string(row,'next_attempt_at',100);
          if(nextAttempt&&!Number.isFinite(Date.parse(nextAttempt)))throw invalid();
          this.store.run('INSERT OR REPLACE INTO source_author_jobs (file_id,vault_id,status,content_hash,attempts,next_attempt_at,error,updated_at) VALUES (?,?,?,?,?,?,?,?)',file_id,vault,'completed',hash??rawSourceHash(file.text),integer(row,'attempts'),status==='completed'?nextAttempt:'',status==='completed'?error:`Restored ${status} author work is paused; retry explicitly to resume.`,updated_at);
        }
        // Old archives have no durable author receipt. Suppress an automatic paid
        // backfill while preserving the ability to explicitly retry source enrichment.
        for(const file_id of restoredSourceFiles.values())if(!receiptIds.has(file_id)) {
          const file=this.store.get<{text:string}>('SELECT text FROM source_files WHERE id=?',file_id)!;
          this.store.run('INSERT OR REPLACE INTO source_author_jobs (file_id,vault_id,status,content_hash,error,updated_at) VALUES (?,?,?,?,?,?)',file_id,vault,'completed',rawSourceHash(file.text),'Restored archive: automatic author extraction is paused.',now());
        }
        // Modern archives already contain authored metadata and its exact evidence.
        // Reconcile older archives and legacy owners split into separate sources.
        for(const [oldEntityId,entityId] of entityIds)if((data.property_provenance===undefined||splitSourceOwners.has(oldEntityId))&&this.store.get<{type:string}>('SELECT type FROM entities WHERE id=?',entityId)?.type==='source')syncSourceProvenance(this.store,vault,entityId);
        const importedDefinitions=new Map<string,PropertyDefinition>();
        for(const row of rows.property_definitions) {
          const oldId=string(row,'id',2000),parsed=json(row,'definition_json');
          if(!isStoredPropertyDefinition(parsed))throw invalid();
          const definition=parsed;
          if(definition.id!==oldId||importedDefinitions.has(oldId))throw invalid();
          const scope=definition.scope;
          const remapped:PropertyDefinition={...definition,scope:scope.kind==='subtype'?{...scope,subtypeId:subtype(scope.subtypeId,scope.type)}:scope,allowedTargetSubtypes:definition.allowedTargetSubtypes.map(id=>{const targetType=subtypeTypes.get(id)??builtinSubtypes.find(item=>item.id===id)?.type;if(!entityTypes.includes(targetType as EntityType))throw invalid();return subtype(id,targetType as EntityType);})};
          const builtin=[...builtinPropertyDefinitions,...recommendedPropertyDefinitions].find(item=>item.id===oldId);
          if(definition.origin==='builtin'&&!builtin||oldId.startsWith('builtin:')&&!builtin)throw invalid();
          if(builtin&&(definition.origin!==builtin.origin||definition.editable!==builtin.editable||JSON.stringify(definition.validation)!==JSON.stringify(builtin.validation)||definition.key!==builtin.key||definition.legacyName!==builtin.legacyName||JSON.stringify(definition.scope)!==JSON.stringify(builtin.scope)||definition.valueKind!==builtin.valueKind||definition.cardinality!==builtin.cardinality||JSON.stringify(definition.allowedTargetTypes)!==JSON.stringify(builtin.allowedTargetTypes)||JSON.stringify(definition.allowedTargetSubtypes)!==JSON.stringify(builtin.allowedTargetSubtypes)))throw invalid();
          importedDefinitions.set(oldId,remapped);
          insert('property_definitions',{vault_id:vault,id:oldId,definition_json:JSON.stringify(remapped)});
        }
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
          if(row.ai_review_accepted!==undefined&&row.ai_review_accepted!==0&&row.ai_review_accepted!==1)throw invalid();
          const aiStatus=row.ai_status==='ai_generated'||row.ai_status==='ai_generated_edited'?row.ai_status:validated.some(isAIExplanation)?'regular_with_ai_explanations':'regular';
          insert('pages',{id:ref(pageIds,row.id),vault_id:vault,title:string(row,'title',500),icon:row.icon as string|null,featured_image_id:row.featured_image_id==null?null:ref(imageIds,row.featured_image_id),blocks:JSON.stringify(validated),ai_status:aiStatus,ai_review_accepted:row.ai_review_accepted===1||row.ai_status==='ai_assisted'?1:0,generation_metadata:row.generation_metadata==null?null:JSON.stringify(parsePageGenerationMetadata(row.generation_metadata)),language:pageLanguage(row.language),created_at:row.created_at==null?null:timestamp(row,'created_at'),updated_at:timestamp(row,'updated_at'),revision:integer(row,'revision',1),deleted_at:row.deleted_at===null?null:timestamp(row,'deleted_at')});
        }
        const temporalDates=new Set<string>();
        for(const row of rows.temporal_dates) {
          if(row.calendar!=='gregorian'&&row.calendar!=='julian')throw invalid();
          const date=temporalDate(string(row,'value',10),row.calendar);
          if(!date||date.id!==row.id||date.precision!==row.precision||temporalDates.has(date.id))throw invalid();
          temporalDates.add(date.id);
          insert('temporal_dates',{vault_id:vault,...date});
        }
        const dateRef=(value:unknown)=>{if(typeof value!=='string'||!temporalDates.has(value))throw invalid();return value;};
        const importedTemporalProperties=new Set<string>();
        for(const row of rows.temporal_property_values) {
          const propertyId=ref(propertyIds,row.property_id),entityId=ref(entityIds,row.entity_id),dateId=row.date_id===null?null:dateRef(row.date_id),hash=string(row,'raw_hash',64);
          if(importedTemporalProperties.has(propertyId)||!/^[a-f0-9]{64}$/.test(hash)||!this.store.get('SELECT 1 FROM properties WHERE id=? AND entity_id=?',propertyId,entityId))throw invalid();
          importedTemporalProperties.add(propertyId);
          insert('temporal_property_values',{property_id:propertyId,vault_id:vault,entity_id:entityId,date_id:dateId,raw_hash:hash,reason:nullable(row,'reason',200)});
        }
        const importedDirtyProperties=new Set<string>();
        for(const row of rows.temporal_property_dirty) {
          const propertyId=ref(propertyIds,row.property_id);
          if(importedDirtyProperties.has(propertyId))throw invalid();
          if(removedManagedProperty(row.property_id,propertyId))continue;
          importedDirtyProperties.add(propertyId);
          this.store.run('INSERT OR REPLACE INTO temporal_property_dirty (property_id,vault_id) VALUES (?,?)',propertyId,vault);
        }
        if(data.temporal_property_dirty!==undefined)for(const propertyId of importedTemporalProperties)if(!importedDirtyProperties.has(propertyId)) {
          const evidence=this.store.get<{date_id:string|null;raw_hash:string;reason:string|null}>('SELECT date_id,raw_hash,reason FROM temporal_property_values WHERE property_id=?',propertyId)!;
          const authored=this.store.get<{name:string;value:string|null;target_id:string|null;type:string}>('SELECT p.name,p.value,p.target_id,e.type FROM properties p JOIN entities e ON e.id=p.entity_id WHERE p.id=?',propertyId)!;
          const adapted=authored.target_id===null&&authored.value!==null?adaptTemporalProperty(authored.type,authored.name,authored.value,rows.property_value_metadata.some(item=>ref(propertyIds,item.property_id)===propertyId&&importedDefinitions.get(String(item.definition_id))?.valueKind==='date')):null;
          // Only verified current caches may be marked clean; stale snapshots remain evidence with dirty state.
          if(!adapted||authored.value===null||evidence.raw_hash!==propertyFingerprint(authored.type,authored.name,authored.value)||evidence.date_id!==(adapted.date?.id??null)||evidence.reason!==adapted.reason)throw invalid();
          this.store.run('DELETE FROM temporal_property_dirty WHERE property_id=?',propertyId);
        }
        for(const row of rows.temporal_curation) {
          if(!['personal','knowledge','historical'].includes(String(row.layer??'knowledge'))||!['ordinary','notable','important'].includes(String(row.importance))||!['ordinary','important'].includes(String(row.personal_priority)))throw invalid();
          insert('temporal_curation',{vault_id:vault,id:dateRef(row.id),label:string(row,'label',200),annotation:string(row,'annotation',2000),pinned:integer(row,'pinned',0,1),importance:String(row.importance),personal_priority:String(row.personal_priority),layer:String(row.layer??'knowledge')});
        }
        const temporalMentions=new Map<string,string>(),mentionDates=new Map<string,string|null>();
        for(const row of rows.temporal_mentions) {
          const pageId=ref(pageIds,row.page_id),blockId=name(row,'block_id'),blockHash=string(row,'block_hash',64);
          const start=integer(row,'start_offset'),end=integer(row,'end_offset',start+1),original=string(row,'original_text');
          if(!/^[a-f0-9]{64}$/.test(blockHash)||original.length!==end-start||temporalMentions.has(name(row,'id')))throw invalid();
          const id=temporalMentionId(vault,pageId,blockId,blockHash,start,end),dateId=row.date_id===null?null:dateRef(row.date_id);
          temporalMentions.set(name(row,'id'),id);mentionDates.set(id,dateId);
          insert('temporal_mentions',{id,vault_id:vault,page_id:pageId,block_id:blockId,block_hash:blockHash,start_offset:start,end_offset:end,original_text:original,date_id:dateId,reason:nullable(row,'reason',200),revision:integer(row,'revision',1),stale:1});
        }
        const sourceMentionIds=new Map<string,string>(),sourceMentionDates=new Map<string,string|null>();
        for(const row of rows.temporal_source_mentions) {
          const oldId=name(row,'id'),id=randomUUID(),fileId=ref(restoredSourceFiles,row.file_id),sourceId=ref(entityIds,row.source_id),dateId=row.date_id===null?null:dateRef(row.date_id);
          if(sourceMentionIds.has(oldId)||!this.store.get('SELECT 1 FROM source_files WHERE id=? AND entity_id=? AND vault_id=?',fileId,sourceId,vault))throw invalid();
          const sourceHash=string(row,'source_hash',64),passageHash=string(row,'passage_hash',64),start=integer(row,'start_offset'),end=integer(row,'end_offset',start+1),original=string(row,'original_text');
          if(!/^[a-f0-9]{64}$/.test(sourceHash)||!/^[a-f0-9]{64}$/.test(passageHash)||original.length!==end-start)throw invalid();
          sourceMentionIds.set(oldId,id);sourceMentionDates.set(id,dateId);
          insert('temporal_source_mentions',{id,vault_id:vault,file_id:fileId,source_id:sourceId,passage_id:name(row,'passage_id'),generation_id:name(row,'generation_id'),source_hash:sourceHash,passage_hash:passageHash,start_offset:start,end_offset:end,start_line:integer(row,'start_line',1),end_line:integer(row,'end_line',integer(row,'start_line',1)),original_text:original,date_id:dateId,reason:nullable(row,'reason',200),stale:1});
        }
        for(const row of rows.temporal_relations) {
          const dateId=dateRef(row.date_id),mentionId=row.mention_id===null?null:ref(temporalMentions,row.mention_id),sourceMentionId=row.source_mention_id==null?null:ref(sourceMentionIds,row.source_mention_id),propertyId=row.property_id==null?null:ref(propertyIds,row.property_id),propertyHash=row.property_hash==null?null:string(row,'property_hash',64);
          if([mentionId,sourceMentionId,propertyId].filter(Boolean).length>1||sourceMentionId&&sourceMentionDates.get(sourceMentionId)!==dateId||propertyHash&&!/^[a-f0-9]{64}$/.test(propertyHash))throw invalid();
          if(mentionId&&mentionDates.get(mentionId)!==dateId||!['occurs_on','born_on','published_on','deadline','discusses'].includes(String(row.kind))||!['manual','inferred'].includes(String(row.origin))||!['accepted','pending','rejected'].includes(String(row.status))||row.confidence!==null&&(typeof row.confidence!=='number'||!Number.isFinite(row.confidence)||row.confidence<0||row.confidence>1))throw invalid();
          insert('temporal_relations',{id:randomUUID(),vault_id:vault,date_id:dateId,entity_id:ref(entityIds,row.entity_id),mention_id:mentionId,kind:String(row.kind),origin:String(row.origin),status:String(row.status),confidence:row.confidence as number|null,source_mention_id:sourceMentionId,property_id:propertyId,property_hash:propertyHash});
        }
        for(const row of rows.entity_overviews) {
          const entityId=ref(entityIds,row.entity_id);
          if(this.store.get<{type:string}>('SELECT type FROM entities WHERE id=?',entityId)?.type==='source')throw invalid();
          insert('entity_overviews',{entity_id:entityId,content:string(row,'content',100000),revision:integer(row,'revision',1)});
        }
        for(const row of rows.entity_page_associations) {
          const entityId=ref(entityIds,row.entity_id);
          if(this.store.get<{type:string}>('SELECT type FROM entities WHERE id=?',entityId)?.type==='source')throw invalid();
          insert('entity_page_associations',{entity_id:entityId,page_id:ref(pageIds,row.page_id),pinned:integer(row,'pinned',0,1),annotation:string(row,'annotation',2000),created_at:timestamp(row,'created_at')});
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
        for(const row of rows.source_reading_locations) {
          const fileId=ref(restoredSourceFiles,row.file_id),anchor=object(json(row,'anchor_json'));
          if(anchor.fileId!==row.file_id||typeof anchor.revision!=='string'||!/^[a-f0-9]{64}$/.test(anchor.revision)||typeof anchor.atEnd!=='boolean')throw invalid();
          integer(anchor,'offset');string(anchor,'quote',160);string(anchor,'prefix',64);string(anchor,'suffix',64);
          if(anchor.nodeId!==undefined&&typeof anchor.nodeId!=='string')throw invalid();
          if(anchor.physicalPage!==undefined)integer(anchor,'physicalPage',1);
          const id=string(row,'id',36);if(id!=='resume'&&!/^[a-f0-9-]{36}$/i.test(id))throw invalid();
          insert('source_reading_locations',{vault_id:vault,file_id:fileId,id:id==='resume'?id:randomUUID(),label:text(row.label,80),anchor_json:JSON.stringify({...anchor,fileId})});
        }
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
        // Derived caches rebuild locally; authoritative definitions and explicit decisions survive.
        const orphanReferences=new Map<string,string>();
        const stableRef=(map:Map<string,string>,id:string)=>{const existing=map.get(id);if(existing)return existing;let orphan=orphanReferences.get(id);if(!orphan){orphan=randomUUID();orphanReferences.set(id,orphan);}return orphan;};
        for(const row of rows.smart_collection_definitions) {
          if(row.matching!==undefined&&!['rules','semantic','hybrid','examples'].includes(String(row.matching)))throw invalid();
          const remap=(node:SmartRuleNode):SmartRuleNode=> 'op' in node?{...node,children:node.children.map(remap)}:node.field==='folder'?{...node,value:stableRef(folderIds,node.value)}:node.field==='entity'?{...node,value:stableRef(entityIds,node.value)}:node;
          if(row.matching==='examples') {
            let examples;try{examples=parseExampleCollection(json(row,'examples_json'));}catch{throw invalid();}
            examples={...examples,positivePageIds:examples.positivePageIds.map(id=>stableRef(pageIds,id)),negativePageIds:examples.negativePageIds.map(id=>stableRef(pageIds,id))};
            insert('smart_collection_definitions',{vault_id:vault,collection_id:ref(collectionIds,row.collection_id),rule_json:'{}',matching:'examples',examples_json:JSON.stringify(examples)});continue;
          }
          if(row.matching==='semantic'||row.matching==='hybrid') {
            let definition;try{definition=parseSemanticCollection(json(row,'semantic_json'));}catch{throw invalid();}
            const model=string(row,'query_model',200),dimensions=integer(row,'query_dimensions',1,4096),vector=json(row,'query_vector');
            if(!model||!Array.isArray(vector)||vector.length!==dimensions||vector.some(value=>typeof value!=='number'||!Number.isFinite(value))||!Number.isFinite(Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0)))||!Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0)))throw invalid();
            let ruleJson='{}';if(row.matching==='hybrid'){try{ruleJson=JSON.stringify({...parseSmartRule(json(row,'rule_json')),root:remap(parseSmartRule(json(row,'rule_json')).root)});}catch{throw invalid();}}
            insert('smart_collection_definitions',{vault_id:vault,collection_id:ref(collectionIds,row.collection_id),rule_json:ruleJson,matching:String(row.matching),semantic_json:JSON.stringify(definition),query_vector:JSON.stringify(vector),query_model:model,query_dimensions:dimensions});
            continue;
          }
          let definition;try{definition=parseSmartRule(json(row,'rule_json'));}catch{throw invalid();}
          insert('smart_collection_definitions',{vault_id:vault,collection_id:ref(collectionIds,row.collection_id),rule_json:JSON.stringify({...definition,root:remap(definition.root)})});
        }
        for(const row of rows.smart_collection_overrides) {
          const collection=ref(collectionIds,row.collection_id);
          if(!this.store.get('SELECT 1 FROM smart_collection_definitions WHERE vault_id=? AND collection_id=?',vault,collection)||!['include','exclude'].includes(String(row.decision)))throw invalid();
          insert('smart_collection_overrides',{vault_id:vault,collection_id:collection,...item(row),decision:row.decision as string});
        }
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
        // Scalar mirrors are derived from exact restored strings and definitions, never trusted as alternate authored values.
        syncPropertyMetadata(this.store,vault);
        const metadataIds=new Set<string>();
        // Restore every explicit binding before validating any mirrors: compatible
        // cardinality groups must not depend on the iteration order of restored rows.
        for(const row of rows.property_value_metadata) {
          const propertyId=ref(propertyIds,row.property_id),definitionId=string(row,'definition_id',2000);
          if(!importedDefinitions.has(definitionId))throw invalid();
          if(this.store.get('SELECT 1 FROM properties WHERE id=?',propertyId))bindPropertyDefinition(this.store,vault,propertyId,definitionId);
        }
        syncPropertyMetadata(this.store,vault);
        const scalarColumns=['compatibility','integer_value','decimal_value','boolean_value','text_value','latitude','longitude','unit'] as const;
        for(const row of rows.property_value_metadata) {
          const propertyId=ref(propertyIds,row.property_id),definitionId=string(row,'definition_id',2000);
          if(metadataIds.has(propertyId)||!importedDefinitions.has(definitionId))throw invalid();
          metadataIds.add(propertyId);
          const current=this.store.get<Row>('SELECT * FROM property_value_metadata WHERE property_id=? AND vault_id=?',propertyId,vault);
          if(!current) {
            // Splitting a legacy multi-file Source intentionally drops other-file derived metadata.
            if(removedManagedProperty(row.property_id,propertyId))continue;
            throw invalid();
          }
          if(current.definition_id!==definitionId)throw invalid();
          for(const column of scalarColumns)if(row[column]!==current[column])throw invalid();
          const target=row.target_id===null?null:ref(entityIds,row.target_id),date=row.temporal_date_id===null?null:dateRef(row.temporal_date_id);
          if(target!==current.target_id||date!==current.temporal_date_id)throw invalid();
          this.store.run('UPDATE property_value_metadata SET position=? WHERE property_id=?',integer(row,'position'),propertyId);
        }
        const proposalIds=new Set<string>(),originalProposalIds=new Set<string>();
        for(const row of rows.property_proposals) {
          const oldId=string(row,'id',64);if(!/^[a-f0-9]{64}$/.test(oldId)||originalProposalIds.has(oldId))throw invalid();originalProposalIds.add(oldId);
          const entity_id=ref(entityIds,row.entity_id),kind=string(row,'kind',20),property_id=row.property_id===null?null:ref(propertyIds,row.property_id),property_name=row.property_name===null?null:string(row,'property_name',200),value=row.value===null?null:string(row,'value'),target_id=row.target_id===null?null:ref(entityIds,row.target_id);
          if(kind!=='property'&&kind!=='entity_name'||kind==='property'&&(!property_name||!property_name.trim())||kind==='entity_name'&&(property_name!==null||target_id!==null)||(value===null)===(target_id===null)||value!==null&&!value.trim()||!propertyOrigins.includes(row.origin as PropertyOrigin))throw invalid();
          if(property_id&&!this.store.get('SELECT 1 FROM properties WHERE id=? AND entity_id=?',property_id,entity_id))throw invalid();
          const source_file_id=sourceRef(row.source_file_id),source_hash=nullableHash(row,'source_hash'),origin=row.origin as PropertyOrigin,status=string(row,'status',20);
          if(!['pending','accepted','rejected'].includes(status))throw invalid();
          const input={entity_id,kind:kind as 'property'|'entity_name',property_id,property_name,value,target_id,source_file_id,source_hash,origin},id=proposalIdentity(vault,input);
          if(proposalIds.has(id))throw invalid();proposalIds.add(id);
          const fields={id,vault_id:vault,...input,details:string(row,'details'),status,created_at:timestamp(row,'created_at'),updated_at:timestamp(row,'updated_at')},columns=Object.keys(fields);
          // A legacy split may have reconstructed the same metadata suggestion.
          // The archived decision is authoritative over that fresh pending record.
          this.store.run(`INSERT INTO property_proposals (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(column=>column!=='id').map(column=>`${column}=excluded.${column}`).join(',')}`,...Object.values(fields));
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
