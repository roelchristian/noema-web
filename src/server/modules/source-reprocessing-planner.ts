import {createHash} from 'node:crypto';
import type {SourceDocument} from '../../shared/source-document.js';
import {utf16Boundary} from './source-reprocessing-patches.js';

export interface ReconstructionBlock {id:string;start:number;end:number;text:string}
export interface PlannedReprocessingChunk {index:number;start:number;end:number;blocks:ReconstructionBlock[];difficulty:'ordinary'|'difficult';difficultyReason:string}
/** Partition the exact snapshot, never normalized text; IDs are owned by Noema, not the model. */
export function planReprocessingChunks(text:string,document:SourceDocument,max=8000,adaptive=false):PlannedReprocessingChunk[]{
 if(!Number.isSafeInteger(max)||max<100||max>16000)throw new Error('Invalid reconstruction chunk limit.');
 const chunks:PlannedReprocessingChunk[]=[];
 for(let start=0;start<text.length;){
  const window=text.slice(start,start+max),signals=[...window.matchAll(/\$|\\(?:frac|begin|sum)|\[\^[^\]]+\]|\|[^\n]+\||[�]/g)].length;
  const limit=adaptive&&signals>=3?Math.max(100,Math.floor(max/2)):max;
  let end=Math.min(start+limit,text.length,...document.physical.pages.map(page=>page.range.startOffset).filter(at=>at>start));
  if(end<text.length){const paragraph=text.lastIndexOf('\n\n',end-1),line=text.lastIndexOf('\n',end-1);if(paragraph>start+limit/2)end=paragraph+2;else if(line>start+limit/2)end=line+1;while(end>start&&!utf16Boundary(text,end))end--;}
  if(end<=start)throw new Error('Cannot partition canonical reconstruction snapshot.');
  const blocks:ReconstructionBlock[]=[];let at=start;
  for(const match of text.slice(start,end).matchAll(/\n[ \t]*\r?\n/g)){
   const stop=start+match.index!+match[0].length;
   blocks.push(block(text,at,stop));at=stop;
  }
  if(at<end)blocks.push(block(text,at,end));
  const difficult=/\$|\\(?:frac|begin|sum)|\[\^[^\]]+\]|\|[^\n]+\||[�]/.test(text.slice(start,end));
  chunks.push({index:chunks.length,start,end,blocks,difficulty:difficult?'difficult':'ordinary',difficultyReason:difficult?'Mathematical notation, scholarly apparatus, tabular structure, or extraction uncertainty.':'No deterministic difficulty indicators.'});start=end;
 }
 return chunks;
}
function block(text:string,start:number,end:number):ReconstructionBlock{return {id:createHash('sha256').update(`${start}:${end}:${text.slice(start,end)}`).digest('hex').slice(0,24),start,end,text:text.slice(start,end)};}
