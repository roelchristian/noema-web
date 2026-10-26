import {createHash} from 'node:crypto';
import type {SourceStructureNode,SourceStructureKind} from '../../shared/domain.js';
import {SOURCE_INGESTION_ASSEMBLY_VERSION,type SourceIngestionDocument} from '../../shared/source-ingestion.js';
import type {SourceDocumentNode,SourceDocumentRange} from '../../shared/source-document.js';
import {validateSourceIngestionDocument} from './source-ingestion-validation.js';
export interface SourceIngestionAssembledBlock {id:string;temporaryId:string;page:number;range:SourceDocumentRange;kind:SourceIngestionDocument['blocks'][number]['kind'];text:string}
export interface SourceIngestionAssembly {
 text:string;pageStartLines:number[];structuralNodes:SourceStructureNode[];blockRanges:SourceIngestionAssembledBlock[];
 repairs:{blockId:string;startOffset:number;endOffset:number;startLine:number;endLine:number;original:string;replacement:string;category:string;reason:string}[];
 semanticNodes:SourceDocumentNode[];relations:{kind:string;from:string;to:string;uncertain:boolean}[];
 document:SourceIngestionDocument;contentHash:string;assemblyVersion:number;
}
/** Physical order and separators are local facts, never model-supplied citation coordinates. */
export function assembleSourceIngestionDocument(input:SourceIngestionDocument,options:{extractionId:string}):SourceIngestionAssembly {
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(options.extractionId))throw new Error('Invalid extraction identity');
 const owned=input.pages.filter(p=>p.role==='owned').map(p=>p.number).sort((a,b)=>a-b);
 if(owned.some((p,i)=>p!==i+1))throw new Error('Assembly requires every physical page, in original page order');
 const document=validateSourceIngestionDocument(input,{ownedPages:owned,pageCount:owned.length});
 const byPage=new Map<number,SourceIngestionDocument['blocks']>();
 for(const block of document.blocks){const list=byPage.get(block.page)??[];list.push(block);byPage.set(block.page,list);}
 const originalBlocks=new Map(document.blocks.map(block=>[block.id,block]));
 const chunks:string[]=[],pageStartLines:number[]=[],blockRanges:SourceIngestionAssembledBlock[]=[],structuralNodes:SourceStructureNode[]=[];
 let offset=0,line=1;
 const append=(value:string)=>{chunks.push(value);offset+=value.length;line+=(value.match(/\n/g)?.length??0);};
 for(const page of [...document.pages].filter(p=>p.role==='owned').sort((a,b)=>a.number-b.number)){
  if(chunks.length)append('\n');pageStartLines.push(line);append(`<!-- Page ${page.number} -->\n`);
  for(const block of (byPage.get(page.number)??[]).sort((a,b)=>a.order-b.order)){
   const startOffset=offset,startLine=line;
   append(block.text);
   const range:SourceDocumentRange={startOffset,endOffset:offset,startLine,endLine:block.text.endsWith('\n')?line-1:line,startPage:page.number,endPage:page.number};
   const id=`ingestion-${options.extractionId}-${blockRanges.length+1}`;
   blockRanges.push({id,temporaryId:block.id,page:page.number,range,kind:block.kind,text:block.text});
   if(['heading','theorem','lemma','proposition','corollary','definition','proof','example','remark'].includes(block.kind))structuralNodes.push({text:block.text,startLine,endLine:range.endLine,kind:block.kind as SourceStructureKind,...(block.headingLevel!==null?{level:block.headingLevel}:{})});
   append('\n\n');
  }
 }
 const text=chunks.join('');
 if(!blockRanges.some(b=>b.text.trim()))throw new Error('No readable transcription; page markers are not source prose');
 const ids=new Map(blockRanges.map(b=>[b.temporaryId,b.id])),rangeById=new Map(blockRanges.map(b=>[b.temporaryId,b.range]));
 const repairs=document.repairs.map(repair=>{const range=rangeById.get(repair.blockId)!,block=originalBlocks.get(repair.blockId)!;return {...repair,blockId:ids.get(repair.blockId)!,startOffset:range.startOffset+repair.start,endOffset:range.startOffset+repair.end,startLine:range.startLine+(block.text.slice(0,repair.start).match(/\n/g)?.length??0),endLine:range.startLine+(block.text.slice(0,Math.max(repair.start,repair.end-1)).match(/\n/g)?.length??0)};});
 const semanticNodes:SourceDocumentNode[]=blockRanges.map(block=>{
  const original=originalBlocks.get(block.temporaryId)!;
  const kind:SourceDocumentNode['kind']=block.kind==='figure'||block.kind==='caption'||block.kind==='furniture'||block.kind==='bibliography'?'paragraph':block.kind;
  return {id:block.id,kind,range:block.range,text:block.text,ingestion:{kind:original.kind,table:original.table,location:original.location,uncertainty:original.uncertainty,furniture:original.kind==='furniture',continues:original.continues===null?null:ids.get(original.continues)!},...(original.headingLevel!==null?{level:original.headingLevel,title:block.text}:{})};
 });
 return {text,pageStartLines,structuralNodes,blockRanges,repairs,semanticNodes,relations:document.relations.map(r=>({...r,from:ids.get(r.from)!,to:ids.get(r.to)!})),document,contentHash:createHash('sha256').update(JSON.stringify({assemblyVersion:SOURCE_INGESTION_ASSEMBLY_VERSION,extractionId:options.extractionId,document,text})).digest('hex'),assemblyVersion:SOURCE_INGESTION_ASSEMBLY_VERSION};
}
/** Merge window-local temporary IDs without confusing repeated text or contextual pages. */
export function mergeSourceIngestionWindows(windows:{index:number;document:SourceIngestionDocument}[],pageCount:number):SourceIngestionDocument {
 const seen=new Set<number>(),pages:SourceIngestionDocument['pages']=[],blocks:SourceIngestionDocument['blocks']=[],relations:SourceIngestionDocument['relations']=[],repairs:SourceIngestionDocument['repairs']=[];
 let metadata:SourceIngestionDocument['metadata']={title:null,language:null,synopsis:null,contributors:[],bibliographic:[]};
 const indices=new Set<number>();
 for(const window of [...windows].sort((a,b)=>a.index-b.index)){
  if(!Number.isSafeInteger(window.index)||window.index<0||indices.has(window.index))throw new Error('Duplicate or invalid window index');indices.add(window.index);
  const owned=window.document.pages.filter(p=>p.role==='owned').map(p=>p.number);
  const doc=validateSourceIngestionDocument(window.document,{ownedPages:owned,pageCount});
  for(const page of doc.pages.filter(p=>p.role==='owned')){if(seen.has(page.number))throw new Error('Overlapping owned page windows');seen.add(page.number);pages.push({...page,unresolved:page.unresolved.map(r=>({...r,blockId:r.blockId===null?null:`w${window.index}:${r.blockId}`}))});}
  const id=(value:string)=>`w${window.index}:${value}`;
  blocks.push(...doc.blocks.map(b=>({...b,id:id(b.id),continues:b.continues===null?null:id(b.continues)})));
  relations.push(...doc.relations.map(r=>({...r,from:id(r.from),to:id(r.to)})));
  repairs.push(...doc.repairs.map(r=>({...r,blockId:id(r.blockId)})));
  metadata={title:metadata.title??doc.metadata.title,language:metadata.language??doc.metadata.language,synopsis:metadata.synopsis??doc.metadata.synopsis,contributors:[...metadata.contributors,...doc.metadata.contributors.map(c=>({...c,blockId:c.blockId===null?null:id(c.blockId)}))],bibliographic:[...metadata.bibliographic,...doc.metadata.bibliographic.map(c=>({...c,blockId:c.blockId===null?null:id(c.blockId)}))]};
 }
 if(seen.size!==pageCount)throw new Error('Missing required page window');
 return validateSourceIngestionDocument({schemaVersion:1,metadata,pages,blocks,relations,repairs},{ownedPages:Array.from({length:pageCount},(_,i)=>i+1),pageCount});
}
