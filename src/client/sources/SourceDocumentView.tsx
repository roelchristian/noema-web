import {Fragment,useMemo,type RefObject,type ReactNode} from 'react';
import type {SourceHighlight} from '../../shared/source-reading';
import {sourceDocumentEntries,sourceNodeLocator,type SourceDocument} from '../../shared/source-document';
import {SourceFootnoteDefinitions,SourceReaderInline,sourceReaderBlocks} from './SourceReaderText';
import {t as uiText} from '../i18n';

export type SourceViewEntry=ReturnType<typeof sourceDocumentEntries>[number];
export type ReaderAnnotations='clean'|'contextual'|'always';
export function passageAnchor(fileId:string,nodeId:string){return `source-passage-${encodeURIComponent(fileId)}-${encodeURIComponent(nodeId)}`;}
/** Older CRLF revisions used normalized coordinates without a schema marker.
 * Accept raw coordinates only when every displayed node proves its exact slice. */
export function editorialSnapshotHasRawRanges(text:string,document:SourceDocument){
 if(!text.includes('\r'))return true;
 const nodes=sourceDocumentEntries(document).filter(({node})=>node.text!==undefined||node.title).map(({node})=>node);
 if(!nodes.some(node=>node.text!==undefined))return false;
 return nodes.every(node=>{
  const {startOffset:start,endOffset:end}=node.range;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>text.length)return false;
  if(node.text!==undefined)return node.text===text.slice(start,end);
  return !!node.title&&text.slice(start,end).split('\n')[0].includes(node.title);
 });
}
/** Presentation offsets always refer to this exact text, including CRLF originals. */
export function sourceViewEntries(text:string,document?:SourceDocument,rawRanges=false):SourceViewEntry[]{
 if(!document)return [];
 const offsets:number[]=[];
 if(!rawRanges&&text.includes('\r'))for(let index=0;index<text.length;index++){offsets.push(index);if(text[index]==='\r'&&text[index+1]==='\n')index++;}
 const offset=(value:number)=>offsets.length?(offsets[value]??text.length):value;
 return sourceDocumentEntries(document).filter(({node})=>node.text!==undefined||node.title).map(entry=>{
  const start=offset(entry.node.range.startOffset),end=offset(entry.node.range.endOffset);
  const titleAt=entry.node.title?text.indexOf(entry.node.title,start):-1;
  const firstLineEnd=Math.min(end,text.indexOf('\n',start)<0?text.length:text.indexOf('\n',start));
  const exactTitle=titleAt>=start&&titleAt<firstLineEnd;
  const rawHeading=text.slice(start,firstLineEnd).trimEnd(),prefix=rawHeading.match(/^\s*#{1,6}\s+/)?.[0].length??0;
  return {...entry,node:{...entry.node,range:{...entry.node.range,startOffset:entry.node.text!==undefined?start:exactTitle?titleAt:start+prefix,endOffset:end},...(entry.node.text!==undefined?{text:text.slice(start,end)}:{title:exactTitle?entry.node.title:rawHeading.slice(prefix)})}};
 });
}
interface Props {
 article:RefObject<HTMLElement|null>;fileId:string;name:string;text:string;entries:SourceViewEntry[];
 furnitureKind?:(nodeId:string)=>'header'|'footer'|undefined;hiddenNodeIds?:ReadonlySet<string>;endnotes?:boolean;selected:string|null;annotations:ReaderAnnotations;structureLabels:boolean;highlights?:SourceHighlight[];
 canonicalNode:(nodeId:string)=>string|undefined;onSelect:(canonicalNodeId:string)=>void;
 changeForNode?:(nodeId:string)=>{id:string;label:string;count?:number;quiet?:boolean;patchIds?:string[]}|undefined;onReview?:(patchId:string,patchIds?:string[])=>void;children?:ReactNode;
}
/** One typography and heading hierarchy for canonical and editorial presentations. */
export function SourceDocumentView({article,fileId,name,text,entries,selected,annotations,structureLabels,hiddenNodeIds,furnitureKind,endnotes=false,highlights=[],canonicalNode,onSelect,changeForNode,onReview,children}:Props){
 const definitions=useMemo(()=>new Set([...text.matchAll(/^[ \t]*\[\^([^\]\n]+)\]:/gm)].map(match=>match[1]!)),[text]);
 const content=useMemo(()=>entries.map(entry=>({entry,blocks:entry.node.text===undefined?null:sourceReaderBlocks({text:entry.node.text,kind:entry.node.kind,footnotePrefix:fileId,startOffset:entry.node.range.startOffset,highlights})})),[entries,fileId,highlights]);
 const fallback=useMemo(()=>entries.length?null:sourceReaderBlocks({text,footnotePrefix:fileId,highlights}),[entries.length,text,fileId,highlights]);
 const noteEntries=endnotes?content.filter(item=>item.blocks?.notes.length):[];
 const renderPassage=({entry:{node,path},blocks}:typeof content[number],notesOnly=false)=>{
   const Heading=(node.kind==='chapter'||node.level===1?'h2':node.kind==='subsection'||(node.level??0)>2?'h4':'h3');
   const locator=sourceNodeLocator(path)??`L${node.range.startLine}–${node.range.endLine}`;
   const canonicalId=canonicalNode(node.id),change=changeForNode?.(node.id),furniture=furnitureKind?.(node.id);
   const onlyNotes=!!blocks?.notes.length&&!blocks.body.length;
   const readingBlocks=endnotes?(notesOnly?blocks?.notes:blocks?.body):blocks?.inline;
   return <section hidden={hiddenNodeIds?.has(node.id)} key={node.id} id={notesOnly&&!onlyNotes?undefined:passageAnchor(fileId,node.id)} className={'source-reader-passage'+(onlyNotes||notesOnly?' is-footnote':'')+(node.text===undefined?' is-heading':'')+(canonicalId===selected?' is-selected':'')} data-page-furniture={furniture} data-source-node={notesOnly&&!onlyNotes?undefined:node.id} data-canonical-node={notesOnly&&!onlyNotes?undefined:canonicalId} data-source-page={node.range.startPage}>
    <button type="button" className="source-reader-node-address" title={canonicalId?uiText('Select original passage ')+locator:uiText('Citation mapping unavailable; switch to Original processed')} aria-label={canonicalId?uiText('Select passage ')+locator:uiText('Citation mapping unavailable; switch to Original processed')} aria-pressed={!!canonicalId&&canonicalId===selected} onClick={()=>{if(canonicalId)onSelect(canonicalId);}} aria-disabled={!canonicalId}>{locator}</button>
    {furniture&&<small className="source-reader-furniture-label">{uiText(furniture==='header'?"Page header":"Page footer")}</small>}
    {structureLabels&&<small className="source-reader-structure-label">{node.kind} · {locator}</small>}
    {change&&<button type="button" className={"source-reader-change-indicator"+(change.quiet?" is-quiet":"")} aria-label={change.label} onClick={()=>onReview?.(change.id,change.patchIds)}><span aria-hidden="true">{change.count&&change.count>1?change.count:"│"}</span></button>}
    {node.text===undefined?<Heading><SourceReaderInline text={node.title??''} footnotePrefix={fileId} startOffset={node.range.startOffset} highlights={highlights}/></Heading>:<>{node.kind==='code'?readingBlocks:<div className="source-reader-text">{readingBlocks}</div>}</>}
   </section>;
 };
 let previousPage:number|null=null;
 return <SourceFootnoteDefinitions value={definitions}><article ref={article} className="source-reader-document" data-annotations={annotations} aria-label={name}>
  {entries.length?content.map(item=>{
   const {node}=item.entry,page=node.range.startPage;
   const pageBreak=page!==null&&previousPage!==null&&page>previousPage;
   if(page!==null)previousPage=page;
   return <Fragment key={node.id}>
    {pageBreak&&<div className="source-reader-page-break" role="separator" aria-label={uiText('Page {value0}',{value0:page!})}><span aria-hidden="true">{uiText('Page {value0}',{value0:page!})}</span></div>}
    {!(endnotes&&item.blocks?.notes.length&&!item.blocks.body.length)&&renderPassage(item)}
   </Fragment>;
  }):text.trim()?<div className="source-reader-text">{endnotes?fallback?.body:fallback?.inline}</div>:<p className="source-reader-status">{uiText('No readable text was extracted from this attachment.')}</p>}
  {endnotes&&(noteEntries.length>0||!!fallback?.notes.length)&&<section className="source-reader-endnotes" aria-label={uiText('Endnotes')}><h2>{uiText('Endnotes')}</h2>{noteEntries.map(item=>renderPassage(item,true))}{fallback&&<div className="source-reader-text">{fallback.notes}</div>}</section>}
  {children}
 </article></SourceFootnoteDefinitions>;
}
