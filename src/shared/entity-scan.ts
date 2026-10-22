import { isEntityTaggingText, type EntityInput, type EntityType, type Page, type Segment, type Entity } from './domain.js';
export interface EntitySuggestion extends EntityInput {
  proposedSubtypeIds?: string[];
  linkedOccurrences?:EvidenceAnchor[]; id: string; evidenceAnchor?: EvidenceAnchor; evidence: string; reason: string; existingId: string | null;
  status: 'pending' | 'accepted' | 'rejected';
}
export interface EntitySuggestionEdit { saveAliases?:boolean; additionalOccurrences?:EvidenceAnchor[]; approveSubtypeIds?:string[]; domainIds?:string[]; id: string; name: string; aliases?:string[]; type: EntityType; subtypes: string[]; existingId: string | null }
export interface SubtypeSuggestion { id: string; name: string; type: EntityType; status: 'pending' | 'accepted' | 'rejected'; resolvedId?: string }
export interface EvidenceAnchor {blockId:string; row?:number; col?:number; start:number; end:number}
export interface EntityTextRun extends EvidenceAnchor {runId:string; text:string}
export const ENTITY_SCAN_BATCH_SIZE=25;
export interface EntityScanContinuation {
  token:string;
  cursor:EvidenceAnchor;
  excluded:Pick<EntitySuggestion,'name'|'type'|'aliases'|'existingId'>[];
}
export interface EntityScan { contextKey?:string; continuation?:EntityScanContinuation; batchCount?:number; subtypeSuggestions?: SubtypeSuggestion[]; id: string; revision: number; suggestions: EntitySuggestion[] }
export interface EntityReview { schema?: import('./entity-schema.js').EntitySchema; page: Page; scan: EntityScan; entities: Entity[] }

