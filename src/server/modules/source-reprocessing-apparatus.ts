import {createHash} from 'node:crypto';
import {HttpError} from '../validation.js';
import type {SourceEditorialPatch} from '../../shared/source-reprocessing.js';

const labels=(text:string)=>new Set([...text.matchAll(/\[\^([^\]\n]+)\]/g)].map(match=>match[1]!));
/** Connected reference/definition edits share a decision boundary, including a renamed
 * label's old and new names. Never allow half of a dependent repair to reach the reader. */
export function groupApparatusPatches(patches:SourceEditorialPatch[]):SourceEditorialPatch[]{
 const groups=patches.map((patch,index)=>({indexes:new Set([index]),labels:labels(patch.original+'\n'+patch.replacement)})).filter(group=>group.labels.size);
 for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;){
  if([...groups[i]!.labels].some(label=>groups[j]!.labels.has(label))){for(const index of groups[j]!.indexes)groups[i]!.indexes.add(index);for(const label of groups[j]!.labels)groups[i]!.labels.add(label);groups.splice(j,1);j=i+1;}else j++;
 }
 for(const group of groups){const members=[...group.indexes].map(index=>patches[index]!);const id='apparatus-'+createHash('sha256').update(members.map(patch=>patch.id).sort().join(':')).digest('hex').slice(0,24);for(const patch of members){
  if(patch.patchGroupId===id)continue;
  if(patch.decision!=='pending'){patch.decisionHistory=[...(patch.decisionHistory??[]),{at:new Date().toISOString(),actor:'automatic',from:patch.decision,to:'pending'}];patch.riskReasons=[...(patch.riskReasons??[]),'New dependent scholarly changes require reviewing the complete group again.'];}
  patch.patchGroupId=id;patch.decision='pending';delete patch.autoAcceptance;
 }}
 return patches;
}
export function assertAtomicPatchGroups(patches:SourceEditorialPatch[]):void{
 const groups=new Map<string,SourceEditorialPatch['decision']>();
 // Recompute dependencies rather than trusting archive-supplied group identifiers.
 const derived=groupApparatusPatches(structuredClone(patches));
 for(const [index,patch] of patches.entries()){const groupId=derived[index]!.patchGroupId;if(!groupId)continue;const prior=groups.get(groupId);if(prior!==undefined&&prior!==patch.decision)throw new HttpError(400,'Dependent scholarly apparatus changes must be reviewed together.');groups.set(groupId,patch.decision);}
}
/** New broken links are invalid reconstruction, while pre-existing source defects remain
 * visible as review findings. This checks linkage, never scholarly correctness. */
export function apparatusProblems(original:string,replacement:string):string[]{
 const missing=(text:string)=>{const refs=labels(text),defs=new Map<string,number>();for(const match of text.matchAll(/^[ \t]*\[\^([^\]\n]+)\]:/gm))defs.set(match[1]!,1+(defs.get(match[1]!)??0));return new Set([...refs].filter(label=>defs.get(label)!==1));};
 const old=missing(original),next=missing(replacement);return [...next].filter(label=>!old.has(label)).map(label=>`New missing or ambiguous footnote definition: ${label}.`);
}

/** Apply paired footnote markup as layout when the page's text and printed labels
 * are unchanged. A model's proposed linkage alone cannot justify changing note text. */
