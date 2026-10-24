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
  const printed=new Map<string,string>(),prefixes=new Map<string,string>();let valid=targets.size>0;
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for(const id of targets){
   const match=id.match(/^p(\d+)-(\d+|[*†‡])$/);if(!match||Number(match[1])!==page.number){valid=false;break;}
   const number=match[2]!,raw=[...source.matchAll(new RegExp(`^[ \\t]*(${escape(number)}[.)]?)(?=[ \\t])`,'gm'))];
   const existing=[...source.matchAll(new RegExp(`^[ \\t]*\\[\\^(?:${escape(id)}|${escape(number)})\\]:`,'gm'))];
   if(raw.length+existing.length!==1){valid=false;break;}
   const definitions=[...proposed.matchAll(new RegExp(`^[ \\t]*\\[\\^${escape(id)}\\]:`,'gm'))];
   const references=[...proposed.matchAll(new RegExp(`\\[\\^${escape(id)}\\](?!:)`,'g'))];
   if(definitions.length!==1||!references.length||references.some(ref=>ref.index!>=definitions[0]!.index!||/\d/.test(proposed[ref.index!-1]??'')||/\d/.test(proposed[ref.index!+ref[0].length]??''))){valid=false;break;}
   printed.set(id,number);printed.set(number,number);prefixes.set(id,raw[0]?.[1]??number);prefixes.set(number,raw[0]?.[1]??number);
  }
  if(!valid)continue;
  const plain=(value:string)=>value.replace(/^[ \t]*\[\^([^\]\n]+)\]:/gm,(whole,id:string)=>prefixes.get(id)??whole).replace(/\[\^([^\]\n]+)\]/g,(whole,id:string)=>printed.get(id)??whole).replace(/[ \t\r\n]+/g,' ').trim();
  if(plain(source)!==plain(proposed)||apparatusProblems(source,proposed).length)continue;
  const appliedAt=new Date().toISOString();
  for(const patch of group){patch.category='footnote';patch.decision='accepted';patch.riskReasons=[];patch.autoAcceptance={policy:'verified',validator:'canonical-footnote-layout-v1',checks:['single-physical-page','paired-footnote-reference-definition','printed-note-label-preserved','identical-note-and-body-text'],appliedAt};patch.decisionHistory=[...(patch.decisionHistory??[]),{at:appliedAt,actor:'automatic',from:'pending',to:'accepted'}];}
 }
 return patches;
}
