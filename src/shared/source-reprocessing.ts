/** One canonical original plus at most four editorial reading versions per source file. */
export const sourceRevisionLimit=5;
export const sourceEditorialRevisionLimit=sourceRevisionLimit-1;
import type {ReasoningEffort} from './intelligence.js';
import type {SourceDocument,SourceDocumentRange} from './source-document.js';
import type {SourceIngestionDocument} from './source-ingestion.js';
/** Recovery text belongs only to an explicitly accepted derivative, never original evidence. */
export interface SourceIngestionPageRecoveryDescriptor {
 version:1;page:number;patchId:string;extractionId:string;responseHash:string;
 insertion:{startOffset:number;endOffset:number;original:string};document:SourceIngestionDocument;
}
export type SourceAcceptanceMode='review_all'|'safe_formatting'|'balanced'|'minimal_review';
/** V2 depth is independent of the historical V1 acceptance modes. */
export type SourceProcessingDepth='light'|'balanced'|'deep';
export type SourceReviewPolicy='verified'|'review_all';
export interface SourceReprocessingConfiguration {
 architectureVersion?:1;
 depth:SourceProcessingDepth;reviewPolicy:SourceReviewPolicy;
 /** Request systematic notation reconstruction, including inline mathematical identifiers. */
 substantialMath?:boolean;
 evidence:{originalPages:boolean;ocr:boolean;allowExternalTransmission:boolean};
}
export const defaultSourceReprocessingConfiguration:SourceReprocessingConfiguration={depth:'balanced',reviewPolicy:'verified',substantialMath:false,evidence:{originalPages:false,ocr:false,allowExternalTransmission:false}};
export const sourceReprocessingEvidencePageBytes=2*1024*1024;
export const sourceReprocessingEvidenceRevisionBytes=24*1024*1024;
/** Original-source evidence is stored once per chunk, separately from model passes. */
export interface SourceReprocessingEvidenceSnapshot {
 version:1;hash:string;canonicalText:string;pageNumbers:number[];
 originalPages:{available:boolean;reason:string};ocr:{available:boolean;reason:string};
 independentlyVerified:false;externalTransmissionAllowed:boolean;diagnostics:string[];
 images?:{page:number;mimeType:'image/png';base64:string;sha256:string}[];
 pages?:{page:number;originalHash:string;admittedHash:string;imageHash:string;canonicalRanges?:{startOffset:number;endOffset:number}[];canonicalRegions?:{startOffset:number;endOffset:number;bounds:number[]}[];ocr?:{
  engine:string;version:string;configuration:string;independent:boolean;
  lines:{text:string;confidence:number;bounds:number[];alternatives:string[]}[];
  mapping:{startOffset:number;endOffset:number;lineIndex:number}[];
 }}[];
}
export interface SourceReprocessingChunk {
 revisionId:string;index:number;startOffset:number;endOffset:number;baseHash:string;evidenceHash:string;
 evidence?:SourceReprocessingEvidenceSnapshot;
 /** Local collection trust is deliberately excluded from hashed/provider evidence and revoked on import. */
 evidenceTrusted?:boolean;
 difficulty:'ordinary'|'difficult';difficultyReason:string|null;requiredPassCount:1|2|3;
 status:'pending'|'running'|'completed'|'failed'|'interrupted';
}
export interface SourceResponseAttempt extends SourceEditorialUsage {startedAt:string;finishedAt:string|null;error:string;outputTokenBudget:16000|32000|64000}
export interface SourceReprocessingPass extends SourceEditorialUsage {
 responseCode?:string;responseAttempts?:SourceResponseAttempt[];outputTokenBudget?:16000|32000|64000;
 revisionId:string;chunkIndex:number;index:1|2|3;
 status:'running'|'completed'|'failed'|'interrupted';
 kind:'clean'|'reconstruct'|'verify'|'resolve';
 model:string;reasoningEffort:ReasoningEffort;promptVersion:string;configuration:SourceReprocessingConfiguration;
 requestHash:string;result:string|null;validation:string[];startedAt:string;finishedAt:string|null;
 error:string|null;outcomeUncertain:boolean;
 failureKind?:'transport'|'invalid_output'|'validation'|'evidence'|'admission'|'response';
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
 autoAcceptance?:{policy:SourceAcceptanceMode|SourceReviewPolicy;validator:string;checks:string[];appliedAt:string};
 /** Append-only decision audit, including reversal and edited replacements. */
 decisionHistory?:{at:string;actor:'automatic'|'user';from:'pending'|'accepted'|'rejected';to:'pending'|'accepted'|'rejected';previousReplacement?:string;replacement?:string}[];
 id:string; nodeIds:string[]; range:SourceDocumentRange; original:string; replacement:string;
 category:'ocr'|'line_breaks'|'footnote'|'apparatus'|'metadata'|'citation'|'math'|'formatting';
 reason:string;riskReasons?:string[];confidence:number; decision:'pending'|'accepted'|'rejected'; userReplacement?:string;
}
export interface SourceReprocessingReport {
 stage?:'reconstructing'|'understanding'|'verifying'|'auditing';
 stageProgress?:{completed:number;total:number};
 coverage?:{firstPassCompleted:number;totalChunks:number;incompleteChunkIndexes:number[]};
 summaryValidation?:{contextPreserved?:boolean;state:'reviewing'|'completed'|'unavailable';issues:number;accepted:number;unresolved:number;diagnostics:string[]};
 contextHash?:string;
 documentAudit?:{version:1;candidateHash:string;contextHash?:string;findings:string[]};
 evidencePreparation?:{state:'collecting'|'completed';preparedChunks:number;totalChunks:number};
 /** Structured publication candidates are separate from editorial text patches. */
 metadata?:{modelEvidenceHash?:string;candidateCount:number;added:number;corroborated:number;requiresReview:number;cacheHit:boolean;evidenceHash:string};
 usageIncomplete?:boolean;excerpts?:SourceEditorialExcerpt[];sessionStartedAt?:string;sessionCompletedIndexes?:number[];errorCode?:string;
 promptVersion:string;model:string;reasoningEffort:ReasoningEffort;startedAt:string|null;finishedAt:string|null;durationMs:number|null;
 /** Completed excerpt indexes, including out-of-order successes. Missing means a legacy completed prefix. */
 completedChunkIndexes?:number[];concurrency?:number;
 chunksTotal:number;chunksCompleted:number;charactersTotal:number;charactersReviewed:number;
 inputTokens:number|null;outputTokens:number|null;reasoningTokens:number|null;cachedInputTokens:number|null;
 diagnostics:string[];validationDiagnostics?:string[];error:string|null;
}
export interface SourceReprocessingRevision {
 /** Initial ingestion repairs reuse decisions without starting an editorial generation job. */
 origin?:{kind:'ingestion';documentId:string;runId:string;repairIdentity?:string;pageRecovery?:SourceIngestionPageRecoveryDescriptor};
 /** Immutable source-local ordinal, assigned when queued; absent only in legacy archives. */
 versionNumber?:number;
 id:string;fileId:string;createdAt:string;updatedAt:string;status:ReprocessingStatus;instructions:string;
 pipelineVersion?:1|2;configuration?:SourceReprocessingConfiguration;
 furniture?:{id:string;startOffset:number;endOffset:number;page:number;text:string;kind?:'header'|'footer';hidden:boolean;reason:string}[];
 nodeLinks?:{originalNodeId:string;reprocessedNodeIds:string[]}[];
 acceptanceThreshold?:number;
 acceptanceMode?:SourceAcceptanceMode;
 baseHash:string;stale:boolean;patches:SourceEditorialPatch[];report:SourceReprocessingReport;
 original:{text:string;document:SourceDocument};
 reprocessed:{text:string;document:SourceDocument};
}
export type SourceReprocessingSummary=Omit<SourceReprocessingRevision,'original'|'reprocessed'|'patches'|'nodeLinks'|'furniture'> & {patchCount:number;pendingCount:number};
export interface SourceEditorialDecision {patchId:string;decision:'accepted'|'rejected'|'pending';replacement?:string}

/** Presentation and mapping needed to read a chosen version, without comparison evidence. */
export type SourceReadingRevision=Pick<SourceReprocessingRevision,'id'|'fileId'|'updatedAt'|'status'|'stale'|'nodeLinks'|'furniture'|'reprocessed'> & {
 original:{text:string};report:Pick<SourceReprocessingReport,'chunksCompleted'|'chunksTotal'>;
 patches:Pick<SourceEditorialPatch,'id'|'nodeIds'|'decision'>[];
};
export function sourceReadingPresentation(revision:SourceReprocessingRevision):SourceReadingRevision {
 const {id,fileId,updatedAt,status,stale,nodeLinks,furniture,reprocessed}=revision;
 return {id,fileId,updatedAt,status,stale,nodeLinks,furniture,reprocessed,original:{text:revision.original.text},report:{chunksCompleted:revision.report.chunksCompleted,chunksTotal:revision.report.chunksTotal},patches:revision.patches.filter(patch=>patch.decision==='accepted').map(({id,nodeIds,decision})=>({id,nodeIds,decision}))};
}
