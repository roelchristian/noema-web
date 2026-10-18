import type {SourceReference} from './domain.js';
export const embeddingModel = 'text-embedding-3-small';
export const embeddingDimensions = 1536;
export const embeddingMaxBytes = 8000;
export interface EmbeddingSettings { automatic: boolean; minCharacters: number }
export type EmbeddingJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'interrupted';
export interface EmbeddingJob {
 id: string; pageId: string | null; sourceId?: string | null; passageId?: string; fileId?: string | null; generationId?: string; contentHash?: string; title: string; status: EmbeddingJobStatus; reason: string;
 attempts: number; createdAt: string; startedAt: string | null; finishedAt: string | null;
 nextAttemptAt: string; error: string | null; tokens: number | null;
}
export type PassageIndexingStatus = 'preparing' | 'indexing' | 'partial' | 'ready' | 'failed' | 'disabled';
export interface EmbeddingNote { pageId: string; kind?: 'page' | 'entity'; sourceId?: string | null; title: string; eligible: boolean; reason: string; indexedPassages?: number; totalPassages?: number; failedPassages?: number; pendingPassages?: number; indexingStatus?: PassageIndexingStatus; state: 'missing' | 'stale' | 'indexed' | 'partial' | 'ineligible' }
export interface EmbeddingStatus {
 settings: EmbeddingSettings; model: string; dimensions: number; maxBytes: number; configured: boolean;
 counts: {eligible: number; indexed: number; missing: number; stale: number; ineligible: number; partial: number; queued: number; running: number; failed: number};
 jobs: EmbeddingJob[]; notes: EmbeddingNote[];
}
export interface SemanticSearchResult {reference?: SourceReference; passageId?: string; id: string; kind?: 'page' | 'entity'; title: string; snippet: string; score: number; updated_at: string}
export interface SemanticSearchResults { results: SemanticSearchResult[]; model: string }
