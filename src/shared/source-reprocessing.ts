import type {ReasoningEffort} from './intelligence.js';
import type {SourceDocument,SourceDocumentRange} from './source-document.js';
export type ReprocessingStatus='queued'|'running'|'completed'|'failed'|'interrupted';
export interface SourceEditorialUsage {inputTokens:number|null;outputTokens:number|null;reasoningTokens:number|null;cachedInputTokens:number|null}
export interface SourceEditorialAttempt extends SourceEditorialUsage {
 startedAt:string;durationMs:number;errorCode?:string;error?:string;outcomeUncertain?:boolean;
}
export interface SourceEditorialExcerpt extends SourceEditorialUsage {
 index:number;startOffset:number;endOffset:number;startPage:number|null;endPage:number|null;
 status:'pending'|'running'|'completed'|'failed'|'interrupted';attempts:number;durationMs:number;
 lastAttemptAt?:string;errorCode?:string;error?:string;outcomeUncertain?:boolean;
 /** Recent attempt details are bounded; attempts and usage totals cover the full history. */
 history?:SourceEditorialAttempt[];
}
export interface SourceEditorialPatch {
 baseHash?:string;excerptIndex?:number;
 id:string; nodeIds:string[]; range:SourceDocumentRange; original:string; replacement:string;
 category:'ocr'|'line_breaks'|'footnote'|'apparatus'|'metadata'|'citation'|'math'|'formatting';
 reason:string;riskReasons?:string[];confidence:number; decision:'pending'|'accepted'|'rejected'; userReplacement?:string;
}
export interface SourceReprocessingReport {
 excerpts?:SourceEditorialExcerpt[];sessionStartedAt?:string;sessionCompletedIndexes?:number[];errorCode?:string;
 promptVersion:string;model:string;reasoningEffort:ReasoningEffort;startedAt:string|null;finishedAt:string|null;durationMs:number|null;
 /** Completed excerpt indexes, including out-of-order successes. Missing means a legacy completed prefix. */
 completedChunkIndexes?:number[];concurrency?:number;
 chunksTotal:number;chunksCompleted:number;charactersTotal:number;charactersReviewed:number;
 inputTokens:number|null;outputTokens:number|null;reasoningTokens:number|null;cachedInputTokens:number|null;
 diagnostics:string[];validationDiagnostics?:string[];error:string|null;
}
export interface SourceReprocessingRevision {
 id:string;fileId:string;createdAt:string;updatedAt:string;status:ReprocessingStatus;instructions:string;
 nodeLinks?:{originalNodeId:string;reprocessedNodeIds:string[]}[];
 acceptanceThreshold?:number;
 acceptanceMode?:'review_all'|'safe_formatting';
 baseHash:string;stale:boolean;patches:SourceEditorialPatch[];report:SourceReprocessingReport;
 original:{text:string;document:SourceDocument};
 reprocessed:{text:string;document:SourceDocument};
}
export type SourceReprocessingSummary=Omit<SourceReprocessingRevision,'original'|'reprocessed'|'patches'|'nodeLinks'> & {patchCount:number;pendingCount:number};
export interface SourceEditorialDecision {patchId:string;decision:'accepted'|'rejected'|'pending';replacement?:string}
