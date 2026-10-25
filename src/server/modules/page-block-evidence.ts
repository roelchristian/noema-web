import {createHash} from 'node:crypto';
import type {Page} from '../../shared/domain.js';
import {isAIExplanation} from '../../shared/semantic-blocks.js';
import {summaryInput} from './summary-content.js';

type EvidencePage=Pick<Page,'title'|'blocks'>;
type ResolveName=(id:string)=>string|undefined;
export interface BlockEvidence {version:1;blocks:{id:string;fingerprint:string;heading:boolean}[]}
export interface ChangedPassage {key:string;kind:'added'|'modified'|'moved';text:string;context:string[]}
export interface ChangedBlockEvidence {
  status:'known'|'legacy_unknown';passages:ChangedPassage[];deletedBlockIds:string[];
  counts:{added:number;modified:number;moved:number;deleted:number};changedCharacters:number;
}
const normalize=(text:string)=>text.normalize('NFC').replace(/\s+/gu,' ').trim();
function sourceBlocks(page:EvidencePage,resolve:ResolveName) {
  return page.blocks.filter(block=>!isAIExplanation(block)).map(block=>({id:block.id,
    text:summaryInput({title:'',blocks:[block]},resolve,false).trim(),heading:block.type==='heading1'||block.type==='heading2'}));
}
export function blockEvidence(page:EvidencePage,resolve:ResolveName=()=>undefined):BlockEvidence {
  return {version:1,blocks:sourceBlocks(page,resolve).map(({id,text,heading})=>({id,heading,fingerprint:createHash('sha256').update(normalize(text)).digest('hex')}))};
}
export function validBlockEvidence(value:unknown):value is BlockEvidence {
  if(!value||typeof value!=='object')return false;
  const candidate=value as BlockEvidence;
  return candidate.version===1&&Array.isArray(candidate.blocks)&&candidate.blocks.every(block=>block&&typeof block.id==='string'&&typeof block.heading==='boolean'&&typeof block.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(block.fingerprint));
}
/** Longest increasing subsequence separates genuine moves from shifted indices after insertions/deletions. */
function stationaryIndices(indices:number[]) {
  const tails:number[]=[],positions:number[]=[],previous:number[]=Array(indices.length).fill(-1);
  indices.forEach((value,index)=>{let low=0,high=tails.length;while(low<high){const middle=(low+high)>>>1;if(tails[middle]!<value)low=middle+1;else high=middle;}
    if(low)previous[index]=positions[low-1]!;tails[low]=value;positions[low]=index;});
  const result=new Set<number>();let cursor=positions.at(-1)??-1;while(cursor>=0){result.add(cursor);cursor=previous[cursor]!;}return result;
}
export function changedBlockEvidence(page:EvidencePage,previous:unknown,resolve:ResolveName=()=>undefined):ChangedBlockEvidence {
  const empty:ChangedBlockEvidence={status:'legacy_unknown',passages:[],deletedBlockIds:[],counts:{added:0,modified:0,moved:0,deleted:0},changedCharacters:0};
  if(!validBlockEvidence(previous))return empty;
  const blocks=sourceBlocks(page,resolve),current=blockEvidence(page,resolve).blocks;
  const byId=new Map(previous.blocks.map((block,index)=>[block.id,{block,index}]));
  const matched=new Set<number>();
  const matches=current.map(block=>{const match=byId.get(block.id);if(match&&!matched.has(match.index)){matched.add(match.index);return match;}return undefined;});
  // If an editor regenerates IDs, consume equal fingerprints once, preserving repeated-text multiplicity.
  const available=new Map<string,number[]>();previous.blocks.forEach((block,index)=>{if(!matched.has(index)){const list=available.get(block.fingerprint)??[];list.push(index);available.set(block.fingerprint,list);}});
  current.forEach((block,index)=>{if(matches[index])return;const old=available.get(block.fingerprint)?.shift();if(old!==undefined){matched.add(old);matches[index]={block:previous.blocks[old]!,index:old};}});
  const surviving=matches.flatMap((match,index)=>match?[{index,old:match.index}]:[]),stationary=stationaryIndices(surviving.map(match=>match.old));
  const moved=new Set(surviving.filter((_,index)=>!stationary.has(index)).map(match=>match.index));
  const passages:ChangedPassage[]=[];let heading='';const counts={added:0,modified:0,moved:0,deleted:previous.blocks.length-matched.size};
  current.forEach((block,index)=>{
    if(blocks[index]!.heading)heading=blocks[index]!.text;
    const match=matches[index];const kind=!match?'added':match.block.fingerprint!==block.fingerprint?'modified':moved.has(index)?'moved':undefined;
    if(!kind)return;counts[kind]++;
    const context=[heading,blocks[index-1]?.text,blocks[index+1]?.text].filter((text):text is string=>!!text&&text!==blocks[index]!.text);
    passages.push({key:block.id,kind,text:blocks[index]!.text,context:[...new Set(context)]});
  });
  return {status:'known',passages,deletedBlockIds:previous.blocks.filter((_,index)=>!matched.has(index)).map(block=>block.id),counts,changedCharacters:passages.reduce((sum,passage)=>sum+passage.text.length,0)};
}
/** Combined calls examine the union of changes since each requested artifact's own generation. */
export function mergeChangedBlockEvidence(evidence:readonly ChangedBlockEvidence[]):ChangedBlockEvidence {
  const passages=[...new Map(evidence.flatMap(item=>item.passages).map(passage=>[passage.key,passage])).values()];
  const deletedBlockIds=[...new Set(evidence.flatMap(item=>item.deletedBlockIds))];
  return {status:evidence.some(item=>item.status==='legacy_unknown')?'legacy_unknown':'known',passages,deletedBlockIds,
    counts:{added:passages.filter(passage=>passage.kind==='added').length,modified:passages.filter(passage=>passage.kind==='modified').length,moved:passages.filter(passage=>passage.kind==='moved').length,deleted:deletedBlockIds.length},
    changedCharacters:passages.reduce((sum,passage)=>sum+passage.text.length,0)};
}
