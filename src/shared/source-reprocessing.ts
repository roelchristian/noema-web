import type {SourceDocument,SourceDocumentRange} from './source-document.js';
export type ReprocessingStatus='queued'|'running'|'completed'|'failed'|'interrupted';
export interface SourceEditorialPatch {
 id:string; nodeIds:string[]; range:SourceDocumentRange; original:string; replacement:string;
 category:'ocr'|'line_breaks'|'footnote'|'apparatus'|'metadata'|'citation'|'math'|'formatting';
 reason:string;riskReasons?:string[];confidence:number; decision:'pending'|'accepted'|'rejected'; userReplacement?:string;
}
export interface SourceReprocessingReport {
 promptVersion:string;model:string;reasoningEffort:'none'|'medium';startedAt:string|null;finishedAt:string|null;durationMs:number|null;
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
