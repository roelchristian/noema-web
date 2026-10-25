import type {SourceFile,Block,SourceReference} from '../../shared/domain.js';
import type {SourceDocument,SourceDocumentNode} from '../../shared/source-document.js';
import type {SourceReprocessingRevision} from '../../shared/source-reprocessing.js';
import {sourceDocumentEntries,sourceNodeLabel,sourceNodeLocator} from '../../shared/source-document.js';
import {sourceReadingRevision} from './source-reading-revision.js';
import {mathSource,sourceTextHash} from './source-math-text.js';
import {detectPageFurniture} from './source-reprocessing-furniture.js';
import {SourceDocuments} from './source-documents.js';
import {Store} from '../store.js';

/** Filter presentation furniture without changing the snapshot's evidence ranges. */
function withoutFurniture(input:SourceDocument,text:string,furniture:{startOffset:number;endOffset:number}[]) {
 const merged:{startOffset:number;endOffset:number}[]=[];
 for(const range of furniture.slice().sort((a,b)=>a.startOffset-b.startOffset)){const previous=merged.at(-1);if(previous&&range.startOffset<=previous.endOffset)previous.endOffset=Math.max(previous.endOffset,range.endOffset);else merged.push({...range});}
 furniture=merged;
 const document=structuredClone(input);
 const clean=(nodes:SourceDocumentNode[]):SourceDocumentNode[]=>nodes.flatMap(node=>{
  const overlaps=furniture.filter(range=>range.startOffset<node.range.endOffset&&range.endOffset>node.range.startOffset);
  if(overlaps.length&&node.text!==undefined){
   let body=text.slice(node.range.startOffset,node.range.endOffset);
   for(const range of overlaps.sort((a,b)=>b.startOffset-a.startOffset)){
    const start=Math.max(0,range.startOffset-node.range.startOffset),end=Math.min(body.length,range.endOffset-node.range.startOffset);
    body=body.slice(0,start)+body.slice(end);
   }
   node.text=node.kind==='paragraph'?body.replace(/\s+/g,' ').trim():body.trim();
  }
  if(node.children)node.children=clean(node.children);
  return node.text!==undefined&&!node.text.trim()&&!node.children?.length?[]:[node];
 });
 document.semantic.children=clean(document.semantic.children);return document;
}

/** Select the text snapshot without altering extraction or its citation coordinates. */
export function sourcePageVersion(store:Store,vault:string,file:SourceFile,id:string) {
 const original=mathSource(store,file);
 if(!id){const document=new SourceDocuments(store).get(file);return {file:original,document:withoutFurniture(document,original.text,detectPageFurniture(original.text,document)),canonicalize:(blocks:Block[])=>blocks};}
 const row=store.get<{payload:string}>('SELECT payload FROM source_reprocessing WHERE vault_id=? AND file_id=? AND id=?',vault,file.id,id);
 const revision=row?JSON.parse(row.payload) as SourceReprocessingRevision:undefined;
 // Revisions can originate from either the raw or the prepared math snapshot.
 const base=revision?.original.text===file.text?file:original;
 const view=sourceReadingRevision(store,vault,base,id);
 const furniture=(revision?.furniture??[]).flatMap(item=>{
  const range=view.forward(item);return range?[range]:[];
 });
 const document=withoutFurniture(view.document,view.text,[...detectPageFurniture(view.text,view.document),...furniture]);
 const entries=sourceDocumentEntries(view.document),canonical=sourceDocumentEntries(base===original?new SourceDocuments(store).get(file):revision!.original.document);
 const map=(ref:SourceReference):SourceReference|null=>{
  const entry=entries.find(entry=>entry.node.id===ref.nodeId);
  if(!entry)return null;
  const range=view.reverse({startOffset:ref.startOffset!,endOffset:ref.endOffset!});
  if(!range)return null;
  const target=canonical.filter(({node})=>node.range.startOffset<=range.startOffset&&node.range.endOffset>=range.endOffset).at(-1);
  const excerpt=base.text.slice(range.startOffset,range.endOffset);
  return {...ref,...range,sourceHash:sourceTextHash(base.text),excerpt,startLine:base.text.slice(0,range.startOffset).split('\n').length,endLine:base.text.slice(0,range.endOffset).split('\n').length,
   nodeId:target?.node.id,appLocator:target?sourceNodeLocator(target.path):undefined,contextLabel:target?sourceNodeLabel(target.path):undefined,
   startPage:target?.node.range.startPage??undefined,endPage:target?.node.range.endPage??undefined};
 };
 const canonicalize=(blocks:Block[])=>blocks.map(block=>({...block,content:block.content.map(segment=>{
  if(!segment.sourceReference)return segment;
  const reference=map(segment.sourceReference);return reference?{...segment,sourceReference:reference}:{text:' [??]'};
 })}));
 return {file:{...base,text:view.text},document,canonicalize};
}