export function acceptVerifiedFootnoteFormatting(patches:SourceEditorialPatch[],text:string,document:import('../../shared/source-document.js').SourceDocument,policy:'verified'|'review_all'):SourceEditorialPatch[]{
 if(policy!=='verified')return patches;
 const groups=new Map<string,SourceEditorialPatch[]>();
 for(const patch of patches)if(patch.patchGroupId){const group=groups.get(patch.patchGroupId)??[];group.push(patch);groups.set(patch.patchGroupId,group);}
 for(const group of groups.values()){
  if(group.some(patch=>patch.decision!=='pending'||patch.userReplacement!==undefined||patch.decisionHistory?.some(entry=>entry.actor==='user')))continue;
  const sorted=[...group].sort((a,b)=>a.range.startOffset-b.range.startOffset),start=sorted[0]!.range.startOffset,end=sorted.at(-1)!.range.endOffset;
  const pages=document.physical.pages.filter(page=>page.range.startOffset<=start&&page.range.endOffset>=end);if(pages.length!==1)continue;
  const page=pages[0]!,source=text.slice(page.range.startOffset,page.range.endOffset);
  if(sorted.some((patch,index)=>text.slice(patch.range.startOffset,patch.range.endOffset)!==patch.original||index>0&&patch.range.startOffset<sorted[index-1]!.range.endOffset))continue;
  let proposed=source;
  for(const patch of [...sorted].reverse())proposed=proposed.slice(0,patch.range.startOffset-page.range.startOffset)+patch.replacement+proposed.slice(patch.range.endOffset-page.range.startOffset);
  const targets=new Set(group.flatMap(patch=>[...labels(patch.replacement)]));
  const labelSource=source.replace(/^<!-- Page \d+ -->$/gm,marker=>' '.repeat(marker.length));
  const printed=new Map<string,string>(),prefixes=new Map<string,string>();let valid=targets.size>0;
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for(const id of targets){
   const match=id.match(/^p(\d+)-(\d+|[*†‡])$/);if(!match||Number(match[1])!==page.number){valid=false;break;}
   const number=match[2]!,raw=[...labelSource.matchAll(new RegExp(`(?:^|[ \\t\\r\\n])(${escape(number)}[.)]?)(?=[ \\t])`,'g'))];
   const existing=[...source.matchAll(new RegExp(`^[ \\t]*\\[\\^(?:${escape(id)}|${escape(number)})\\]:`,'gm'))];
   if(raw.length+existing.length!==1){valid=false;break;}
   const definitions=[...proposed.matchAll(new RegExp(`^[ \\t]*\\[\\^${escape(id)}\\]:`,'gm'))];
   const references=[...proposed.matchAll(new RegExp(`\\[\\^${escape(id)}\\](?!:)`,'g'))];
   if(definitions.length!==1||!references.length||references.some(ref=>ref.index!>=definitions[0]!.index!||/\d/.test(proposed[ref.index!-1]??'')||/\d/.test(proposed[ref.index!+ref[0].length]??''))){valid=false;break;}
   printed.set(id,number);printed.set(number,number);prefixes.set(id,raw[0]?.[1]??number);prefixes.set(number,raw[0]?.[1]??number);
  }
  if(!valid)continue;
  // Extraction often merges a note body into the preceding paragraph. Require a
  // unique standalone printed label, rather than requiring the extractor to have
  // already supplied the very line boundary this reconstruction is restoring.
  // Citation identifiers can also contain spurious spaces after a dash. Restrict
  // this equivalence to capitalized, digit-bearing identifiers; prose hyphens,
  // dates, page ranges, quotations and note wording otherwise remain exact.
  const citationSpacing=(value:string)=>value.replace(/\b[A-Z]{2,}-(?:[ \t]*\d[\d/]*(?:-[ \t]*)?)+/g,identifier=>identifier.replace(/-[ \t]+(?=\d)/g,'-'));
  const plain=(value:string)=>citationSpacing(value.replace(/^[ \t]*\[\^([^\]\n]+)\]:/gm,(whole,id:string)=>prefixes.get(id)??whole).replace(/\[\^([^\]\n]+)\]/g,(whole,id:string)=>printed.get(id)??whole).replace(/[ \t\r\n]+/g,' ').trim());
  const canonical=plain(source),proposedPlain=plain(proposed);
  // Only added, balanced inline emphasis can disappear for this comparison.
  // Existing literal markers stay exact; links, code, strike-through, multiline
  // markup and unbalanced runs never qualify as footnote layout.
  const withoutAddedEmphasis=proposedPlain.replace(/(?<![\p{L}\p{N}*_])([*_]{1,2})(?=\S)([^*_\n]+?)(?<=\S)\1(?![\p{L}\p{N}*_])/gu,(whole,marker:string,body:string)=>/^\*{1,2}$|^_{1,2}$/.test(marker)&&!canonical.includes(whole)?body:whole);
  if(canonical!==proposedPlain&&canonical!==withoutAddedEmphasis||apparatusProblems(source,proposed).length)continue;
  const appliedAt=new Date().toISOString();
  for(const patch of group){patch.category='footnote';patch.decision='accepted';patch.riskReasons=[];patch.autoAcceptance={policy:'verified',validator:'canonical-footnote-layout-v2',checks:['single-physical-page','paired-footnote-reference-definition','printed-note-label-preserved','identical-note-and-body-text',...(canonical!==proposedPlain?['balanced-added-inline-emphasis']:[])],appliedAt};patch.decisionHistory=[...(patch.decisionHistory??[]),{at:appliedAt,actor:'automatic',from:'pending',to:'accepted'}];}
 }
 return patches;
}

export interface CanonicalFootnoteCandidate {id:string;blockId:string;quote:string;body:string;printedLabel:string;page:number}
/** Pair attached printed reference markers with unique standalone labels on the
 * same physical page. These are canonical evidence hints, never invented notes. */
