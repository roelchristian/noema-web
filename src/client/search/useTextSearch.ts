import {useEffect, useState} from 'react';
import type {TextSearchResult, TextSearchScope} from '../../shared/text-search';
import {api} from '../api';
interface TextSearchState {vault: string; query: string; refreshKey: unknown; scopeKey: string; limit: number; results: TextSearchResult[]; hasMore: boolean; loading: boolean; error: string}
/** Local text retrieval follows saved metadata changes, independently of semantic search. */
export function useTextSearch(vault: string, query: string, refreshKey: unknown = '', scope?: TextSearchScope, requestedLimit = 100) {
  const term = query.trim();
  const scopeKey = scope ? JSON.stringify({includeArchived:scope.includeArchived,all:scope.all,pageIds: [...scope.pageIds].sort(), entityIds: [...scope.entityIds].sort()}) : '';
  const limit = Math.min(10000, Math.max(1, Math.floor(requestedLimit) || 100));
  const [state, setState] = useState<TextSearchState>({vault: '', query: '', refreshKey: '', scopeKey: '', limit, results: [], hasMore: false, loading: false, error: ''});
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setState({vault, query: term, refreshKey, scopeKey, limit, results: [], hasMore: false, loading: !!term, error: ''});
    if (!term) return () => {active = false; controller.abort();};
    const timer = setTimeout(() => {
      void api.textSearch(vault, term, controller.signal, scopeKey ? JSON.parse(scopeKey) as TextSearchScope : undefined, limit).then(result => {
        if (active) setState({vault, query: term, refreshKey, scopeKey, limit, ...result, loading: false, error: ''});
      }).catch(error => {
        if (active && !controller.signal.aborted) setState({vault, query: term, refreshKey, scopeKey, limit, results: [], hasMore: false, loading: false, error: error instanceof Error ? error.message : String(error)});
      });
    }, 100);
    return () => {active = false; clearTimeout(timer); controller.abort();};
  }, [vault, term, refreshKey, scopeKey, limit]);
  return state.vault === vault && state.query === term && state.refreshKey === refreshKey && state.scopeKey === scopeKey && state.limit === limit ? state : {results: [], hasMore: false, loading: !!term, error: ''};
}
