import type {RefObject,ReactNode} from 'react';
import type {SourceHighlight} from '../../shared/source-reading';
import {sourceDocumentEntries,sourceNodeLocator,type SourceDocument} from '../../shared/source-document';
import {SourceReaderInline,SourceReaderText} from './SourceReaderText';
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
 selected:string|null;annotations:ReaderAnnotations;structureLabels:boolean;highlights?:SourceHighlight[];
 canonicalNode:(nodeId:string)=>string|undefined;onSelect:(canonicalNodeId:string)=>void;
 changeForNode?:(nodeId:string)=>{id:string;label:string}|undefined;onReview?:(patchId:string)=>void;children?:ReactNode;
}
/** One typography and heading hierarchy for canonical and editorial presentations. */
export function SourceDocumentView({article,fileId,name,text,entries,selected,annotations,structureLabels,highlights=[],canonicalNode,onSelect,changeForNode,onReview,children}:Props){
 return <article ref={article} className="source-reader-document" data-annotations={annotations} aria-label={name}>
  {entries.length?entries.map(({node,path})=>{
   const Heading=(node.kind==='chapter'||node.level===1?'h2':node.kind==='subsection'||(node.level??0)>2?'h4':'h3');
   const locator=sourceNodeLocator(path)??`L${node.range.startLine}–${node.range.endLine}`;
   const canonicalId=canonicalNode(node.id),change=changeForNode?.(node.id);
   return <section key={node.id} id={passageAnchor(fileId,node.id)} className={'source-reader-passage'+(node.text===undefined?' is-heading':'')+(canonicalId===selected?' is-selected':'')} data-source-node={node.id} data-canonical-node={canonicalId} data-source-page={node.range.startPage}>
    <button type="button" className="source-reader-node-address" title={canonicalId?uiText('Select original passage ')+locator:uiText('Citation mapping unavailable; switch to Original processed')} aria-label={canonicalId?uiText('Select passage ')+locator:uiText('Citation mapping unavailable; switch to Original processed')} aria-pressed={!!canonicalId&&canonicalId===selected} onClick={()=>{if(canonicalId)onSelect(canonicalId);}} aria-disabled={!canonicalId}>{locator}</button>
    {structureLabels&&<small className="source-reader-structure-label">{node.kind} · {locator}</small>}
    {change&&<button type="button" className="source-reader-change-indicator" aria-label={change.label} onClick={()=>onReview?.(change.id)}>✦</button>}
    {node.text===undefined?<Heading><SourceReaderInline text={node.title??''} footnotePrefix={fileId} startOffset={node.range.startOffset} highlights={highlights}/></Heading>:<SourceReaderText text={node.text} kind={node.kind} footnotePrefix={fileId} startOffset={node.range.startOffset} highlights={highlights}/>}
   </section>;
  }):text.trim()?<SourceReaderText text={text} footnotePrefix={fileId} startOffset={0} highlights={highlights}/>:<p className="source-reader-status">{uiText('No readable text was extracted from this attachment.')}</p>}
  {children}
 </article>;
}
