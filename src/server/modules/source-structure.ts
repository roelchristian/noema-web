import {sourceStructureKinds,type SourceStructureKind,type SourceStructureNode} from '../../shared/domain.js';

export function isSectionKind(kind:SourceStructureKind='heading') {
 return kind==='heading'||kind==='chapter'||kind==='section'||kind==='subsection';
}

/** Only explicit statement labels qualify; prose mentioning a theorem does not. */
export function semanticBlockLabel(line:string):{kind:SourceStructureKind;label:string}|undefined {
 const match=line.match(/^(?:#{1,6}\s+)?(?:\*\*|__)?(theorem|lemma|proposition|corollary|definition|proof|example|remark)(?:\s+(?:\d+(?:\.\d+)*[a-z]?|[ivxlcdm]+)(?:\s*\([^\n)]{1,160}\))?|\s*\([^\n)]{1,160}\)|\s+of\s+(?:theorem|lemma|proposition|corollary)\s+\d+(?:\.\d+)*)?(?:[.:](?:\*\*|__)?(?=\s|$)|(?:\*\*|__)?$)/i);
 if(match)return {kind:match[1]!.toLowerCase() as SourceStructureKind,label:match[0].replace(/^#{1,6}\s+|\*\*|__/g,'').trim()};
}

export function sectionKind(label:string,level:number):SourceStructureKind {
 if(/^(?:chapter|part|book)\b/i.test(label))return 'chapter';
 if(/^section\b/i.test(label))return 'section';
 if(/^subsection\b/i.test(label)||level>=3)return 'subsection';
 return 'section';
}

/** Conservative fallback for formats whose extractor cannot supply a heading tree. */
export function sourceStructure(text:string):SourceStructureNode[] {
  const lines=text.replace(/\r\n?/g,'\n').split('\n');
  const nodes:SourceStructureNode[]=[];
  // A sequence of short numbered titles in an article is stronger evidence than
  // an isolated numbered line (which is usually a list item).
  const numbered=lines.flatMap((raw,index)=>{
    const match=raw.trim().match(/^(\d+)\.\s+([A-Z][^.!?;]{1,110})$/);
    return match?[{index,number:Number(match[1])}]:[];
  });
  const articleNumbers=new Set<number>();
  if(numbered.length>=3&&numbered[0]?.number===1&&numbered.every((entry,index)=>entry.number===index+1&&(index===0||entry.index>numbered[index-1]!.index+1))
    &&lines.some(line=>/^(?:references|bibliography)$/i.test(line.trim())))
    for(const entry of numbered)articleNumbers.add(entry.index);
  let fence:string|undefined;
  for(let index=0;index<lines.length;index++) {
    const line=lines[index]!.trim();
    const marker=line.match(/^(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1]!;else if(marker[1]![0]===fence[0]&&marker[1]!.length>=fence.length)fence=undefined;continue;}
    if(fence||!line||/^ {4}|^\t/.test(lines[index]!))continue;
    const semantic=semanticBlockLabel(line);
    if(semantic){nodes.push({text:semantic.label,startLine:index+1,kind:semantic.kind});continue;}
    if(line.length>240)continue;
    const atx=line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    const setext=index+1<lines.length&&/^\s*(?:={3,}|-{3,})\s*$/.test(lines[index+1]!);
    // Require a chapter/part number or a conventional book division on its own line.
    const book=/^(?:(?:chapter|part|book|section|subsection)\s+(?:\d+(?:\.\d+)*|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\b|[.:])(?:\s*[:.\-–—]?\s*[^.!?]{0,180})?|prologue|epilogue|preface|foreword|introduction|appendix(?:\s+[a-z0-9]+)?)$/i.test(line);
    if(articleNumbers.has(index)||/^(?:references|bibliography)$/i.test(line))nodes.push({text:line,startLine:index+1,level:2,kind:'section'});
    else if(atx)nodes.push({text:atx[2]!,startLine:index+1,level:atx[1]!.length});
    else if(setext){nodes.push({text:line,startLine:index+1,level:lines[index+1]!.trim()[0]==='='?1:2});index++;}
    else if(book&&(index===0||!lines[index-1]!.trim()))nodes.push({text:line,startLine:index+1,level:/^(part|book)\b/i.test(line)?1:/^subsection\b/i.test(line)?4:/^section\b/i.test(line)?3:2});
  }
  return nodes;
}

/** Extractor nodes take precedence over inferred headings on the same line. */
export function mergeSourceStructure(text:string,explicit:SourceStructureNode[]=[]):SourceStructureNode[] {
  const lineCount=text.replace(/\r\n?/g,'\n').split('\n').length;
  const byLine=new Map(sourceStructure(text).map(node=>[node.startLine,node]));
  for(const node of explicit)if(node&&typeof node.text==='string'&&node.text.trim()&&Number.isSafeInteger(node.startLine)&&node.startLine>0&&node.startLine<=lineCount)
    byLine.set(node.startLine,{text:node.text.trim().slice(0,2000),startLine:node.startLine,
      kind:node.kind&&sourceStructureKinds.includes(node.kind)?node.kind:byLine.get(node.startLine)?.kind??'heading',
      ...(Number.isInteger(node.level)&&node.level!>=1&&node.level!<=6?{level:node.level}:{}),
      ...(Number.isSafeInteger(node.endLine)&&node.endLine!>=node.startLine&&node.endLine!<=lineCount?{endLine:node.endLine}:{})});
  return [...byLine.values()].sort((a,b)=>a.startLine-b.startLine);
}

/** Enrichment may add semantic detail, but cannot rename or demote known sections. */
export function mergeEnrichedSourceStructure(text:string,explicit:SourceStructureNode[],suggested:SourceStructureNode[]):SourceStructureNode[] {
 const known=mergeSourceStructure(text,explicit);
 const byLine=new Map(known.map(node=>[node.startLine,node]));
 const refined=suggested.map(node=>{
  const existing=byLine.get(node.startLine);
  return existing&&isSectionKind(existing.kind)?existing:{...existing,...node};
 });
 return mergeSourceStructure(text,[...known,...refined]);
}
