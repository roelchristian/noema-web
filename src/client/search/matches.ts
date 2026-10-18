import type {SemanticSearchResult} from '../../shared/embeddings';
import type {TextSearchResult} from '../../shared/text-search';
interface SearchItem {id: string; kind: 'page' | 'entity' | 'folder'; name: string; aliases?: string[]}
/** Match only supplied, scoped items. Local text matches precede related semantic results. */
export function combinedMatches<T extends SearchItem>(items: T[], query: string, semantic: SemanticSearchResult[], textResults: TextSearchResult[] = []): T[] {
  const term = query.trim().toLowerCase();
  const unique = Array.from(new Map(items.map(item => [item.kind + ':' + item.id, item])).values());
  if (!term) return unique;
  const scores = new Map(semantic.map(result => [result.id, result.score]));
  const retrieved = new Map(textResults.map(result => [result.kind + ':' + result.id, result]));
  const immediate = (item: T) => item.name.toLowerCase().includes(term) || !!item.aliases?.some(alias => alias.toLowerCase().includes(term));
  const text = (item: T) => immediate(item) || retrieved.has(item.kind + ':' + item.id);
  return unique.filter(item => text(item) || item.kind === 'page' && scores.has(item.id)).sort((a, b) =>
    Number(text(b)) - Number(text(a)) || Number(immediate(b)) - Number(immediate(a)) ||
    (text(a) ? (retrieved.get(b.kind + ':' + b.id)?.score ?? 0) - (retrieved.get(a.kind + ':' + a.id)?.score ?? 0) : (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1)));
}