/** Eligible text runs with occurrence coordinates, preserving protected boundaries. */
export function entityTextRuns(page:Pick<Page,'blocks'>):EntityTextRun[] {
  const runs:EntityTextRun[]=[];
  function collect(segments:Segment[],blockId:string,row?:number,col?:number) {
    let offset=0,run:EntityTextRun|undefined;
    for(const segment of segments) {
      const text=segment.text ?? segment.mentionText ?? '';
      if(isEntityTaggingText(segment)) {
        if(!run) {run={blockId,...(row===undefined?{}:{row,col}),start:offset,end:offset,runId:JSON.stringify([blockId,row??null,col??null,offset]),text:''};runs.push(run);}
        run.text+=text;run.end=offset+text.length;
      } else run=undefined;
      offset+=text.length;
    }
  }
  for(const block of page.blocks) {
    if(['code','divider','math','image'].includes(block.type))continue;
    if(block.type==='table'||block.type==='columns')block.rows?.forEach((row,r)=>row.forEach((cell,c)=>collect(cell,block.id,r,c)));
    else collect(block.content,block.id);
  }
  return runs;
}
const evidencePattern=(evidence:string)=>new RegExp(evidence.trim().split(/\s+/u).map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+'),'gu');
/** Model offsets are hints: recover a unique quote only inside its supplied eligible run. */
export function locateRunEvidence(run:EntityTextRun,evidence:string,evidenceStart:number):EvidenceAnchor|null {
  if(!evidence.trim())return null;
  const matches=[...run.text.matchAll(evidencePattern(evidence))];
  const match=matches.find(match=>match.index===evidenceStart)??(matches.length===1?matches[0]:undefined);
  return match?{blockId:run.blockId,...(run.row===undefined?{}:{row:run.row,col:run.col}),start:run.start+match.index!,end:run.start+match.index!+match[0].length}:null;
}
/** Legacy unanchored evidence is safe only when it identifies exactly one occurrence. */
export function locateEvidence(page:Pick<Page,'blocks'>,evidence:string,anchor?:EvidenceAnchor):EvidenceAnchor|null {
  if(!evidence.trim())return null;
  const found:EvidenceAnchor[]=[];
  for(const run of entityTextRuns(page)) {
    if(anchor&&(run.blockId!==anchor.blockId||run.row!==anchor.row||run.col!==anchor.col))continue;
    for(const match of run.text.matchAll(evidencePattern(evidence))) {
      const candidate={blockId:run.blockId,...(run.row===undefined?{}:{row:run.row,col:run.col}),start:run.start+match.index!,end:run.start+match.index!+match[0].length};
      if(!anchor||(candidate.start===anchor.start&&candidate.end===anchor.end))found.push(candidate);
    }
  }
  return found.length===1?found[0]!:null;
}
/** Insert only into the validated occurrence; formulas, exclusions and mentions survive. */
export function mentionEvidence(page:Page,evidence:string,entityId:string,anchor?:EvidenceAnchor,occurrenceOnly=false):Page|null {
  const target=locateEvidence(page,evidence,anchor);
  if(!target)return null;
  function replace(segments:Segment[]):Segment[] {
    const output:Segment[]=[];let offset=0,inserted=false,mention='';
    for(const segment of segments) {
      const text=segment.text??segment.mentionText??'',end=offset+text.length;
      if(end<=target!.start||offset>=target!.end)output.push(segment);
      else {
        if(!isEntityTaggingText(segment))return segments;
        if(offset<target!.start)output.push({...segment,text:text.slice(0,target!.start-offset)});
        mention+=text.slice(Math.max(0,target!.start-offset),Math.min(text.length,target!.end-offset));
        if(!inserted){output.push({entityId,mentionText:'',...(occurrenceOnly?{skipAutoTag:true}:{})});inserted=true;}
        if(end>target!.end)output.push({...segment,text:text.slice(target!.end-offset)});
      }
      offset=end;
    }
    const insertedSegment=output.find(segment=>segment.entityId===entityId&&segment.mentionText==='');
    if(insertedSegment)insertedSegment.mentionText=mention;
    return output;
  }
  const blocks=page.blocks.map(block=>block.id!==target.blockId?block:target.row===undefined?{...block,content:replace(block.content)}:{...block,rows:block.rows?.map((row,r)=>r!==target.row?row:row.map((cell,c)=>c!==target.col?cell:replace(cell)))});
  return {...page,blocks};
}

export type EntityScanEvent={type:'progress';scan:EntityScan}|{type:'completed';scan:EntityScan}|{type:'error';message:string};

/** Local context uses absolute cell/block offsets, including protected segments. */
export function evidenceContext(page:Pick<Page,'blocks'>,anchor:EvidenceAnchor|undefined,radius=100) {
  if(!anchor)return null;
  const index=page.blocks.findIndex(block=>block.id===anchor.blockId),block=page.blocks[index];
  if(!block)return null;
  const segments=anchor.row===undefined?block.content:block.rows?.[anchor.row]?.[anchor.col!];
  if(!segments)return null;
  const text=segments.map(segment=>segment.text??segment.mentionText??'').join('');
  if(anchor.start<0||anchor.end>text.length||anchor.start>=anchor.end)return null;
  const start=Math.max(0,anchor.start-radius),end=Math.min(text.length,anchor.end+radius);
  return {before:(start?'…':'')+text.slice(start,anchor.start),match:text.slice(anchor.start,anchor.end),after:text.slice(anchor.end,end)+(end<text.length?'…':''),text,label:`Block ${index+1} · ${block.type}${anchor.row===undefined?'':` · Row ${anchor.row+1}, column ${anchor.col!+1}`} · offsets ${anchor.start}–${anchor.end}`};
}

export const anchorKey=(anchor:EvidenceAnchor)=>JSON.stringify([anchor.blockId,anchor.row??null,anchor.col??null,anchor.start,anchor.end]);
/** Exact phrase occurrences only, within eligible runs and word boundaries. */
export function evidenceOccurrences(page:Pick<Page,'blocks'>,evidence:string):EvidenceAnchor[] {
  if(!evidence.trim())return [];
  return entityTextRuns(page).flatMap(run=>[...run.text.matchAll(evidencePattern(evidence))].flatMap(match=>{
    const start=match.index!,end=start+match[0].length;
    if(/[\p{L}\p{N}_]/u.test(run.text[start-1]??'')||/[\p{L}\p{N}_]/u.test(run.text[end]??''))return [];
    return [{blockId:run.blockId,...(run.row===undefined?{}:{row:run.row,col:run.col}),start:run.start+start,end:run.start+end}];
  }));
}
/** Exclusions persist through the editor's existing skipAutoTag contract. */
export function excludeEvidence(page:Page,anchor:EvidenceAnchor):Page {
  const split=(segments:Segment[])=>{let offset=0;return segments.flatMap(segment=>{
    const text=segment.text??segment.mentionText??'',start=offset;offset+=text.length;
    if(!isEntityTaggingText(segment)||offset<=anchor.start||start>=anchor.end)return [segment];
    const from=Math.max(0,anchor.start-start),to=Math.min(text.length,anchor.end-start);
    return [...(from?[{...segment,text:text.slice(0,from)}]:[]),{...segment,text:text.slice(from,to),skipAutoTag:true},...(to<text.length?[{...segment,text:text.slice(to)}]:[])];
  });};
  return {...page,blocks:page.blocks.map(block=>block.id!==anchor.blockId?block:anchor.row===undefined?{...block,content:split(block.content)}:{...block,rows:block.rows?.map((row,r)=>r!==anchor.row?row:row.map((cell,c)=>c!==anchor.col?cell:split(cell)))})};
}
