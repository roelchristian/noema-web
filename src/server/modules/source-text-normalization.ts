import type {SourceStructureNode} from '../../shared/domain.js';
import {isSectionKind,mergeSourceStructure} from './source-structure.js';

export interface NormalizationOffset {
 normalizedStart:number; normalizedEnd:number; rawStart:number; rawEnd:number;
 rawLine:number; pageNumber?:number; kind:'text'|'heading'|'separator'|'page-marker';
}

/** Normalize before assigning durable citation lines. Never rewrite a cited source. */
export function normalizeSourceText(text:string,explicit:SourceStructureNode[]=[],pageStarts:number[]=[]) {
 const rawLines=[...text.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)].filter(match=>match.index!<text.length);
 if(!rawLines.length)rawLines.push(Object.assign(['',''],{index:0}) as unknown as RegExpExecArray);
 const lines=rawLines.map(match=>match[1]!);
 type Piece={value:string;rawStart:number;rawEnd:number;rawLine:number;pageNumber?:number;kind:NormalizationOffset['kind']};
 const mapped:Piece[][]=[];
 let currentRaw=0,currentLine=1,currentPage:number|undefined;
 const piece=(value:string,kind:Piece['kind']='text',start=currentRaw,end=start+value.length):Piece=>({value,kind,rawStart:start,rawEnd:end,rawLine:currentLine,...(currentPage?{pageNumber:currentPage}:{})});
 const push=(value:string,parts:Piece[]=[piece(value)])=>{output.push(value);mapped.push(parts);};
 const headings=new Map(mergeSourceStructure(text,explicit).map(node=>[node.startLine,node]));
 const pages=new Map(pageStarts.map((line,index)=>[line,index+1]));
 const output:string[]=[],normalizedPages:number[]=[],structure:SourceStructureNode[]=[];
 const widths=pageStarts.length?lines.map(line=>line.trim().length).filter(length=>length>30).sort((a,b)=>a-b):[];
 const wrapWidth=widths[Math.floor(widths.length/2)]??0;
 let fence:string|undefined,math=false,prose=false,references=false;
 const blank=()=>{if(output.length&&output.at(-1)!=='')push('',[]);prose=false;};
 for(let index=0;index<lines.length;index++) {
  const raw=lines[index]!,line=raw.trim(),lineNumber=index+1;
  currentRaw=rawLines[index]!.index!;currentLine=lineNumber;
  const page=pages.get(lineNumber);if(page)currentPage=page;
  if(page){blank();normalizedPages.push(output.length+1);push(`<!-- Page ${page} -->`,[piece(`<!-- Page ${page} -->`,'page-marker',currentRaw,currentRaw)]);blank();}
  const heading=headings.get(lineNumber);
  if(heading&&!fence&&!math) {
   blank();
   structure.push({...heading,endLine:undefined,startLine:output.length+1});
   if(isSectionKind(heading.kind)) {
    const prefix=`${'#'.repeat(heading.level??2)} `;
    const labelStart=raw.indexOf(heading.text);
    push(prefix+heading.text,[piece(prefix,'heading',currentRaw,currentRaw),piece(heading.text,'heading',currentRaw+Math.max(0,labelStart),currentRaw+(labelStart>=0?labelStart+heading.text.length:raw.length))]);blank();
    references=/^(?:references|bibliography)$/i.test(heading.text);
    // A setext underline belongs to the heading, not its following paragraph.
    if(/^\s*(?:={3,}|-{3,})\s*$/.test(lines[index+1]??''))index++;
    continue;
   }
  }
  // Author-year entries begin independent paragraphs; wrapped publisher and
  // title lines remain attached to their entry, including short terminal lines.
  const referenceStart=references&&/^[\p{L}][^\n]{0,100}?\.\s+(?:1[5-9]|20)\d{2}[a-z]?\./u.test(line);
  if(referenceStart||references&&/^©/.test(line))blank();
  if(/^©/.test(line))references=false;
  const delimiter=line.match(/^(`{3,}|~{3,})/);
  const protectedLine=!!fence||math||!!delimiter||/^\s{4}|^\t/.test(raw)||/^(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|\||\[\^[^\]]+\]:)|^(?:[-*_]\s*){3,}$|^\$\$|\\\[|\\\]/.test(line)||/ {2}$|\\$/.test(raw)||line.includes('\t');
  if(!line&&!fence&&!math){blank();continue;}
  if(protectedLine) {
   push(raw);prose=false;
  }else {
   // Blank lines, headings, and physical pages delimit prose paragraphs.
   const start=currentRaw+raw.indexOf(line);
   if(prose&&output.length){output[output.length-1]+=' '+line;mapped[mapped.length-1]!.push(piece(' ','separator',start,start),piece(line,'text',start,start+line.length));}
   else push(line,[piece(line,'text',start,start+line.length)]);
   prose=true;
   // Short terminal lines in PDF extraction commonly end a paragraph. Keep
   // short labels separate too, so later heading detection can locate them.
   if(!references&&wrapWidth&&line.length<wrapWidth*.65&&(/[.!?:;”’)]$/.test(line)||line.length<wrapWidth*.4))blank();
  }
  if(delimiter){if(!fence)fence=delimiter[1]!;else if(fence[0]===delimiter[1]![0]&&delimiter[1]!.length>=fence.length)fence=undefined;}
  if(!fence&&(line.match(/\$\$/g)?.length??0)%2===1)math=!math;
  if(!fence&&line==='\\[')math=true;
  if(!fence&&line==='\\]')math=false;
 }
 while(output.at(-1)===''){output.pop();mapped.pop();}
 const offsetMap:NormalizationOffset[]=[];let offset=0,previousAnchor:Piece|undefined;
 for(let index=0;index<mapped.length;index++){
  for(const {value,...entry} of mapped[index]!){offsetMap.push({...entry,normalizedStart:offset,normalizedEnd:offset+value.length});offset+=value.length;}
  previousAnchor=mapped[index]!.at(-1)??previousAnchor;
  if(index<mapped.length-1){const anchor=previousAnchor;
   offsetMap.push({normalizedStart:offset,normalizedEnd:offset+1,rawStart:anchor?.rawEnd??0,rawEnd:anchor?.rawEnd??0,rawLine:anchor?.rawLine??1,...(anchor?.pageNumber?{pageNumber:anchor.pageNumber}:{}),kind:'separator'});offset++;}
 }
 return {text:output.join('\n'),pageStartLines:normalizedPages,structuralNodes:structure,normalizationVersion:'2' as const,rawText:text,offsetMap};
}
