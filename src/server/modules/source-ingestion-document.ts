import type {SourceFile} from '../../shared/domain.js';
import type {SourceIngestionProvenance} from '../../shared/source-ingestion.js';
import type {Store} from '../store.js';
import {processedSourceDocument} from './source-document.js';
import type {SourceIngestionAssembly} from './source-ingestion-assembly.js';
/** Resolve every original reading from immutable IR; source_documents remains disposable. */
export function resolveSourceDocument(store:Store,file:SourceFile) {
 const document=processedSourceDocument(file);
 const row=store.get<{id:string;content_hash:string;assembly_version:number;assembly_json:string;provenance_json:string}>('SELECT id,content_hash,assembly_version,assembly_json,provenance_json FROM source_ingestion_documents WHERE file_id=? AND vault_id=?',file.id,file.vault_id);
 if(!row)return document;
 const assembly=JSON.parse(row.assembly_json) as SourceIngestionAssembly;
 if(assembly.text!==file.text)throw new Error('Authoritative ingestion text does not match this reading.');
 document.semantic.children=assembly.semanticNodes;
 const immutableIds=new Map(assembly.blockRanges.map(range=>[range.temporaryId,range.id]));
 return Object.assign(document,{ingestion:{documentId:row.id,contentHash:row.content_hash,assemblyVersion:row.assembly_version,relations:assembly.relations,blocks:assembly.document.blocks.map(block=>({...block,immutableId:immutableIds.get(block.id)!})),pages:assembly.document.pages,provenance:JSON.parse(row.provenance_json) as SourceIngestionProvenance}});
}
