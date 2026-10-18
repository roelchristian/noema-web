import type { SourceStructureNode } from '../../shared/domain.js';

/** Conservative fallback for formats whose extractor cannot supply a heading tree. */
export function sourceStructure(text:string):SourceStructureNode[] {
  const lines=text.replace(/\r\n?/g,'\n').split('\n');
  const nodes:SourceStructureNode[]=[];
  let fence:string|undefined;
  for(let index=0;index<lines.length;index++) {
    const line=lines[index]!.trim();
    const marker=line.match(/^(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1]![0];else if(marker[1]![0]===fence)fence=undefined;continue;}
    if(fence||!line||line.length>240)continue;
    const atx=line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    const setext=index+1<lines.length&&/^\s*(?:={3,}|-{3,})\s*$/.test(lines[index+1]!);
    // Require a chapter/part number or a conventional book division on its own line.
    const book=/^(?:(?:chapter|part|book|section)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\b|[.:])(?:\s*[:.\-–—]?\s*[^.!?]{0,180})?|prologue|epilogue|preface|foreword|introduction|appendix(?:\s+[a-z0-9]+)?)$/i.test(line);
    if(atx)nodes.push({text:atx[2]!,startLine:index+1,level:atx[1]!.length});
    else if(setext){nodes.push({text:line,startLine:index+1,level:lines[index+1]!.trim()[0]==='='?1:2});index++;}
    else if(book&&(index===0||!lines[index-1]!.trim()))nodes.push({text:line,startLine:index+1,level:/^(part|book)\b/i.test(line)?1:2});
  }
  return nodes;
}

/** Extractor nodes take precedence over inferred headings on the same line. */
export function mergeSourceStructure(text:string,explicit:SourceStructureNode[]=[]):SourceStructureNode[] {
  const lineCount=text.replace(/\r\n?/g,'\n').split('\n').length;
  const byLine=new Map(sourceStructure(text).map(node=>[node.startLine,node]));
  for(const node of explicit)if(node&&typeof node.text==='string'&&node.text.trim()&&Number.isSafeInteger(node.startLine)&&node.startLine>0&&node.startLine<=lineCount)
    byLine.set(node.startLine,{text:node.text.trim().slice(0,2000),startLine:node.startLine,...(Number.isInteger(node.level)&&node.level!>=1&&node.level!<=6?{level:node.level}:{})});
  return [...byLine.values()].sort((a,b)=>a.startLine-b.startLine);
}
