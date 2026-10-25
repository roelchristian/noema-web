import {createHash} from 'node:crypto';
import {utf16Boundary} from './source-reprocessing-patches.js';
import type {PlannedReprocessingChunk} from './source-reprocessing-planner.js';

export interface CorrectionEvidence {blockId:string;quote:string;start:number;end:number;notation?:string}
export interface CorrectionLedgerEntry {
 id:string;kind:'notation_conflict'|'reported_uncertainty';reason:string;alternatives:string[];evidence:CorrectionEvidence[];
 /** A projected task requires an outcome for this particular canonical block. */
 targetBlockId?:string;
 /** Internal projection version, omitted from model requests. */
 projectionScope?:'family'|'block';
 /** Internal local evidence is projected out before a bounded model request. */
 chunkEvidence?:{chunkIndex:number;evidence:CorrectionEvidence[]}[];
}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,24);
const bounded=(value:string,max:number)=>Array.from(value).slice(0,max).join('');
const object=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const unicodeIndices:Record<string,string>={'₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9','⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};
/** Equal-length masking keeps every nomination tied to exact canonical coordinates. */
function reviewableText(text:string):string {
 const blank=(value:string)=>value.replace(/[^\r\n]/g,' ');
 return text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\n]*(?:\n|$)/gm,blank).replace(/(`+)[^\n]*?\1/g,blank).replace(/<!--[^]*?-->|https?:\/\/\S+|\[\^[^\]\n]+\]/g,blank);
}
function notationTokens(text:string):{raw:string;family:string;key:string;at:number}[] {
 const tokens:{raw:string;family:string;key:string;at:number}[]=[];
 const pattern=/(?<![\p{L}\p{N}\\])(?<stem>\\[A-Za-z]{2,20}|[\p{L}])(?:(?<position>[_^])(?:\{(?<braced>[+-]?[\p{L}\p{N}]{1,8})\}|(?<index>[+-]?[\p{L}\p{N}]{1,8}))|(?<plain>\d{1,8})|(?<sub>[₀-₉]{1,8})|(?<super>[⁰¹²³⁴⁵⁶⁷⁸⁹]{1,8}))(?![\p{L}\p{N}])/gu;
 for(const match of reviewableText(text).matchAll(pattern)){
  const group=match.groups!,index=group.braced??group.index??group.plain??Array.from(group.sub??group.super??'').map(char=>unicodeIndices[char]??char).join('');
  const family=group.stem+((group.position==='^'||group.super)?'^':'_');
  tokens.push({raw:match[0],family,key:family+index,at:match.index!});
  if(tokens.length>=4096)break;
 }
 return tokens;
}

/** Conflicting forms are nominations, including intentional distinctions, never normalization rules.
 * Canonical evidence is retained exactly; repeated model agreement cannot approve a correction. */
export function createCorrectionLedger(chunks:PlannedReprocessingChunk[],uncertainties:unknown[]=[],options:{scope:'family'|'block'}={scope:'block'}):CorrectionLedgerEntry[] {
 const blocks=chunks.flatMap(chunk=>chunk.blocks),byId=new Map(blocks.map(block=>[block.id,block])),chunkForBlock=new Map(chunks.flatMap(chunk=>chunk.blocks.map(block=>[block.id,chunk.index] as const)));
 const families=new Map<string,Map<string,CorrectionEvidence[]>>(),localEvidence=new Map<string,Map<number,Map<string,CorrectionEvidence>>>();
 for(const block of blocks)for(const token of notationTokens(block.text)){
  if(!families.has(token.family)&&families.size>=128)continue;
  const forms=families.get(token.family)??new Map<string,CorrectionEvidence[]>();families.set(token.family,forms);
  if(!forms.has(token.key)&&forms.size>=8)continue;
  const evidence=forms.get(token.key)??[];forms.set(token.key,evidence);
  let start=Math.max(0,token.at-(options.scope==='family'?55:28)),end=Math.min(block.text.length,token.at+token.raw.length+(options.scope==='family'?55:28));
  while(start>0&&!utf16Boundary(block.text,start))start--;while(end<block.text.length&&!utf16Boundary(block.text,end))end++;
  const ref={blockId:block.id,quote:block.text.slice(start,end),start:block.start+start,end:block.start+end,notation:token.raw};
  if(evidence.length<3)evidence.push(ref);
  const locations=localEvidence.get(token.family)??new Map<number,Map<string,CorrectionEvidence>>();localEvidence.set(token.family,locations);
  const chunkIndex=chunkForBlock.get(block.id)!,local=locations.get(chunkIndex)??new Map<string,CorrectionEvidence>();locations.set(chunkIndex,local);
  const locationKey=options.scope==='family'?token.key:block.id+':'+token.key;
  if(!local.has(locationKey))local.set(locationKey,ref);
 }
 const entries:CorrectionLedgerEntry[]=[];
 for(const [family,forms] of families){
  if(forms.size<2)continue;
  const evidence=[...forms.values()].flatMap(items=>items.slice(0,2)).slice(0,8),alternatives=[...forms.values()].map(items=>items[0]!.notation!);
  entries.push({id:digest('notation:'+family+JSON.stringify(evidence)),kind:'notation_conflict',reason:options.scope==='family'?`Different indexed forms of ${family.slice(0,-1)} occur. Determine whether their roles intentionally differ or an extraction error is plausible; do not globally normalize them.`:`Indexed forms of ${family.slice(0,-1)} may intentionally differ or reflect extraction errors. Review each local block; never globally normalize.`,alternatives,evidence,projectionScope:options.scope,chunkEvidence:[...(localEvidence.get(family)??[])].map(([chunkIndex,local])=>({chunkIndex,evidence:[...local.values()]}))});
  if(entries.length>=24)break;
 }
 for(const value of uncertainties.slice(0,128)){
  if(entries.length>=48)break;
  const item=object(value);if(!item||typeof item.nature!=='string'||!Array.isArray(item.evidence))continue;
  const evidence:CorrectionEvidence[]=[];
  for(const candidate of item.evidence.slice(0,8)){
   const ref=object(candidate),block=typeof ref?.blockId==='string'?byId.get(ref.blockId):undefined;
   if(!block||typeof ref?.quote!=='string'||!ref.quote.trim()||ref.quote.length>500)continue;
   const at=block.text.indexOf(ref.quote);if(at<0)continue;
   evidence.push({blockId:block.id,quote:ref.quote,start:block.start+at,end:block.start+at+ref.quote.length});
  }
  if(!evidence.length)continue;
  const alternatives=Array.isArray(item.readings)?item.readings.filter((reading):reading is string=>typeof reading==='string').slice(0,4).map(reading=>bounded(reading,240)):[];
  const reason=bounded(item.nature,400),id=digest('uncertainty:'+reason+JSON.stringify(evidence));
  if(!entries.some(entry=>entry.id===id))entries.push({id,kind:'reported_uncertainty',reason,alternatives,evidence,projectionScope:options.scope});
 }
 return entries;
}

function projectCorrectionLedger(ledger:CorrectionLedgerEntry[],chunk:PlannedReprocessingChunk):{entries:CorrectionLedgerEntry[];total:number;omitted:number} {
 const ids=new Set(chunk.blocks.map(block=>block.id)),candidates:CorrectionLedgerEntry[]=[];
 for(const entry of ledger){
  // Repeated projection (request → audit) must preserve the exact task IDs.
  if(entry.targetBlockId){if(ids.has(entry.targetBlockId))candidates.push(entry);continue;}
  const local=entry.chunkEvidence?.find(location=>location.chunkIndex===chunk.index)?.evidence??entry.evidence.filter(ref=>ids.has(ref.blockId));
  const {chunkEvidence:_locations,projectionScope:_scope,...base}=entry;
  if(entry.projectionScope==='family'||!entry.projectionScope&&!entry.chunkEvidence){
   if(!local.some(ref=>ids.has(ref.blockId)))continue;
   const evidence=[...local];
   for(const ref of entry.evidence)if(evidence.length<8&&!evidence.some(known=>known.blockId===ref.blockId&&known.start===ref.start))evidence.push(ref);
   candidates.push({...base,evidence});continue;
  }
  const byBlock=new Map<string,CorrectionEvidence[]>();
  for(const ref of local){if(!ids.has(ref.blockId))continue;const refs=byBlock.get(ref.blockId)??[];byBlock.set(ref.blockId,refs);if(refs.length<4)refs.push(ref);}
  for(const [targetBlockId,refs] of byBlock){
   const evidence=[...refs];
   for(const ref of entry.evidence)if(evidence.length<refs.length+2&&ref.blockId!==targetBlockId&&!evidence.some(known=>known.blockId===ref.blockId&&known.start===ref.start))evidence.push(ref);
   candidates.push({...base,id:digest(entry.id+':block:'+targetBlockId),targetBlockId,evidence});
  }
 }
 let budget=12000;const entries:CorrectionLedgerEntry[]=[];
 for(const entry of candidates){const size=JSON.stringify(entry).length;if(size>budget||entries.length>=32)continue;budget-=size;entries.push(entry);}
 return {entries,total:candidates.length,omitted:candidates.length-entries.length};
}

export function correctionLedgerForChunk(ledger:CorrectionLedgerEntry[],chunk:PlannedReprocessingChunk):CorrectionLedgerEntry[] {return projectCorrectionLedger(ledger,chunk).entries;}
export function correctionLedgerCoverage(ledger:CorrectionLedgerEntry[],chunk:PlannedReprocessingChunk):{total:number;included:number;omitted:number} {
 const result=projectCorrectionLedger(ledger,chunk);return {total:result.total,included:result.entries.length,omitted:result.omitted};
}

/** Ledger completion is a diagnostic, not edit authority or a reason to discard useful output. */
export function auditCorrectionLedger(ledger:CorrectionLedgerEntry[],response:unknown,chunk:PlannedReprocessingChunk):string[] {
 const projection=projectCorrectionLedger(ledger,chunk),applicable=projection.entries,data=object(response),reviews=Array.isArray(data?.correctionReviews)?data.correctionReviews:[],diagnostics:string[]=[];
 const blocks=Array.isArray(data?.blocks)?data.blocks:[];
 if(projection.omitted)diagnostics.push(`Correction ledger coverage incomplete: ${projection.omitted} of ${projection.total} local tasks omitted by the bounded request budget; source review remains required.`);
 for(const entry of applicable){
  const matches=reviews.map(object).filter(review=>review?.id===entry.id);
  const review=matches[0];
  if(matches.length!==1||!review||!['proposed','retained','source_required'].includes(String(review.outcome))||typeof review.explanation!=='string'||!review.explanation.trim()||review.explanation.length>1500){diagnostics.push(`Correction ledger ${entry.id}: missing or invalid explicit outcome for ${entry.reason}`);continue;}
  if(review.outcome==='proposed'){
   const changed=entry.evidence.some(ref=>{
    if(entry.targetBlockId&&ref.blockId!==entry.targetBlockId)return false;
    const canonical=chunk.blocks.find(block=>block.id===ref.blockId),proposed=blocks.map(object).find(block=>block?.id===ref.blockId);
    if(!canonical||typeof proposed?.text!=='string')return false;
    if(entry.kind==='notation_conflict'){
     // Delimiter-only A4 → $A_4$ formatting cannot claim to resolve A1/A4.
     const families=new Set(entry.alternatives.flatMap(notation=>notationTokens(notation).map(token=>token.family)));
     const before=notationTokens(canonical.text).filter(token=>families.has(token.family)).map(token=>token.key),after=notationTokens(proposed.text).filter(token=>families.has(token.family)).map(token=>token.key);
     return JSON.stringify(before)!==JSON.stringify(after);
    }
    const formatting=(value:string)=>value.replace(/[$*`]/g,'').replace(/\s+/g,' ').trim();
    return formatting(canonical.text)!==formatting(proposed.text);
   });
   if(!changed){diagnostics.push(`Correction ledger ${entry.id}: marked proposed, but no corresponding substantive correction appears in its canonical block; inspect the retained reading.`);continue;}
  }
  diagnostics.push(`Correction ledger ${entry.id}: ${review.outcome} — ${review.explanation}`);
 }
 return diagnostics;
}
