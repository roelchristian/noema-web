import type {TextSearchResult, TextSearchScope} from '../../shared/text-search.js';
import {makeSearchSnippet} from '../../shared/search-snippets.js';
import {Store} from '../store.js';
import {setupTextSearchSchema} from '../text-search-schema.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';

interface PageRow {id: string; vault_id: string; title: string; blocks: string; deleted_at: string | null}
interface EntityRow {id: string; vault_id: string; name: string; aliases: string; mention_case: string}
interface MatchRow {id: string; kind: 'page' | 'entity'; name: string; nameHit: number; aliasHit: number; excerpt: string; relevance: number}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function arrayJSON(value: string): unknown[] {
  try {const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : [];} catch {return [];}
}
function bodyText(blocks: string, names: Map<string,string>): string {
  const segments = (value: unknown): string => Array.isArray(value) ? value.map(segment => {
    if (!object(segment)) return '';
    if (typeof segment.entityId === 'string') return typeof segment.mentionText === 'string' ? segment.mentionText : names.get(segment.entityId) ?? '';
    return typeof segment.text === 'string' ? segment.text : '';
  }).join('') : '';
  return arrayJSON(blocks).map(block => {
    if (!object(block)) return '';
    const content = (block.type === 'table' || block.type === 'columns') && Array.isArray(block.rows)
      ? block.rows.map(row => Array.isArray(row) ? row.map(segments).join(' \n ') : '').join('\n')
      : segments(block.content);
    return block.type === 'image' && typeof block.alt === 'string' ? `${content}\n${block.alt}` : content;
  }).join('\n');
}
function scopeValue(input: unknown): TextSearchScope | undefined {
  if (input === undefined) return undefined;
  if (!object(input)) throw new HttpError(400, 'Choose a valid search scope.');
  function ids(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > 10000 || value.some(id => typeof id !== 'string' || !id || id.length > 200)) throw new HttpError(400, 'Choose up to 10,000 note or entity IDs.');
    return [...new Set(value as string[])];
  }
  return {pageIds: ids(input.pageIds), entityIds: ids(input.entityIds)};
}

/** Saved-content lexical search. Triggers make every writer enqueue index work;
 * synchronization and the subsequent query share one SQLite transaction. */
