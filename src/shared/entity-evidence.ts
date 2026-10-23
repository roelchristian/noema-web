import type {SourceReference} from './domain.js';
export type EntitySourceEvidenceReason='citation'|'source-mention'|'reading-note'|'highlight';
export interface EntitySourcePassage {
 id:string;reference:SourceReference;reason:EntitySourceEvidenceReason;reasons:EntitySourceEvidenceReason[];
 pageIds:string[];heading?:string;stale:boolean;excerptTruncated?:boolean;
}
export interface EntitySourceEvidenceGroup {sourceId:string;sourceName:string;passages:EntitySourcePassage[]}
export interface EntityEvidence {groups:EntitySourceEvidenceGroup[];hasMore:boolean;nextOffset?:number;/** Discovery reached a safety cap; narrow the source search to explore further. */truncated:boolean}
/** Preview priority describes provenance and navigability, not truth or claim support. */
export function sourcePreviewRank(passage: EntitySourcePassage): number {
 const order: Record<EntitySourceEvidenceReason, number> = {citation:0,'reading-note':1,highlight:2,'source-mention':3};
 return (passage.stale ? 10 : 0) + Math.min(...(passage.reasons.length ? passage.reasons : [passage.reason]).map(reason=>order[reason]));
}
