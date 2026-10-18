import type {SourceStructureNode} from '../../shared/domain.js';
import {isSectionKind,mergeSourceStructure} from './source-structure.js';

/** Normalize before assigning durable citation lines. Never rewrite a cited source. */
export function normalizeSourceText(text:string,explicit:SourceStructureNode[]=[],pageStarts:number[]=[]) {
 const lines=text.replace(/\r\n?/g,'\n').split('\n');
 const headings=new Map(mergeSourceStructure(text,explicit).map(node=>[node.startLine,node]));
 const pages=new Map(pageStarts.map((line,index)=>[line,index+1]));
 const output:string[]=[],normalizedPages:number[]=[],structure:SourceStructureNode[]=[];
 const widths=pageStarts.length?lines.map(line=>line.trim().length).filter(length=>length>30).sort((a,b)=>a-b):[];
 const wrapWidth=widths[Math.floor(widths.length/2)]??0;
 let fence:string|undefined,math=false,prose=false;
 const blank=()=>{if(output.length&&output.at(-1)!=='')output.push('');prose=false;};
 for(let index=0;index<lines.length;index++) {
  const raw=lines[index]!,line=raw.trim(),lineNumber=index+1;
  const page=pages.get(lineNumber);
  if(page){blank();normalizedPages.push(output.length+1);output.push(`<!-- Page ${page} -->`);blank();}
  const heading=headings.get(lineNumber);
  if(heading&&!fence&&!math) {
   blank();
   structure.push({...heading,endLine:undefined,startLine:output.length+1});
   if(isSectionKind(heading.kind)) {
    output.push(`${'#'.repeat(heading.level??2)} ${heading.text}`);blank();
    // A setext underline belongs to the heading, not its following paragraph.
    if(/^\s*(?:={3,}|-{3,})\s*$/.test(lines[index+1]??''))index++;
    continue;
   }
  }
  const delimiter=line.match(/^(`{3,}|~{3,})/);
  const protectedLine=!!fence||math||!!delimiter||/^\s{4}|^\t/.test(raw)||/^(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|\|)|^(?:[-*_]\s*){3,}$|^\$\$|\\\[|\\\]/.test(line)||/ {2}$|\\$/.test(raw)||line.includes('\t');
  if(!line&&!fence&&!math){blank();continue;}
  if(protectedLine) {
   output.push(raw);prose=false;
  }else {
   // Blank lines, headings, and physical pages delimit prose paragraphs.
   if(prose&&output.length)output[output.length-1]+=' '+line;
   else output.push(line);
   prose=true;
   // Short terminal lines in PDF extraction commonly end a paragraph. Keep
   // short labels separate too, so later heading detection can locate them.
   if(wrapWidth&&line.length<wrapWidth*.65&&(/[.!?:;”’)]$/.test(line)||line.length<wrapWidth*.4))blank();
  }
  if(delimiter){if(!fence)fence=delimiter[1]![0];else if(fence===delimiter[1]![0])fence=undefined;}
  if(!fence&&(line.match(/\$\$/g)?.length??0)%2===1)math=!math;
  if(!fence&&line==='\\[')math=true;
  if(!fence&&line==='\\]')math=false;
 }
 while(output.at(-1)==='')output.pop();
 return {text:output.join('\n'),pageStartLines:normalizedPages,structuralNodes:structure};
}
