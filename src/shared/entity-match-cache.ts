import type { AmbiguousEntityMatch } from './auto-entities.js';
export interface EntityReviewItem extends AmbiguousEntityMatch {
  blockId: string; row?: number; col?: number; start: number; end: number;
}
export interface EntityMatchCache {revision: number; key: string; matches: EntityReviewItem[]}