export class TextSearch {
  constructor(private store: Store, private vaults: Vaults) {setupTextSearchSchema(store.db);}
  private remove(kind: 'page' | 'entity', id: string) {
    this.store.run('DELETE FROM text_search_fts WHERE rowid IN (SELECT rowid FROM text_search_documents WHERE kind=? AND id=?)', kind, id);
    this.store.run('DELETE FROM text_search_documents WHERE kind=? AND id=?', kind, id);
  }
  private put(kind: 'page' | 'entity', id: string, vault: string, name: string, body: string, aliases: string) {
    this.remove(kind, id);
    const result = this.store.run('INSERT INTO text_search_documents(kind,id,vault_id) VALUES (?,?,?)', kind, id, vault);
    this.store.run('INSERT INTO text_search_fts(rowid,name,body,aliases) VALUES (?,?,?,?)', result.lastInsertRowid, name, body, aliases);
  }
  private synchronize(vault: string) {
    const changes = this.store.all<{kind: 'page' | 'entity' | 'vault-pages'; id: string}>('SELECT kind,id FROM text_search_dirty WHERE vault_id=?', vault);
    if (!changes.length) return;
    const entities = this.store.all<EntityRow>('SELECT id,vault_id,name,aliases,mention_case FROM entities WHERE vault_id=?', vault);
    const entityById = new Map(entities.map(entity => [entity.id,entity]));
    const names = new Map(entities.map(entity => [entity.id,entity.mention_case === 'lowercase' ? entity.name.toLowerCase() : entity.name]));
    const pageIds = new Set(changes.filter(change => change.kind === 'page').map(change => change.id));
    if (changes.some(change => change.kind === 'vault-pages')) {
      for (const page of this.store.all<{id: string}>('SELECT id FROM pages WHERE vault_id=? AND deleted_at IS NULL', vault)) pageIds.add(page.id);
    }
    for (const change of changes) if (change.kind === 'entity') {
      const entity = entityById.get(change.id);
      if (!entity) this.remove('entity', change.id);
      else this.put('entity', entity.id, vault, entity.name, '', arrayJSON(entity.aliases).filter(alias => typeof alias === 'string').join('\n'));
    }
    for (const id of pageIds) {
      const page = this.store.get<PageRow>('SELECT id,vault_id,title,blocks,deleted_at FROM pages WHERE id=? AND vault_id=?', id, vault);
      if (!page || page.deleted_at !== null) this.remove('page', id);
      else this.put('page', page.id, vault, page.title, bodyText(page.blocks,names), '');
    }
    this.store.run('DELETE FROM text_search_dirty WHERE vault_id=?', vault);
  }
  search(vault: string, query: unknown, limit: unknown = 100, requestedScope?: unknown): {results: TextSearchResult[]; hasMore: boolean} {
    this.vaults.requireOpen(vault);
    if (typeof query !== 'string' || query.length > 2000) throw new HttpError(400, 'Use a search query up to 2,000 characters.');
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10000) throw new HttpError(400, 'Choose a search limit between 1 and 10,000.');
    const scope = scopeValue(requestedScope);
    // User punctuation and FTS operators never enter the query grammar. Every
    // Unicode token is quoted, with prefix completion on the final token only.
    const tokens = query.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];
    if (!tokens.length) return {results: [], hasMore: false};
    if (tokens.length > 128) throw new HttpError(400, 'Use up to 128 search terms.');
    const match = tokens.map((token,index) => `"${token.replace(/"/g,'""')}"${index === tokens.length-1 ? '*' : ''}`).join(' AND ');
    return this.store.transaction(() => {
      this.synchronize(vault);
      const rows = this.store.all<MatchRow>(`
        SELECT d.id,d.kind,text_search_fts.name,
          highlight(text_search_fts,0,char(1),char(2))<>text_search_fts.name AS nameHit,
          highlight(text_search_fts,2,char(1),char(2))<>text_search_fts.aliases AS aliasHit,
          snippet(text_search_fts,CASE WHEN d.kind='page' AND length(text_search_fts.body)>0 THEN 1 WHEN d.kind='entity' AND highlight(text_search_fts,0,char(1),char(2))=text_search_fts.name THEN 2 ELSE 0 END,'','','…',32) AS excerpt,
          bm25(text_search_fts,12.0,1.0,3.0) AS relevance
        FROM text_search_fts JOIN text_search_documents d ON d.rowid=text_search_fts.rowid
        LEFT JOIN pages p ON d.kind='page' AND p.id=d.id AND p.vault_id=d.vault_id
        LEFT JOIN entities e ON d.kind='entity' AND e.id=d.id AND e.vault_id=d.vault_id
        WHERE text_search_fts MATCH ? AND d.vault_id=?
          AND ((d.kind='page' AND p.id IS NOT NULL AND p.deleted_at IS NULL) OR (d.kind='entity' AND e.id IS NOT NULL))
          AND (?=0 OR (d.kind='page' AND d.id IN (SELECT value FROM json_each(?))) OR (d.kind='entity' AND d.id IN (SELECT value FROM json_each(?))))
        ORDER BY nameHit DESC,relevance ASC,text_search_fts.name COLLATE NOCASE,d.kind,d.id
        LIMIT ?
      `, match, vault, scope ? 1 : 0, JSON.stringify(scope?.pageIds ?? []), JSON.stringify(scope?.entityIds ?? []), limit+1);
      return {results: rows.slice(0,limit).map<TextSearchResult>(row => {
        const relevance = Math.max(0,-row.relevance);
        return {id: row.id, kind: row.kind, name: row.name, matchedIn: row.kind === 'page' ? row.nameHit ? 'title' : 'page' : row.nameHit ? 'name' : 'alias', snippet: makeSearchSnippet(row.excerpt,query), score: (row.nameHit ? 1 : 0)+relevance/(1+relevance)};
      }), hasMore: rows.length > limit};
    });
  }
}
