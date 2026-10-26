import {createHash} from 'node:crypto';
import type {SourceDocumentNode,SourceDocumentRange} from '../../shared/source-document.js';
import {sourceDocumentEntries} from '../../shared/source-document.js';
import type {SourceReprocessingRevision} from '../../shared/source-reprocessing.js';
import {sourceIngestionPageRecoveryContent,validateSourceIngestionPageRecoveryDescriptor} from './source-ingestion-page-recovery.js';

/** Preserve rich extraction facts and map only boundaries proved by the exact edits.
 * A patch crossing a node boundary invalidates that node's reading anchor. */
export function mapSourceIngestionRevision(revision:SourceReprocessingRevision,text:string) {
 const original=revision.original.document,document=structuredClone(original);
 const patches=revision.patches.filter(patch=>patch.decision==='accepted').sort((a,b)=>a.range.startOffset-b.range.startOffset);
 const deltas=[0];for(const patch of patches)deltas.push(deltas.at(-1)!+(patch.userReplacement??patch.replacement).length-patch.original.length);
 const firstEndingAfter=(offset:number)=>{let low=0,high=patches.length;while(low<high){const middle=(low+high)>>>1;if(patches[middle]!.range.endOffset<=offset)low=middle+1;else high=middle;}return low;};
 const map=(offset:number):number|null=>{
  const index=firstEndingAfter(offset),patch=patches[index];
  return patch&&offset>patch.range.startOffset?null:offset+deltas[index]!;
 };
 const lineStarts=[0];for(let index=0;index<text.length;index++)if(text[index]==='\r'){if(text[index+1]==='\n')index++;lineStarts.push(index+1);}else if(text[index]==='\n')lineStarts.push(index+1);
 const line=(offset:number)=>{let low=0,high=lineStarts.length;while(low<high){const middle=(low+high)>>>1;if(lineStarts[middle]!<=offset)low=middle+1;else high=middle;}return Math.max(1,low);};
 const ranges=(range:SourceDocumentRange):SourceDocumentRange|null=>{
  const start=map(range.startOffset),end=map(range.endOffset);
  return start===null||end===null?null:{...range,startOffset:start,endOffset:end,startLine:line(start),endLine:line(Math.max(start,end-1))};
 };
 const mappings=new Map<string,string|null>();
 function nodes(values:SourceDocumentNode[]):SourceDocumentNode[] {
  return values.flatMap(originalNode=>{
   const node=structuredClone(originalNode),range=ranges(node.range),children=node.children?nodes(node.children):undefined;
   if(!range){mappings.set(node.id,null);return children??[];}
   const overlapping=patches[firstEndingAfter(node.range.startOffset)],touched=Boolean(overlapping&&overlapping.range.startOffset<node.range.endOffset);
   if(touched){node.id='editorial-'+createHash('sha256').update(`${revision.id}:${originalNode.id}:${range.startOffset}:${range.endOffset}`).digest('hex').slice(0,24);if(node.ingestion)node.ingestion={...node.ingestion,table:null,uncertainty:[node.ingestion.uncertainty,'Reading text changed; original table-cell and uncertainty mappings are not asserted for this version.'].filter(Boolean).join(' ')};}
   mappings.set(originalNode.id,node.id);node.range=range;
   if(node.text!==undefined)node.text=text.slice(range.startOffset,range.endOffset);
   if(children)node.children=children;
   return [node];
  });
 }
 document.semantic.children=nodes(original.semantic.children);
 document.physical.pages=original.physical.pages.map(page=>{
  const range=ranges(page.range);
  if(!range)throw new Error('Ingestion correction crossed a physical page boundary.');
  return {...page,range};
 });
 if(document.ingestion)document.ingestion.readingMapping={nodes:[...mappings].map(([originalId,readingId])=>({originalId,readingId})),relations:document.ingestion.relations.map(relation=>({...relation,from:mappings.get(relation.from)??null,to:mappings.get(relation.to)??null}))};
 const recovery=revision.origin?.pageRecovery;
 if(recovery){
  validateSourceIngestionPageRecoveryDescriptor(recovery,revision.original);
  const patch=patches.find(value=>value.id===recovery.patchId);
  if(patch){
   const recovered=sourceIngestionPageRecoveryContent(recovery.document,recovery.page,original.physical.pageCount!),base=map(recovery.insertion.startOffset)!;
   const actual=patch.userReplacement??patch.replacement,ids=new Map<string,string>();
   const content=actual===recovered.replacement?recovered.offsets:[{block:{id:'manual',text:actual.trim(),kind:'paragraph' as const,headingLevel:null,table:null,location:null,uncertainty:'User-edited recovery; provider table and relation mappings are unavailable.',continues:null},start:actual.indexOf(actual.trim()),end:actual.indexOf(actual.trim())+actual.trim().length}];
   const added=content.filter(value=>value.block.text.trim()).map((value,index):SourceDocumentNode=>{
    const id=`recovery-${recovery.extractionId}-${index+1}`,start=base+value.start,end=base+value.end,block=value.block;
    ids.set(block.id,id);
    const kind=block.kind==='figure'||block.kind==='caption'||block.kind==='furniture'||block.kind==='bibliography'?'paragraph':block.kind;
    return {id,appNumber:`R${recovery.page}.${index+1}`,kind,text:text.slice(start,end),range:{startOffset:start,endOffset:end,startLine:line(start),endLine:line(Math.max(start,end-1)),startPage:recovery.page,endPage:recovery.page},...(block.headingLevel!==null?{level:block.headingLevel,title:block.text}:{}),ingestion:{kind:block.kind,table:block.table,location:block.location,uncertainty:block.uncertainty,furniture:block.kind==='furniture',continues:block.continues}};
   });
   for(const node of added)if(node.ingestion?.continues)node.ingestion.continues=ids.get(node.ingestion.continues)??null;
   document.semantic.children.push(...added);document.semantic.children.sort((a,b)=>a.range.startOffset-b.range.startOffset);
   if(document.ingestion?.readingMapping){
    document.ingestion.readingMapping.recoveredNodes=added.map(node=>({readingId:node.id,originalId:null,page:recovery.page}));
    if(actual===recovered.replacement)document.ingestion.readingMapping.relations.push(...recovered.document.relations.map(relation=>({...relation,from:ids.get(relation.from)??null,to:ids.get(relation.to)??null})));
   }
  }
 }
 revision.nodeLinks=sourceDocumentEntries(original).map(({node})=>({originalNodeId:node.id,reprocessedNodeIds:mappings.get(node.id)?[mappings.get(node.id)!]:[]}));
 revision.reprocessed={text,document};
}
