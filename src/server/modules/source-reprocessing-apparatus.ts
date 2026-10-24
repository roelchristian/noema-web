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
