import type {SourceReference} from './domain.js';
export const embeddingModel = 'text-embedding-3-small';
export const embeddingDimensions = 1536;
export const embeddingMaxBytes = 8000;
export interface PageIndexPolicy {smallTokens:number;mediumTokens:number;targetTokens:number;overlapTokens:number;hysteresisTokens:number;debounceMs:number}
export const defaultPageIndexPolicy:PageIndexPolicy={smallTokens:800,mediumTokens:3000,targetTokens:700,overlapTokens:80,hysteresisTokens:100,debounceMs:5000};
export function isPageIndexPolicy(value:unknown):value is PageIndexPolicy {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const policy=value as PageIndexPolicy;
 if(Object.keys(value).some(key=>!(key in defaultPageIndexPolicy))||Object.keys(defaultPageIndexPolicy).some(key=>!Number.isInteger(policy[key as keyof PageIndexPolicy])))return false;
 return policy.smallTokens>=100&&policy.smallTokens<=4000&&policy.mediumTokens>policy.smallTokens&&policy.mediumTokens<=50000&&policy.targetTokens>=100&&policy.targetTokens<=2000&&policy.overlapTokens>=0&&policy.overlapTokens<policy.targetTokens/2&&policy.hysteresisTokens>=0&&policy.hysteresisTokens<policy.smallTokens/2&&policy.debounceMs>=5000&&policy.debounceMs<=15000;
}
export interface PageReference {pageId:string;segmentId:string;revision:number;projectionHash:string;blockIds:string[];startOffset:number;endOffset:number;excerpt:string}
export interface EmbeddingSettings { automatic: boolean; minCharacters: number; pagePolicy?:PageIndexPolicy }
export type EmbeddingJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'interrupted';
export interface EmbeddingJob {
 segmentId?:string; id: string; pageId: string | null; sourceId?: string | null; passageId?: string; fileId?: string | null; generationId?: string; contentHash?: string; title: string; status: EmbeddingJobStatus; reason: string;
 attempts: number; createdAt: string; startedAt: string | null; finishedAt: string | null;
 nextAttemptAt: string; error: string | null; tokens: number | null;
}
export type PassageIndexingStatus = 'preparing' | 'indexing' | 'partial' | 'ready' | 'failed' | 'disabled';
export interface EmbeddingNote { pageId: string; kind?: 'page' | 'entity'; sourceId?: string | null; title: string; eligible: boolean; reason: string; indexedPassages?: number; totalPassages?: number; failedPassages?: number; pendingPassages?: number; indexingStatus?: PassageIndexingStatus; strategy?:'whole'|'sections'|'passages'; state: 'missing' | 'stale' | 'indexed' | 'partial' | 'ineligible' }
export interface EmbeddingStatus {
 settings: EmbeddingSettings; model: string; dimensions: number; maxBytes: number; configured: boolean;
 counts: {eligible: number; indexed: number; missing: number; stale: number; ineligible: number; partial: number; queued: number; running: number; failed: number};
 jobs: EmbeddingJob[]; notes: EmbeddingNote[];
}
export interface SemanticSearchResult {pageReference?:PageReference;reference?: SourceReference; passageId?: string; id: string; kind?: 'page' | 'entity'; title: string; snippet: string; score: number; updated_at: string}
export interface SemanticSearchResults { results: SemanticSearchResult[]; model: string }

export interface SuggestedSource { sourceId:string; score:number; excerpt:string }
export interface RelatedNotesState { notes:RelatedNote[]; pending:boolean; retainedPageIds:string[] }
export interface RelatedNote { pageId:string; title:string; score:number; excerpt:string }
