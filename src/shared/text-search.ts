import type {PageReference} from './embeddings.js';
import type {SourceReference} from './domain.js';

/** Local retrieval works independently of embedding availability or freshness. */
export interface TextSearchResult {
  pageReference?:PageReference;
  id: string;
  kind: 'page' | 'entity';
  name: string;
  matchedIn: 'title' | 'page' | 'name' | 'alias' | 'source';
  reference?: SourceReference;
  passageId?: string;
  snippet: string;
  score: number;
}
export interface TextSearchScope {pageIds: string[]; entityIds: string[]}
export interface TextSearchResults {results: TextSearchResult[]; hasMore: boolean}
