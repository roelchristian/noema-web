import {normalizeSourceIngestionCandidate} from './source-ingestion-validation.js';
import {numberSourceNodes} from '../../shared/source-document.js';
import type {SourceFile} from '../../shared/domain.js';
import type {SourceIngestionProvenance} from '../../shared/source-ingestion.js';
import type {Store} from '../store.js';
import {processedSourceDocument} from './source-document.js';
import {assembleSourceIngestionDocument,mergeSourceIngestionWindows,sourceIngestionSemanticTree,type SourceIngestionAssembly} from './source-ingestion-assembly.js';
/** Enrichment is a derived annotation layer. Original IR and citation leaves
 * remain authoritative; partial or text-changing overlays never replace them. */
export function resolveSourceIngestionAssembly(store:Store,file:SourceFile):SourceIngestionAssembly|null {
 const original=store.get<{id:string;assembly_json:string}>('SELECT id,assembly_json FROM source_ingestion_documents WHERE file_id=? AND vault_id=?',file.id,file.vault_id);if(!original)return null;
 const baseline=JSON.parse(original.assembly_json) as SourceIngestionAssembly;
 const windows=store.all<{kind:string;ordinal:number;plan_json:string;result_json:string|null}>("SELECT w.kind,w.ordinal,w.plan_json,w.result_json FROM source_ingestion_windows w JOIN source_ingestion_runs r ON r.id=w.run_id WHERE r.file_id=? AND r.vault_id=? AND r.published_document_id=? AND w.state='completed' AND w.kind IN ('extraction','enrichment') ORDER BY w.ordinal DESC",file.id,file.vault_id,original.id);
 const extraction=windows.filter(window=>window.kind==='extraction').sort((a,b)=>a.ordinal-b.ordinal),enrichment=windows.filter(window=>window.kind==='enrichment');
 if(!extraction.length||!enrichment.length)return baseline;
 const scope=(value:string)=>JSON.stringify((JSON.parse(value) as {ownedPages:number[]}).ownedPages.slice().sort((a,b)=>a-b));
 try{
  const scopes=extraction.map(window=>({window,enriched:enrichment.find(candidate=>scope(candidate.plan_json)===scope(window.plan_json))}));
  if(scopes.some(item=>!item.enriched?.result_json))return baseline;
  const merged=mergeSourceIngestionWindows(scopes.map(({window,enriched},index)=>{
   // Durable window ordinals can be sparse after truncation. Reuse the actual
   // namespace of the baseline leaf, rather than inventing new citation IDs.
   const pages=new Set((JSON.parse(window.plan_json) as {ownedPages:number[]}).ownedPages);
   const prefix=baseline.blockRanges.find(block=>pages.has(block.page))?.temporaryId.match(/^w(\d+):/);
   return {index:prefix?Number(prefix[1]):index,document:JSON.parse(enriched!.result_json!)};
  }),baseline.document.pages.filter(page=>page.role==='owned').length);
  const ids=new Set(merged.blocks.map(block=>block.id));
  for(const relation of baseline.document.relations){
   const crossWindow=relation.from.match(/^w\d+:/)?.[0]!==relation.to.match(/^w\d+:/)?.[0];
   if(crossWindow&&ids.has(relation.from)&&ids.has(relation.to)&&!merged.relations.some(candidate=>candidate.kind===relation.kind&&(candidate.from===relation.from||candidate.to===relation.to)))merged.relations.push(structuredClone(relation));
  }
  const annotated=assembleSourceIngestionDocument(normalizeSourceIngestionCandidate(merged),{extractionId:original.id});
  const coordinates=(assembly:SourceIngestionAssembly)=>assembly.blockRanges.map(block=>({id:block.id,temporaryId:block.temporaryId,page:block.page,range:block.range,text:block.text}));
  if(annotated.text!==baseline.text||JSON.stringify(coordinates(annotated))!==JSON.stringify(coordinates(baseline)))return baseline;
  return annotated;
 }catch{return baseline;}
}

/** Resolve every original reading from immutable IR; source_documents remains disposable. */
export function resolveSourceDocument(store:Store,file:SourceFile) {
 const document=processedSourceDocument(file);
 const row=store.get<{id:string;content_hash:string;assembly_version:number;assembly_json:string;provenance_json:string}>('SELECT id,content_hash,assembly_version,assembly_json,provenance_json FROM source_ingestion_documents WHERE file_id=? AND vault_id=?',file.id,file.vault_id);
 if(!row)return document;
 const assembly=resolveSourceIngestionAssembly(store,file)!;
 if(assembly.text!==file.text)throw new Error('Authoritative ingestion text does not match this reading.');
 document.semantic.children=numberSourceNodes(sourceIngestionSemanticTree(assembly.semanticNodes,assembly.relations));
 const immutableIds=new Map(assembly.blockRanges.map(range=>[range.temporaryId,range.id]));
 return Object.assign(document,{ingestion:{documentId:row.id,contentHash:assembly.contentHash,assemblyVersion:row.assembly_version,relations:assembly.relations,blocks:assembly.document.blocks.map(block=>({...block,immutableId:immutableIds.get(block.id)!})),pages:assembly.document.pages,provenance:JSON.parse(row.provenance_json) as SourceIngestionProvenance}});
}
