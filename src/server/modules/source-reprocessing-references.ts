import {discoverSourceBibliography,sourceBibliographicLabelOccurrences} from '../../shared/source-bibliography.js';
import type {PlannedReprocessingChunk} from './source-reprocessing-planner.js';

export interface CanonicalBibliographicEvidence {blockId:string;quote:string;start:number;end:number}
export interface CanonicalBibliographicReference {label:string;entry:CanonicalBibliographicEvidence;citations:CanonicalBibliographicEvidence[]}
const object=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;

/** Source-bound hints identify printed bibliography entries, never footnote definitions. */
export function canonicalBibliographicReferences(chunks:PlannedReprocessingChunk[]):CanonicalBibliographicReference[] {
 const blocks=chunks.flatMap(chunk=>chunk.blocks).sort((a,b)=>a.start-b.start);
 // Canonical blocks partition the document; use absolute positions even for sparse inputs.
 const parts:string[]=[];let cursor=0;
 for(const block of blocks){if(block.start<cursor)return [];if(block.start>cursor)parts.push(' '.repeat(block.start-cursor));parts.push(block.text);cursor=block.end;}
 const text=parts.join('');
 const bibliography=discoverSourceBibliography(text);
 const evidence=(start:number,end:number):CanonicalBibliographicEvidence|undefined=>{
  const block=blocks.find(block=>block.start<=start&&block.end>=end);if(!block)return undefined;
  return {blockId:block.id,quote:text.slice(start,end),start,end};
 };
 return bibliography.entries.flatMap(entry=>{
  // A bounded exact prefix identifies a multi-line entry without inventing a shortened quote.
  const owning=blocks.find(block=>block.start<=entry.startOffset&&block.end>entry.startOffset);if(!owning)return [];
  let end=Math.min(entry.endOffset,owning.end,entry.startOffset+500);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]??''))end--;
  const target=evidence(entry.startOffset,end);if(!target)return [];
  const citations=bibliography.citations.filter(citation=>citation.label===entry.label).flatMap(citation=>{const value=evidence(citation.startOffset,citation.endOffset);return value?[value]:[];});
  return citations.length?[{label:entry.label,entry:target,citations}]:[];
 }).slice(0,128);
}

export function bibliographicReferencesForChunk(references:CanonicalBibliographicReference[],chunk:PlannedReprocessingChunk):CanonicalBibliographicReference[] {
 const ids=new Set(chunk.blocks.map(block=>block.id));let budget=16000;
 return references.filter(reference=>ids.has(reference.entry.blockId)||reference.citations.some(citation=>ids.has(citation.blockId))).flatMap(reference=>{
  const local={...reference,citations:reference.citations.filter(citation=>ids.has(citation.blockId)).slice(0,32)},size=JSON.stringify(local).length;
  if(size>budget)return [];budget-=size;return [local];
 }).slice(0,64);
}

/** Explicit identification is coverage evidence only; deterministic navigation keeps printed labels. */
export function auditBibliographicReferences(references:CanonicalBibliographicReference[],response:unknown,chunk:PlannedReprocessingChunk):string[] {
 const applicable=bibliographicReferencesForChunk(references,chunk),value=object(response),reviews=Array.isArray(value?.referenceReviews)?value.referenceReviews:[];
 return applicable.map(reference=>{
  const matches=reviews.map(object).filter(review=>review?.label===reference.label),review=matches[0];
  if(matches.length!==1||!review||!['linked','ambiguous'].includes(String(review.outcome))||typeof review.explanation!=='string'||!review.explanation.trim()||review.explanation.length>1500)return `Bibliographic reference [${reference.label}]: missing or invalid explicit identification; the exact printed citation and entry remain available for review.`;
  if(review.outcome==='linked'){
   const expected=new Map<string,number>();
   for(const citation of reference.citations)expected.set(citation.blockId,(expected.get(citation.blockId)??0)+1);
   const localEntry=chunk.blocks.some(block=>block.id===reference.entry.blockId);
   if(localEntry)expected.set(reference.entry.blockId,(expected.get(reference.entry.blockId)??0)+1);
   const blocks=Array.isArray(value?.blocks)?value.blocks.map(object):[];
   for(const [blockId,count] of expected){
    const block=blocks.find(block=>block?.id===blockId),text=typeof block?.text==='string'?block.text:'';
    const labels=sourceBibliographicLabelOccurrences(text).filter(label=>label.label===reference.label);
    const entryRetained=!localEntry||blockId!==reference.entry.blockId||labels.some(label=>!text.slice(text.lastIndexOf('\n',label.startOffset-1)+1,label.startOffset).trim()&&/^[ \t]+\S/.test(text.slice(label.endOffset)));
    if(labels.length<count||!entryRetained)return `Bibliographic reference [${reference.label}]: reported linked, but its printed bracketed citation or bibliography entry is missing or converted in block ${blockId}. Keep numbered references separate from footnotes.`;
   }
  }
  return `Bibliographic reference [${reference.label}]: ${review.outcome} — ${review.explanation}`;
 });
}
