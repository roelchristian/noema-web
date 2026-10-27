import {Fragment,useMemo,type RefObject,type ReactNode} from 'react';
import type {SourceHighlight} from '../../shared/source-reading';
import {sourceDocumentEntries,sourceNodeLocator,type SourceDocument} from '../../shared/source-document';
import {SourceBibliography,SourceFootnoteDefinitions,SourceInlineFootnoteLinks,SourceFootnote,SourceReaderInline,sourceReaderBlocks} from './SourceReaderText';
import {discoverSourceBibliography} from '../../shared/source-bibliography';
import {t as uiText} from '../i18n';

export type SourceViewEntry=ReturnType<typeof sourceDocumentEntries>[number];
export type ReaderAnnotations='clean'|'contextual'|'always';
export function passageAnchor(fileId:string,nodeId:string){return `source-passage-${encodeURIComponent(fileId)}-${encodeURIComponent(nodeId)}`;}
export function footnoteAnchor(fileId:string,nodeId:string){return passageAnchor(fileId,nodeId)+'-footnote';}
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
 return sourceDocumentEntries(document).filter(({node})=>(node.text!==undefined||node.title)&&!(node.text===undefined&&node.children?.[0]&&node.id===node.children[0].id+'-section')).map(entry=>{
  const start=offset(entry.node.range.startOffset),end=offset(entry.node.range.endOffset);
  const titleAt=entry.node.title?text.indexOf(entry.node.title,start):-1;
  const firstLineEnd=Math.min(end,text.indexOf('\n',start)<0?text.length:text.indexOf('\n',start));
  const exactTitle=titleAt>=start&&titleAt<firstLineEnd;
  const rawHeading=text.slice(start,firstLineEnd).trimEnd(),prefix=rawHeading.match(/^\s*#{1,6}\s+/)?.[0].length??0;
  return {...entry,node:{...entry.node,range:{...entry.node.range,startOffset:entry.node.text!==undefined?start:exactTitle?titleAt:start+prefix,endOffset:end},...(entry.node.text!==undefined?{text:text.slice(start,end)}:{title:exactTitle?entry.node.title:rawHeading.slice(prefix)})}};
 });
}
/** Processing diagnostics belong in the monitor/evidence panel, not in prose. */
export function readerTranscriptionUncertainty(value:string|null|undefined):string|null {
 if(!value)return null;
 const at=value.search(/(?:An inconsistent provider|Provider table (?:layout|coordinates)|Conflicting provider|An out-of-bounds provider|Overlapping provider repair|Provider repair suggestions beyond|An unsupported (?:structural|table) annotation|A structural annotation had|A non-table structural annotation|An inconsistent table annotation|An invalid structural annotation|Reading text changed; original table-cell)/);
 return (at<0?value:value.slice(0,at)).trim()||null;
}

export function sourceFurnitureNodeIds(entries:SourceViewEntry[],classified:Iterable<string>=[]){return new Set([...classified,...entries.filter(({node})=>node.ingestion?.furniture).map(({node})=>node.id)]);}

/** Relation targets are authoritative; printed callout spans must still be
 * uniquely identifiable in the unchanged source text before becoming links. */
