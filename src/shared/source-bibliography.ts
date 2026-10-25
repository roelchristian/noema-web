/** A printed numbered bibliography is separate from footnotes and application citations. */
export interface SourceBibliographicEntry {label:string;startOffset:number;endOffset:number;text:string}
export interface SourceBibliographicCitation {label:string;startOffset:number;endOffset:number;text:string;entryStartOffset:number}
export interface SourceBibliography {entries:SourceBibliographicEntry[];citations:SourceBibliographicCitation[];diagnostics:string[]}

/** Equal-length masking preserves exact UTF-16 source coordinates. */
function proseMask(text:string):string {
 const blank=(value:string)=>value.replace(/[^\r\n]/g,' ');
 return text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\n]*(?:\n|$)/gm,blank)
  .replace(/(`+)[^\n]*?\1/g,blank)
  .replace(/(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\\\[[\s\S]*?(?<!\\)\\\]|(?<![\\$])\$(?![\s$])(?:\\.|[^$\n\\])+?(?<![\s\\])\$(?![$\d])|(?<!\\)\\\([^\n]*?(?<!\\)\\\)/g,blank)
  .replace(/<!--[^]*?-->|https?:\/\/\S+|!?\[[^\]\n]*\]\([^\n)]*\)|\[\^[^\]\n]+\]/g,blank);
}
/** Plain printed labels, using the same exclusions as bibliography navigation. */
export function sourceBibliographicLabelOccurrences(text:string):{label:string;startOffset:number;endOffset:number}[] {
 return [...proseMask(text).matchAll(/(?<![\\\[])\[(\d{1,4})\](?![\]:])/g)].map(match=>({label:match[1]!,startOffset:match.index!,endOffset:match.index!+match[0].length}));
}
const referenceHeading=/^[ \t]*(?:#{1,6}[ \t]+)?(?:\*\*|__)?(?:\d+[.)][ \t]+)?(?:references|bibliography|works cited|literature cited)(?:\*\*|__)?[ \t]*$/gim;

/** Recognize only uniquely numbered entries under an explicit bibliography heading.
 * Bracket expressions in equations, code, links, and bibliography bodies are not citations.
 * The map supplies navigation, never permission to rewrite source text or invent a URL. */
export function discoverSourceBibliography(text:string):SourceBibliography {
 const masked=proseMask(text),headings=[...masked.matchAll(referenceHeading)],entries:SourceBibliographicEntry[]=[],regions:{start:number;end:number}[]=[],diagnostics:string[]=[];
 for(const heading of headings){
  const start=heading.index!+heading[0].length;
  const rest=masked.slice(start),next=/^[ \t]*#{1,6}[ \t]+\S.*$/m.exec(rest),end=next?start+next.index:text.length;
  if(regions.some(region=>start>=region.start&&start<region.end))continue;
  regions.push({start,end});
  const definitions=[...masked.slice(start,end).matchAll(/^[ \t]*\[(\d{1,4})\][ \t]+(?=\S)/gm)];
  for(const [index,definition] of definitions.entries()){
   const at=start+definition.index!+definition[0].indexOf('['),stop=index+1<definitions.length?start+definitions[index+1]!.index!:end;
   const value=text.slice(at,stop).trimEnd();if(!value)continue;
   entries.push({label:definition[1]!,startOffset:at,endOffset:at+value.length,text:value});
   if(entries.length>=2000)break;
  }
 }
 const counts=new Map<string,number>();for(const entry of entries)counts.set(entry.label,(counts.get(entry.label)??0)+1);
 const unique=entries.filter(entry=>{if(counts.get(entry.label)===1)return true;const message=`Bibliographic label [${entry.label}] has multiple entries; its citation linkage remains unresolved.`;if(!diagnostics.includes(message))diagnostics.push(message);return false;});
 const targets=new Map(unique.map(entry=>[entry.label,entry])),citations:SourceBibliographicCitation[]=[];
 const numberedLines=[...masked.matchAll(/^[ \t]*\[(\d{1,4})\][ \t]+[^\n]+/gm)],listLabels=new Set<number>();
 for(const [index,line] of numberedLines.entries()){const next=numberedLines[index+1];if(next&&Number(next[1])===Number(line[1])+1&&/^\s*$/.test(masked.slice(line.index!+line[0].length,next.index!))){listLabels.add(line.index!+line[0].indexOf('['));listLabels.add(next.index!+next[0].indexOf('['));}}
 for(const match of masked.matchAll(/(?<![\\\[])\[(\d{1,4})\](?![\]:])/g)){
  const startOffset=match.index!,endOffset=startOffset+match[0].length;
  if(listLabels.has(startOffset)||regions.some(region=>startOffset>=region.start&&startOffset<region.end))continue;
  const entry=targets.get(match[1]!);if(!entry)continue;
  citations.push({label:match[1]!,startOffset,endOffset,text:text.slice(startOffset,endOffset),entryStartOffset:entry.startOffset});
  if(citations.length>=10000)break;
 }
 return {entries:unique,citations,diagnostics};
}
