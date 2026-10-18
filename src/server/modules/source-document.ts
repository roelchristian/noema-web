import type {SourceFile,SourceStructureKind,SourceStructureNode} from '../../shared/domain.js';
import type {SourceDocument,SourceDocumentNode,SourceDocumentRange} from '../../shared/source-document.js';
import {isSectionKind,mergeSourceStructure,sectionKind,semanticBlockLabel} from './source-structure.js';

interface Marker {
 start:number;bodyStart:number;kind:SourceStructureKind;title?:string;level:number;end?:number;genericHeading?:boolean;
}

/** Construct the structured view locally. Stored text and citation coordinates stay immutable. */
export function processedSourceDocument(file:SourceFile):SourceDocument {
 const text=file.text.replace(/\r\n?/g,'\n'),lines=text.split('\n'),starts:number[]=[];
 let offset=0;
 for(const line of lines){starts.push(offset);offset+=line.length+1;}
 let explicit:SourceStructureNode[]=[];
 try{const value:unknown=JSON.parse(file.structural_nodes??'[]');if(Array.isArray(value))explicit=value;}catch{/* Legacy sources use local structure. */}
 let pageLines:number[]=[];
 try {
  const value:unknown=JSON.parse(file.page_start_lines??'[]');
  if(Array.isArray(value)&&value.every((line,index)=>Number.isSafeInteger(line)&&line>=1&&line<=lines.length&&(index===0?line===1:line>value[index-1])))pageLines=value;
 }catch{/* No fabricated page positions for unknown layouts. */}
 if(!pageLines.length&&file.format==='pdf'&&file.pages===1)pageLines=[1];
 const pageOffsets=pageLines.map(line=>starts[line-1]!);
 const lineAt=(position:number)=>{
  let low=0,high=starts.length;
  while(low<high){const middle=(low+high)>>>1;if(starts[middle]!<=position)low=middle+1;else high=middle;}
  return Math.max(1,low);
 };
 const pageAt=(position:number)=>{
  let low=0,high=pageOffsets.length;
  while(low<high){const middle=(low+high)>>>1;if(pageOffsets[middle]!<=position)low=middle+1;else high=middle;}
  return low||null;
 };
 const range=(start:number,end:number):SourceDocumentRange=>({startOffset:start,endOffset:end,startLine:lineAt(start),endLine:lineAt(Math.max(start,end-1)),startPage:pageAt(start),endPage:pageAt(Math.max(start,end-1))});
 // Only extractor-recorded page comments are layout markers, not user prose.
 const pageComments=new Set(pageLines.filter((line,index)=>lines[line-1]!.trim()===`<!-- Page ${index+1} -->`).map(line=>starts[line-1]!));
 const markers=new Map<number,Marker>();
 for(const node of mergeSourceStructure(text,explicit)) {
  const start=starts[node.startLine-1]!,raw=lines[node.startLine-1]!;
  if(pageComments.has(start))continue;
  const label=semanticBlockLabel(raw.trim());
  const kind=label?.kind??node.kind??'heading',level=node.level??(kind==='chapter'?1:kind==='subsection'?3:2);
  const heading=isSectionKind(kind);
  let bodyStart=heading?start+raw.length:start;
  // Markdown delimiters are part of the label even when absent from its plain title.
  if(label){const prefix=raw.match(/^(?:\s*#{1,6}\s+)?(?:\*\*|__)?/);bodyStart=start+(prefix?.[0].length??0)+label.label.length;if(/^(?:\*\*|__)/.test(text.slice(bodyStart)))bodyStart+=2;}
  if(heading&&/^\s*(?:={3,}|-{3,})\s*$/.test(lines[node.startLine]??''))bodyStart=starts[node.startLine]!+lines[node.startLine]!.length;
  markers.set(start,{start,bodyStart,kind:kind==='heading'?sectionKind(node.text,level):kind,title:label?.label??(heading?node.text:undefined),level,genericHeading:kind==='heading'&&!/^(?:chapter|part|book|section|subsection)\b/i.test(node.text),
   ...(node.endLine?{end:starts[node.endLine-1]!+lines[node.endLine-1]!.length}:{})});
 }
 // Recover explicit labels that older wrapping cleanup placed inside a stored line.
 // No line rewriting is needed, and mentions such as "by Theorem 1" do not qualify.
 let fence:string|undefined,math=false;
 for(let index=0;index<lines.length;index++) {
  const line=lines[index]!,delimiter=line.trim().match(/^(`{3,}|~{3,})/);
  if(delimiter){if(!fence)fence=delimiter[1]![0];else if(fence===delimiter[1]![0])fence=undefined;continue;}
  if(fence||/^\s{4}|^\t/.test(line))continue;
  if(line.trim()==='$$'||line.trim()==='\\['||line.trim()==='\\]'){math=!math;continue;}
  if(math)continue;
  for(const match of line.matchAll(/\b(?:theorem|lemma|proposition|corollary|definition|proof|example|remark)\b/gi)) {
   const at=match.index!,prefix=line.slice(0,at);
   if(prefix.trim()&&!/[.!?]\s+$/.test(prefix)&&!/^\s*(?:#{1,6}\s+)?(?:\*\*|__)?$/.test(prefix))continue;
   const label=semanticBlockLabel(line.slice(at));
   if(!label)continue;
   const anchored=!prefix.trim()||/^\s*(?:#{1,6}\s+)?(?:\*\*|__)?$/.test(prefix);
   const start=starts[index]!+(anchored?0:at),existing=markers.get(starts[index]!);
   if(anchored)markers.delete(starts[index]!);
   const bodyStart=starts[index]!+at+label.label.length+(/^(?:\*\*|__)/.test(line.slice(at+label.label.length))?2:0);
   markers.set(start,{start,bodyStart,kind:label.kind,title:label.label,level:0,...(existing?.kind===label.kind&&existing.end?{end:existing.end}:{})});
  }
 }
 const ordered=[...markers.values()].sort((a,b)=>a.start-b.start);
 const children:SourceDocumentNode[]=[],stack:{node:SourceDocumentNode;level:number}[]=[];
 const destination=()=>stack.at(-1)?.node.children??children;
 const appendParagraphs=(start:number,end:number,target:SourceDocumentNode[])=>{
  let chunkStart=-1,chunkEnd=start,parts:string[]=[],kind:SourceDocumentNode['kind']='paragraph',blockFence:string|undefined,displayMath=false;
  const flush=()=>{
   const joined=parts.join('\n'),body=kind==='code'?joined.trimEnd():joined.trim();
   if(body.trim())target.push({id:`${kind}-${chunkStart}`,kind,range:range(chunkStart,chunkEnd),text:kind==='paragraph'?body.replace(/\s*\n\s*/g,' '):body});
   chunkStart=-1;parts=[];kind='paragraph';
  };
  let nextPosition=start;
  for(const raw of text.slice(start,end).split('\n')) {
   const position=nextPosition,trimmed=raw.trim();
   nextPosition+=raw.length+1;
   if(pageComments.has(position)){flush();continue;}
   if(!trimmed){if(blockFence||displayMath)parts.push(raw);else flush();continue;}
   const marker=trimmed.match(/^(`{3,}|~{3,})/);
   const table:boolean=trimmed.includes('|')&&(kind==='table'||/^\s*\|?\s*:?-{3,}:?\s*\|/.test(trimmed)||/^\s*\|?\s*:?-{3,}:?\s*\|/.test(text.slice(nextPosition).split('\n')[0]??''));
   const lineKind:SourceDocumentNode['kind']=blockFence||marker||/^\s{4}|^\t/.test(raw)?'code':displayMath||/^\$\$|^\\\[/.test(trimmed)?'equation':/^[-+*]\s|^\d+[.)]\s/.test(trimmed)?'list':table?'table':/^>/.test(trimmed)?'blockquote':'paragraph';
   if(chunkStart>=0&&!blockFence&&!displayMath&&lineKind!==kind)flush();
   if(chunkStart<0){chunkStart=position+(lineKind==='code'?0:raw.indexOf(trimmed));kind=lineKind;}
   parts.push(raw);chunkEnd=position+raw.trimEnd().length;
   if(marker){if(!blockFence)blockFence=marker[1]![0];else if(blockFence===marker[1]![0]){blockFence=undefined;flush();}}
   if(!blockFence){if((trimmed.match(/\$\$/g)?.length??0)%2===1)displayMath=!displayMath;if(trimmed==='\\[')displayMath=true;if(trimmed==='\\]')displayMath=false;if(kind==='equation'&&!displayMath)flush();}
  }
  flush();
 };
 let cursor=0;
 for(let index=0;index<ordered.length;index++) {
  const marker=ordered[index]!;
  appendParagraphs(cursor,marker.start,destination());
  if(isSectionKind(marker.kind)) {
   while(stack.length&&stack.at(-1)!.level>=marker.level){const closed=stack.pop()!.node;closed.range=range(closed.range.startOffset,marker.start);}
   const kind=marker.genericHeading&&stack.length?(stack.at(-1)!.node.kind==='chapter'?'section':'subsection'):marker.kind;
   const node:SourceDocumentNode={id:`${kind}-${marker.start}`,kind,title:marker.title,level:marker.level,range:range(marker.start,text.length),children:[]};
   destination().push(node);stack.push({node,level:marker.level});cursor=marker.bodyStart;
  }else {
   let end=Math.min(marker.end??text.length,ordered[index+1]?.start??text.length);
   // A labelled statement normally ends at its paragraph boundary. Proofs,
   // examples and remarks can contain multiple paragraphs and cross pages.
   if(marker.end===undefined&&['theorem','lemma','proposition','corollary','definition'].includes(marker.kind)) {
    const body=text.slice(marker.bodyStart,end),first=body.search(/\S/);
    if(first>=0){const paragraphEnd=body.slice(first).search(/\n[\t ]*\n/);if(paragraphEnd>=0)end=marker.bodyStart+first+paragraphEnd;}
   }
   const node:SourceDocumentNode={id:`${marker.kind}-${marker.start}`,kind:marker.kind,title:marker.title,range:range(marker.start,end),extent:marker.end===undefined?'inferred':'explicit',children:[]};
   appendParagraphs(marker.bodyStart,end,node.children!);destination().push(node);cursor=end;
  }
 }
 appendParagraphs(cursor,text.length,destination());
 return {
  schemaVersion:1,source:{fileId:file.id,name:file.original_filename||file.name,title:file.generated_name||file.name,format:file.format,language:file.language,url:file.source_url},
  coordinates:{offsets:'zero-based UTF-16, end-exclusive',lines:'one-based extracted text',pages:'one-based physical page order, not printed labels'},
  physical:{pageCount:file.pages||null,pages:pageOffsets.map((start,index)=>({number:index+1,range:range(start,pageOffsets[index+1]??text.length)}))},
  semantic:{kind:'document',children},
  processing:{text:'stored extraction',structure:'stored markers plus local rules',aiEnrichmentStatus:file.enrichment_status,aiScope:'bounded excerpts for long sources',inferredExtents:true},
 };
}

interface GenerationNode {
 kind:SourceDocumentNode['kind'];
 lines:[number,number];
 title?:string;
 text?:string;
 inferred?:true;
 children?:GenerationNode[];
}

/** The generation request contains each content leaf once, inside its hierarchy.
 * Long leaves are split locally so every evidence range fits the citation limit. */
export function sourceGenerationDocument(document:SourceDocument,sourceText:string) {
 const text=sourceText.replace(/\r\n?/g,'\n'),lines=text.split('\n'),starts:number[]=[];
 let offset=0;
 for(const line of lines){starts.push(offset);offset+=line.length+1;}
 const convert=(node:SourceDocumentNode):GenerationNode=>{
  const result:GenerationNode={kind:node.kind,lines:[node.range.startLine,node.range.endLine],
   ...(node.title?{title:node.title}:{}),...(node.extent==='inferred'?{inferred:true as const}:{})};
  if(node.children)result.children=node.children.map(convert);
  else if(node.text!==undefined) {
   if(node.range.endLine-node.range.startLine<30)result.text=node.text;
   else {
    result.children=[];
    for(let startLine=node.range.startLine;startLine<=node.range.endLine;startLine+=30) {
     const endLine=Math.min(startLine+29,node.range.endLine);
     const start=Math.max(node.range.startOffset,starts[startLine-1]!);
     const end=Math.min(node.range.endOffset,starts[endLine]??text.length);
     const body=text.slice(start,end);
     if(body.trim())result.children.push({kind:node.kind,lines:[startLine,endLine],text:node.kind==='paragraph'?body.trim().replace(/\s*\n\s*/g,' '):body});
    }
   }
  }
  return result;
 };
 return {schemaVersion:document.schemaVersion,...(document.processing.math?{mathPreparation:document.processing.math}:{}),physicalPages:document.physical.pages.map(page=>({number:page.number,lines:[page.range.startLine,page.range.endLine]})),content:document.semantic.children.map(convert)};
}