function printedFootnotePrefix(text:string){
 const latex=text.match(/^\s*\$\s*\^\s*(?:\{(\d{1,4}|[*†‡])\}|(\d{1,4}|[*†‡]))\s*\$\s*/u);
 if(latex){const label=latex[1]??latex[2]!;return {label,length:latex[0].length,labelSource:{text:latex[0].trim(),start:latex[0].search(/\S/),displayText:label}};}
 const plain=text.match(/^\s*(\d{1,4}|[*†‡])(?:[.)])?\s+/u);
 return plain?{label:plain[1]!,length:plain[0].length,labelSource:{text:plain[1]!,start:plain[0].indexOf(plain[1]!)}}:null;
}
export function sourceRelationFootnotes(entries:SourceViewEntry[],relations:{kind:string;from:string|null;to:string|null;uncertain:boolean}[],fileId:string){
 const nodes=new Map(entries.map(entry=>[entry.node.id,entry.node])),links=new Map<number,{end:number;target:string;label:string}>(),notes=new Map<string,string>();
 const definite=relations.filter(relation=>relation.kind==='footnote-callout'&&!relation.uncertain&&relation.from&&relation.to);
 for(const relation of definite){
  const from=nodes.get(relation.from!),to=nodes.get(relation.to!);if(!from?.text||!to?.text||to.kind!=='footnote')continue;
  const label=printedFootnotePrefix(to.text)?.label;if(!label)continue;
  if(definite.some(other=>other.from===relation.from&&other.to!==relation.to))continue;
  const sourceText=from.text,superscript=/^\d+$/.test(label)?Array.from(label,digit=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)]).join(''):null;
  const raised=superscript?[...sourceText.matchAll(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu)].filter(match=>match[0]===superscript&&/[;:,.!?)[\]]/u.test(sourceText[match.index!-1]??'')):[];
  // A definite relation plus one exact raised label can identify a callout in
  // the middle of a sentence. Keep its original Unicode span and text intact.
  const raisedAt=raised.length===1?raised[0]!.index:undefined;
  const latex=[...sourceText.matchAll(/\$\s*\^\s*(?:\{(\d{1,4}|[*†‡])\}|(\d{1,4}|[*†‡]))\s*\$/gu)].filter(match=>(match[1]??match[2])===label&&/[;:,.!?)[\]]/u.test(sourceText[match.index!-1]??'')&&/^(?:\s|\]|$)/u.test(sourceText.slice(match.index!+match[0].length)));
  const latexMatch=latex.length===1?latex[0]:undefined;
  const matches:number[]=[];let cursor=0;
  while(cursor<from.text.length){const at=from.text.indexOf(label,cursor);if(at<0)break;cursor=at+label.length;
   const before=from.text[at-1]??'',after=from.text[at+label.length]??'';
   if(!/[\p{L}\p{N}]/u.test(before)&&!/[\p{L}\p{N}]/u.test(after))matches.push(at);
  }
  if(!latexMatch&&raisedAt===undefined&&matches.length!==1)continue;const at=latexMatch?.index??raisedAt??matches[0]!,marker=latexMatch?.[0]??(raisedAt===undefined?label:superscript!);
  // A plain prose number is not a footnote location merely because it matches.
  if(!latexMatch&&raisedAt===undefined&&(!/[;:,.!?)[\]]/u.test(from.text[at-1]??'')||!/^(?:\s|\]|$)/u.test(from.text.slice(at+label.length))))continue;
  const start=from.range.startOffset+at,target=footnoteAnchor(fileId,to.id);
  if(links.has(start)&&links.get(start)!.target!==target){links.delete(start);continue;}
  links.set(start,{end:start+marker.length,target,label});notes.set(to.id,label);
 }
 return {links,notes};
}
interface Props {
 ingestionRelations?:{kind:string;from:string|null;to:string|null;uncertain:boolean}[];
 article:RefObject<HTMLElement|null>;coordinateHash?:string;fileId:string;name:string;text:string;entries:SourceViewEntry[];
 furnitureKind?:(nodeId:string)=>'header'|'footer'|undefined;hiddenNodeIds?:ReadonlySet<string>;endnotes?:boolean;selected:string|null;annotations:ReaderAnnotations;structureLabels:boolean;highlights?:SourceHighlight[];
 canonicalNode:(nodeId:string)=>string|undefined;onSelect:(canonicalNodeId:string)=>void;
 changeForNode?:(nodeId:string)=>{id:string;label:string;count?:number;quiet?:boolean;patchIds?:string[]}|undefined;onReview?:(patchId:string,patchIds?:string[])=>void;children?:ReactNode;
}
/** One typography and heading hierarchy for canonical and editorial presentations. */
export function SourceDocumentView({article,coordinateHash,ingestionRelations,fileId,name,text,entries,selected,annotations,structureLabels,hiddenNodeIds,furnitureKind,endnotes=false,highlights=[],canonicalNode,onSelect,changeForNode,onReview,children}:Props){
 const relationFootnotes=useMemo(()=>sourceRelationFootnotes(entries,ingestionRelations??[],fileId),[entries,ingestionRelations,fileId]);
 const bibliography=useMemo(()=>discoverSourceBibliography(text),[text]);
 const definitions=useMemo(()=>new Set([...text.matchAll(/^[ \t]*\[\^([^\]\n]+)\]:/gm)].map(match=>match[1]!)),[text]);
 const content=useMemo(()=>entries.map(entry=>({entry,blocks:entry.node.text===undefined?null:sourceReaderBlocks({text:entry.node.text,kind:entry.node.kind,footnotePrefix:fileId,startOffset:entry.node.range.startOffset,highlights})})),[entries,fileId,highlights]);
 const fallback=useMemo(()=>entries.length?null:sourceReaderBlocks({text,footnotePrefix:fileId,highlights}),[entries.length,text,fileId,highlights]);
 const noteEntries=endnotes?content.filter(item=>item.blocks?.notes.length||relationFootnotes.notes.has(item.entry.node.id)):[];
 const renderPassage=({entry:{node,path},blocks}:typeof content[number],notesOnly=false)=>{
   const Heading=(node.kind==='chapter'||node.level===1?'h2':node.kind==='subsection'||(node.level??0)>2?'h4':'h3');
   const locator=sourceNodeLocator(path)??`L${node.range.startLine}–${node.range.endLine}`;
   const canonicalId=canonicalNode(node.id),change=changeForNode?.(node.id),furniture=furnitureKind?.(node.id);
   const semanticLabel=relationFootnotes.notes.get(node.id),semanticPrefix=semanticLabel&&node.text?printedFootnotePrefix(node.text):null;
   const semanticNote=!!semanticPrefix,onlyNotes=semanticNote||!!blocks?.notes.length&&!blocks.body.length;
   const table=node.ingestion?.table;
   const heading=node.text===undefined||node.ingestion?.kind==='heading',uncertainty=readerTranscriptionUncertainty(node.ingestion?.uncertainty);
   const readingBlocks=endnotes?(notesOnly?(semanticNote?blocks?.inline:blocks?.notes):blocks?.body):blocks?.inline;
   return <section hidden={hiddenNodeIds?.has(node.id)} key={node.id} id={notesOnly&&!onlyNotes?undefined:passageAnchor(fileId,node.id)} className={'source-reader-passage'+(onlyNotes||notesOnly?' is-footnote':'')+(heading?' is-heading':'')+(canonicalId===selected?' is-selected':'')} data-page-furniture={furniture} data-source-node={notesOnly&&!onlyNotes?undefined:node.id} data-canonical-node={notesOnly&&!onlyNotes?undefined:canonicalId} data-source-page={node.range.startPage}>
    <button type="button" className="source-reader-node-address" title={canonicalId?uiText('Select original passage ')+locator:uiText('Citation mapping unavailable; switch to Original processed')} aria-label={canonicalId?uiText('Select passage ')+locator:uiText('Citation mapping unavailable; switch to Original processed')} aria-pressed={!!canonicalId&&canonicalId===selected} onClick={()=>{if(canonicalId)onSelect(canonicalId);}} aria-disabled={!canonicalId}>{locator}</button>
    {furniture&&<small className="source-reader-furniture-label">{uiText(furniture==='header'?"Page header":"Page footer")}</small>}
    {structureLabels&&<small className="source-reader-structure-label">{node.kind} · {locator}</small>}
    {change&&<button type="button" className={"source-reader-change-indicator"+(change.quiet?" is-quiet":"")} aria-label={change.label} onClick={()=>onReview?.(change.id,change.patchIds)}><span aria-hidden="true">{change.count&&change.count>1?change.count:"│"}</span></button>}
    {uncertainty&&<aside className="section-hint" aria-label={uiText('Transcription uncertainty')}>{uncertainty}</aside>}
    {semanticNote?<SourceFootnote label={semanticLabel!} target={footnoteAnchor(fileId,node.id)} text={node.text!.slice(semanticPrefix!.length)} startOffset={node.range.startOffset+semanticPrefix!.length} highlights={highlights} footnotePrefix={fileId} labelSource={{...semanticPrefix!.labelSource,start:node.range.startOffset+semanticPrefix!.labelSource.start}}/>:heading?<Heading><SourceReaderInline text={node.title??node.text??''} footnotePrefix={fileId} startOffset={node.range.startOffset} highlights={highlights}/></Heading>:node.ingestion?.furniture?<details><summary>{uiText('Running page text')}</summary><div className="source-reader-text">{readingBlocks}</div></details>:table?<><table aria-label={uiText('Source table')}><tbody>{Array.from({length:table.rows},(_,row)=><tr key={row}>{table.cells.filter(cell=>cell.row===row).sort((a,b)=>a.column-b.column).map(cell=><td key={cell.column} rowSpan={cell.rowSpan} colSpan={cell.columnSpan}>{cell.text}</td>)}</tr>)}</tbody></table><details><summary>{uiText('Faithful table transcription')}</summary><div className="source-reader-text">{readingBlocks}</div></details></>:<>{node.kind==='code'?readingBlocks:<div className="source-reader-text">{readingBlocks}</div>}</>}

   </section>;
 };
 let previousPage:number|null=null;
 return <SourceInlineFootnoteLinks value={relationFootnotes.links}><SourceBibliography value={bibliography}><SourceFootnoteDefinitions value={definitions}><article ref={article} className="source-reader-document" data-source-coordinate-hash={coordinateHash} data-annotations={annotations} aria-label={name}>
  {entries.length?content.map(item=>{
   const {node}=item.entry,page=node.range.startPage;
   const pageBreak=page!==null&&previousPage!==null&&page>previousPage;
   if(page!==null)previousPage=page;
   return <Fragment key={node.id}>
    {pageBreak&&<div className="source-reader-page-break" role="separator" aria-label={uiText('Page {value0}',{value0:page!})}><span aria-hidden="true">{uiText('Page {value0}',{value0:page!})}</span></div>}
    {!(endnotes&&(relationFootnotes.notes.has(node.id)||item.blocks?.notes.length&&!item.blocks.body.length))&&renderPassage(item)}
   </Fragment>;
  }):text.trim()?<div className="source-reader-text">{endnotes?fallback?.body:fallback?.inline}</div>:<p className="source-reader-status">{uiText('No readable text was extracted from this attachment.')}</p>}
  {endnotes&&(noteEntries.length>0||!!fallback?.notes.length)&&<section className="source-reader-endnotes" aria-label={uiText('Endnotes')}><h2>{uiText('Endnotes')}</h2>{noteEntries.map(item=>renderPassage(item,true))}{fallback&&<div className="source-reader-text">{fallback.notes}</div>}</section>}
  {children}
 </article></SourceFootnoteDefinitions></SourceBibliography></SourceInlineFootnoteLinks>;
}