export function discoverCanonicalFootnotes(chunk:import('./source-reprocessing-planner.js').PlannedReprocessingChunk,document:import('../../shared/source-document.js').SourceDocument):CanonicalFootnoteCandidate[]{
 const candidates:CanonicalFootnoteCandidate[]=[];
 const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const page of document.physical.pages){
  if(page.range.endOffset<=chunk.start||page.range.startOffset>=chunk.end)continue;
  const text=chunk.blocks.map(block=>block.text).join(''),start=Math.max(0,page.range.startOffset-chunk.start),end=Math.min(text.length,page.range.endOffset-chunk.start);
  const source=text.slice(start,end),visible=source.replace(/^<!-- Page \d+ -->$/gm,marker=>' '.repeat(marker.length));
  const found:[number,number,string][]=[];
  for(const match of visible.matchAll(/(?:^|[ \t\r\n])(\d{1,3}|[*†‡])[.)]?[ \t]+(?=\S)/g)){
   const label=match[1]!,at=match.index!+match[0].search(/\S/),prefix=visible.slice(0,at);
   // Attached markers distinguish footnote evidence from ordinary numbered lists,
   // dates, running page labels and statutory article numbers.
   const refs=[...prefix.matchAll(new RegExp(`[\\p{L}\\p{Pe}.,;:!?](?:${escape(label)})(?![\\p{L}\\d])`,'gu'))];
   if(!refs.length)continue;
   const duplicates=[...visible.matchAll(new RegExp(`(?:^|[ \\t\\r\\n])${escape(label)}[.)]?[ \\t]+(?=\\S)`,'g'))];
   if(duplicates.length!==1)continue;
   found.push([at,match.index!+match[0].length,label]);
  }
  for(const [index,[at,bodyAt,label]] of found.entries()){
   const absolute=chunk.start+start+at,block=chunk.blocks.find(block=>block.start<=absolute&&block.end>absolute);if(!block)continue;
   const stop=Math.min(found[index+1]?.[0]??source.length,block.end-chunk.start-start);
   const body=source.slice(bodyAt,stop).trimEnd();if(!body||/^<!--/.test(body))continue;
   candidates.push({id:`p${page.number}-${label}`,blockId:block.id,quote:source.slice(at,bodyAt)+body,body,printedLabel:label,page:page.number});
  }
 }
 return candidates;
}
/** Recover an omitted, unambiguously paired note in its original canonical block.
 * The provider response is immutable and unrelated layout/furniture stays intact. */
export function recoverCanonicalFootnoteDefinitions(chunk:import('./source-reprocessing-planner.js').PlannedReprocessingChunk,response:unknown,document:import('../../shared/source-document.js').SourceDocument,candidates=discoverCanonicalFootnotes(chunk,document)):unknown{
 if(!response||typeof response!=='object'||Array.isArray(response))return response;
 const result=structuredClone(response) as {blocks?:{id:string;text:string}[];diagnostics?:string[]};
 if(!Array.isArray(result.blocks)||result.blocks.length!==chunk.blocks.length||result.blocks.some((block,index)=>!block||block.id!==chunk.blocks[index]!.id||typeof block.text!=='string'))return response;
 const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const candidate of candidates){
  const all=result.blocks.map(block=>block.text).join('\n\n'),id=escape(candidate.id);
  if(!new RegExp(`\\[\\^${id}\\](?!:)`).test(all)||new RegExp(`^[ \\t]*\\[\\^${id}\\]:`,'m').test(all))continue;
  const block=result.blocks.find(block=>block.id===candidate.blockId)!;
  const definition=`[^${candidate.id}]: ${candidate.body}`;
  if(block.text.includes(candidate.quote))block.text=block.text.replace(candidate.quote,`\n\n${definition}`);
  else{
   // A body that survives with changed formatting or wording is not an omission.
   // Avoid duplicating it or overriding a substantive editorial proposal.
   const words=candidate.body.match(/[\p{L}\p{N}]+/gu)??[],signature=words.slice(0,Math.min(6,words.length)).join(' ');
   if(words.length<3||all.replace(/[^\p{L}\p{N}]+/gu,' ').includes(signature))continue;
   const next=candidates.slice(candidates.indexOf(candidate)+1).find(note=>note.blockId===candidate.blockId);
   const nextMarker=next?new RegExp(`^[ \\t]*\\[\\^${escape(next.id)}\\]:`,'m').exec(block.text):null;
   const at=nextMarker?.index??(next&&block.text.includes(next.quote)?block.text.indexOf(next.quote):block.text.length);
   block.text=block.text.slice(0,at).trimEnd()+`\n\n${definition}\n\n`+block.text.slice(at);
  }
  const message=`Recovered omitted canonical footnote ${candidate.id} in its original block; printed label and note wording preserved.`;
  result.diagnostics=[...(result.diagnostics??[]).slice(0,29),message];
 }
 return result;
}
