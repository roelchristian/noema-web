/** Provider output is untrusted. Only local assembly assigns citation IDs and offsets. */
export const SOURCE_INGESTION_SCHEMA_VERSION=1 as const;
export const SOURCE_INGESTION_PROMPT_VERSION='pdf-transcription-1';
export const SOURCE_INGESTION_ASSEMBLY_VERSION=1;
export const SOURCE_INGESTION_MAX_CHARACTERS=16_000_000;
export type SourceIngestionRoute='local'|'openai'|'gemini';
export type SourceIngestionDepth='light'|'balanced'|'deep';
export type SourceIngestionReviewPolicy='verified'|'review-all';
export interface SourceIngestionOptions {
 route:SourceIngestionRoute;model:string|null;depth:SourceIngestionDepth;reviewPolicy:SourceIngestionReviewPolicy;
 containsMath:boolean;guidance:string;transmissionConsent:boolean;
 budget:{maxRequests:number;maxOutputTokens:number;maxCostUsd:number|null};
}
export type SourceIngestionCapability='transcription'|'structure'|'metadata'|'math'|'apparatus'|'synopsis'|'authors';
export type SourceIngestionCapabilityState='completed'|'pending'|'failed'|'not-requested'|'requires-review';
export type SourceIngestionCompletionLedger=Record<SourceIngestionCapability,{state:SourceIngestionCapabilityState;fingerprint:string}>;
export interface SourceIngestionMetadata {
 title:string|null;language:string|null;synopsis:string|null;
 contributors:{name:string;role:string;page:number;blockId:string|null}[];
 bibliographic:{field:string;value:string;page:number;blockId:string|null}[];
}
export interface SourceIngestionPage {
 number:number;printedLabel:string|null;role:'owned'|'context';state:'content'|'blank'|'image-only'|'unreadable';
 unresolved:{description:string;blockId:string|null}[];
}
export type SourceIngestionBlockKind='paragraph'|'heading'|'table'|'equation'|'figure'|'caption'|'footnote'|'list'|'blockquote'|'code'|'theorem'|'lemma'|'proposition'|'corollary'|'definition'|'proof'|'example'|'remark'|'bibliography'|'furniture';
export interface SourceIngestionBlock {
 id:string;page:number;order:number;kind:SourceIngestionBlockKind;text:string;headingLevel:number|null;
 continues:string|null;
 table:{rows:number;columns:number;cells:{row:number;column:number;rowSpan:number;columnSpan:number;text:string}[]}|null;
 uncertainty:string|null;
 /** Any model location is approximate, never native citation geometry. */
 location:{x:number;y:number;width:number;height:number;accuracy:'approximate'}|null;
}
export interface SourceIngestionRelation {
 kind:'heading-parent'|'statement-proof'|'footnote-callout'|'caption'|'table-continuation'|'bibliography'|'continuation';
 from:string;to:string;uncertain:boolean;
}
export interface SourceIngestionRepair {
 blockId:string;start:number;end:number;original:string;replacement:string;category:string;reason:string;
}
export interface SourceIngestionDocument {
 schemaVersion:1;metadata:SourceIngestionMetadata;pages:SourceIngestionPage[];blocks:SourceIngestionBlock[];
 relations:SourceIngestionRelation[];repairs:SourceIngestionRepair[];
}
export interface SourceIngestionProvenance {
 provider:'openai'|'gemini';requestedModel:string;returnedModel:string|null;schemaVersion:1;promptVersion:string;
 originalHash:string;admittedHash:string;transmittedHash:string;responseHash:string;
 coverage:'checked';independentEvidence:'not-checked'|'checked';userReviewed:boolean;
}
export interface SourceIngestionWindowPlan {index:number;ownedPages:number[];contextPages:number[];estimatedOutputTokens:number}
export type SourceIngestionRunState='pending'|'running'|'paused'|'failed'|'completed'|'cancelled'|'unknown';
export interface SourceProcessingRunView {
 id:string;fileId:string;mode:'ingestion';state:SourceIngestionRunState;
 stage:'preparation'|'upload'|'extraction'|'validation'|'repair'|'publication'|'indexing';
 provider:SourceIngestionRoute;model:string|null;pageCount:number;completedPages:number;completedWindows:number;totalWindows:number;
 activePages:number[];pendingReview:number;startedAt:string;updatedAt:string;
 error:string|null;warnings?:string[];canRetryOptional?:boolean;unknownOutcome:boolean;canResume:boolean;
}
