import {mathSource,mathMetadata} from './source-math-text.js';
import {createHash} from 'node:crypto';
import type {SourceFile} from '../../shared/domain.js';
import type {SourceDocument,SourceDocumentNode} from '../../shared/source-document.js';
import {Store} from '../store.js';
import {HttpError,now} from '../validation.js';
import {resolveSourceDocument} from './source-ingestion-document.js';

// Bump when semantic parsing changes, independently of the exported JSON schema.
export const sourceDocumentBuilderVersion=6;
export class SourceDocuments {
 constructor(private store:Store) {}
 get(file:SourceFile):SourceDocument {return this.materialize(file).document;}
 private materialize(file:SourceFile) {
  file=mathSource(this.store,file);
  if(!this.store.get('SELECT 1 FROM vaults WHERE id=? AND locked=0',file.vault_id))throw new HttpError(423,'Unlock this vault to process its sources.');
  if(file.status!=='ready'||file.admitted!==1||!file.text.trim())throw new HttpError(409,'Wait for source extraction to complete.');
  const ingestion=this.store.get<{id:string;content_hash:string;assembly_version:number}>('SELECT id,content_hash,assembly_version FROM source_ingestion_documents WHERE file_id=?',file.id);
  const math=mathMetadata(this.store,file.id,file.text);
  const inputHash=createHash('sha256').update(JSON.stringify([
   file.id,file.text,file.structural_nodes,file.page_start_lines,file.pages,file.name,
   file.original_filename,file.generated_name,file.format,file.language,file.source_url,file.enrichment_status,math,ingestion,
  ])).digest('hex');
  const cached=this.store.get<{document_json:string;input_hash:string;builder_version:number}>('SELECT document_json,input_hash,builder_version FROM source_documents WHERE file_id=?',file.id);
  if(cached?.input_hash===inputHash&&cached.builder_version===sourceDocumentBuilderVersion) {
   try {
    const document=JSON.parse(cached.document_json) as SourceDocument;
    if(document.schemaVersion===1&&document.source.fileId===file.id&&Array.isArray(document.semantic.children))return {document,updated:false};
   }catch{/* Rebuild a damaged derived cache from authoritative source text. */}
  }
  const document=resolveSourceDocument(this.store,file);
  if(math)document.processing={...document.processing,text:'LaTeX cleaned extraction',math};
  this.store.run(`INSERT INTO source_documents (file_id,builder_version,input_hash,document_json,updated_at) VALUES (?,?,?,?,?)
   ON CONFLICT(file_id) DO UPDATE SET builder_version=excluded.builder_version,input_hash=excluded.input_hash,document_json=excluded.document_json,updated_at=excluded.updated_at`,file.id,sourceDocumentBuilderVersion,inputHash,JSON.stringify(document),now());
  return {document,updated:true};
 }
 /** An explicit, idempotent migration scoped to one unlocked vault. No AI calls. */
 migrate(vaultId:string) {
  return this.store.transaction(()=>{
   if(!this.store.get('SELECT 1 FROM vaults WHERE id=? AND locked=0',vaultId))throw new HttpError(423,'Unlock the selected vault before migration.');
   const files=this.store.all<SourceFile>('SELECT * FROM source_files WHERE vault_id=? AND entity_id IS NOT NULL ORDER BY created_at,id',vaultId);
   return files.map(file=>{
    if(file.status!=='ready'||file.admitted!==1||!file.text.trim())return {fileId:file.id,name:file.name,status:'skipped' as const,reason:'Source extraction is not ready'};
    const {document,updated}=this.materialize(file);
    let nodes=0;
    const count=(children:SourceDocumentNode[])=>{for(const child of children){nodes++;if(child.children)count(child.children);}};
    count(document.semantic.children);
    return {fileId:file.id,name:file.name,status:updated?'migrated' as const:'current' as const,nodes,physicalPages:document.physical.pages.length};
   });
  });
 }
}
