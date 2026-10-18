/** Local retrieval works independently of embedding availability or freshness. */
export interface TextSearchResult {
  id: string;
  kind: 'page' | 'entity';
  name: string;
  matchedIn: 'title' | 'page' | 'name' | 'alias';
  snippet: string;
  score: number;
}
export interface TextSearchScope {pageIds: string[]; entityIds: string[]}
export interface TextSearchResults {results: TextSearchResult[]; hasMore: boolean}
