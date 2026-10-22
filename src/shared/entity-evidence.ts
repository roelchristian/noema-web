import type {SourceReference} from './domain.js';
export type EntitySourceEvidenceReason='citation'|'source-mention'|'reading-note'|'highlight';
export interface EntitySourcePassage {
 id:string;reference:SourceReference;reason:EntitySourceEvidenceReason;reasons:EntitySourceEvidenceReason[];
 pageIds:string[];heading?:string;stale:boolean;excerptTruncated?:boolean;
}
export interface EntitySourceEvidenceGroup {sourceId:string;sourceName:string;passages:EntitySourcePassage[]}
export interface EntityEvidence {groups:EntitySourceEvidenceGroup[];hasMore:boolean;nextOffset?:number;/** Discovery reached a safety cap; narrow the source search to explore further. */truncated:boolean}
