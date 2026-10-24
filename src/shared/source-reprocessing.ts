import type {ReasoningEffort} from './intelligence.js';
import type {SourceDocument,SourceDocumentRange} from './source-document.js';
export type SourceAcceptanceMode='review_all'|'safe_formatting'|'balanced'|'minimal_review';
/** V2 depth is independent of the historical V1 acceptance modes. */
export type SourceProcessingDepth='light'|'balanced'|'deep';
export type SourceReviewPolicy='verified'|'review_all';
export interface SourceReprocessingConfiguration {
 depth:SourceProcessingDepth;reviewPolicy:SourceReviewPolicy;
 evidence:{originalPages:boolean;ocr:boolean;allowExternalTransmission:boolean};
}
export const defaultSourceReprocessingConfiguration:SourceReprocessingConfiguration={depth:'balanced',reviewPolicy:'verified',evidence:{originalPages:false,ocr:false,allowExternalTransmission:false}};
export interface SourceReprocessingChunk {
 revisionId:string;index:number;startOffset:number;endOffset:number;baseHash:string;evidenceHash:string;
 difficulty:'ordinary'|'difficult';difficultyReason:string|null;requiredPassCount:1|2|3;
 status:'pending'|'running'|'completed'|'failed'|'interrupted';
}
export interface SourceReprocessingPass extends SourceEditorialUsage {
 revisionId:string;chunkIndex:number;index:1|2|3;
 status:'running'|'completed'|'failed'|'interrupted';
 kind:'clean'|'reconstruct'|'verify'|'resolve';
 model:string;reasoningEffort:ReasoningEffort;promptVersion:string;configuration:SourceReprocessingConfiguration;
 requestHash:string;result:string|null;validation:string[];startedAt:string;finishedAt:string|null;
 error:string|null;outcomeUncertain:boolean;
}
export type ReprocessingStatus='queued'|'running'|'completed'|'failed'|'interrupted';
export interface SourceEditorialUsage {inputTokens:number|null;outputTokens:number|null;reasoningTokens:number|null;cachedInputTokens:number|null}
export interface SourceEditorialAttempt extends SourceEditorialUsage {
 model?:string;reasoningEffort?:ReasoningEffort;startedAt:string;durationMs:number;errorCode?:string;error?:string;outcomeUncertain?:boolean;
}
export interface SourceEditorialExcerpt extends SourceEditorialUsage {
 index:number;startOffset:number;endOffset:number;startPage:number|null;endPage:number|null;
 passesCompleted?:number;requiredPassCount?:1|2|3;activePass?:1|2|3;difficultyReason?:string;
 status:'pending'|'running'|'completed'|'failed'|'interrupted';attempts:number;durationMs:number;
 lastAttemptAt?:string;errorCode?:string;error?:string;outcomeUncertain?:boolean;
 /** Recent attempt details are bounded; attempts and usage totals cover the full history. */
 history?:SourceEditorialAttempt[];
}
export interface SourceEditorialPatch {
 baseHash?:string;excerptIndex?:number;
 patchGroupId?:string;presentation?:{kind:'page_furniture';hidden:boolean};
 /** Deterministic validation record; never populated from the model response. */
 autoAcceptance?:{policy:SourceAcceptanceMode;validator:string;checks:string[];appliedAt:string};
 /** Append-only decision audit, including reversal and edited replacements. */
 decisionHistory?:{at:string;actor:'automatic'|'user';from:'pending'|'accepted'|'rejected';to:'pending'|'accepted'|'rejected';previousReplacement?:string;replacement?:string}[];
 id:string; nodeIds:string[]; range:SourceDocumentRange; original:string; replacement:string;
 category:'ocr'|'line_breaks'|'footnote'|'apparatus'|'metadata'|'citation'|'math'|'formatting';
 reason:string;riskReasons?:string[];confidence:number; decision:'pending'|'accepted'|'rejected'; userReplacement?:string;
}
export interface SourceReprocessingReport {
 usageIncomplete?:boolean;excerpts?:SourceEditorialExcerpt[];sessionStartedAt?:string;sessionCompletedIndexes?:number[];errorCode?:string;
 promptVersion:string;model:string;reasoningEffort:ReasoningEffort;startedAt:string|null;finishedAt:string|null;durationMs:number|null;
 /** Completed excerpt indexes, including out-of-order successes. Missing means a legacy completed prefix. */
 completedChunkIndexes?:number[];concurrency?:number;
 chunksTotal:number;chunksCompleted:number;charactersTotal:number;charactersReviewed:number;
 inputTokens:number|null;outputTokens:number|null;reasoningTokens:number|null;cachedInputTokens:number|null;
 diagnostics:string[];validationDiagnostics?:string[];error:string|null;
}
export interface SourceReprocessingRevision {
 id:string;fileId:string;createdAt:string;updatedAt:string;status:ReprocessingStatus;instructions:string;
 pipelineVersion?:1|2;configuration?:SourceReprocessingConfiguration;
 nodeLinks?:{originalNodeId:string;reprocessedNodeIds:string[]}[];
 acceptanceThreshold?:number;
 acceptanceMode?:SourceAcceptanceMode;
 baseHash:string;stale:boolean;patches:SourceEditorialPatch[];report:SourceReprocessingReport;
 original:{text:string;document:SourceDocument};
 reprocessed:{text:string;document:SourceDocument};
}
export type SourceReprocessingSummary=Omit<SourceReprocessingRevision,'original'|'reprocessed'|'patches'|'nodeLinks'> & {patchCount:number;pendingCount:number};
export interface SourceEditorialDecision {patchId:string;decision:'accepted'|'rejected'|'pending';replacement?:string}
