import {entitiesForPage,classifiedConceptSubtypes} from '../../shared/concept-classification.js';
import { createHash } from 'node:crypto';
import { identifyEntityMentions } from '../../shared/auto-entities.js';
import type { EntityMatchCache, EntityReviewItem } from '../../shared/entity-match-cache.js';
import type { Page } from '../../shared/domain.js';
import { HttpError, required } from '../validation.js';
import { Store } from '../store.js';
import { Pages } from './pages.js';
import { Knowledge } from './knowledge.js';

/** Disposable, revision-aware review materialization; never part of the note body. */
export class EntityMatches {
  constructor(private store: Store, private pages: Pages, private knowledge: Knowledge) {}
  get(vault: string, pageId: string, revision?: number): EntityMatchCache {
    const page = this.pages.get(vault,pageId);
    if (revision !== undefined && revision !== page.revision) throw new HttpError(409,'The page changed. Wait for saving to finish before reviewing.');
    const entities = entitiesForPage(page,this.knowledge.list(vault));
    const key = createHash('sha256').update(JSON.stringify(['entity-match-cache-v2', classifiedConceptSubtypes(page), page.revision, page.blocks, entities.map(({id,name,aliases,type,subtypes,inactive}) => [id,name,aliases,type,subtypes,inactive])])).digest('hex');
    const cached = this.store.get<{cache_key: string; matches: string}>('SELECT cache_key,matches FROM page_entity_match_cache WHERE page_id=? AND vault_id=?',pageId,vault);
    if (cached?.cache_key === key) return {revision:page.revision,key,matches:JSON.parse(cached.matches) as EntityReviewItem[]};
    const {ambiguous} = identifyEntityMentions(page.blocks,entities,vault);
    const matches = ambiguous.map(match => {
      const parsed = /^(.*):(\d+):(\d+)$/.exec(match.id)!;
      const [blockId,row,col] = JSON.parse(parsed[1]!) as [string, number?, number?];
      const block = page.blocks.find(block => block.id === blockId)!;
      const content = row === undefined ? block.content : block.rows![row]![col!]!;
      const start = content.slice(0,Number(parsed[2])).reduce((sum,segment) => sum + (segment.text?.length ?? 0),0) + Number(parsed[3]);
      return {...match,blockId,...(row === undefined ? {} : {row,col}),start,end:start + match.text.length};
    });
    this.store.run('INSERT INTO page_entity_match_cache (page_id,vault_id,cache_key,matches) VALUES (?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET cache_key=excluded.cache_key,matches=excluded.matches',pageId,vault,key,JSON.stringify(matches));
    return {revision:page.revision,key,matches};
  }
  resolve(vault: string, pageId: string, body: Record<string, unknown>): {blocks: Page['blocks']} {
    this.pages.requireEditable(vault,pageId);
    if (!Number.isInteger(body.revision) || typeof body.all !== 'boolean') throw new HttpError(400,'Choose a valid review item.');
    const cache = this.get(vault,pageId,body.revision as number);
    if (body.key !== cache.key) throw new HttpError(409,'The page or aliases changed. Refresh the review items.');
    const match = cache.matches.find(match => match.id === body.matchId);
    const entityId = required(body.entityId);
    if (!match || !match.entityIds.includes(entityId)) throw new HttpError(400,'Choose one of the matching entities.');
    const page = this.pages.get(vault,pageId);
    const result = identifyEntityMentions(page.blocks,entitiesForPage(page,this.knowledge.list(vault)),vault,{match,entityId,all:body.all});
    if (!result.count) throw new HttpError(409,'The matching text could not be linked. Review it after editing.');
    // The normal revision-aware autosave persists this patch, preserving concurrent local edits.
    return {blocks:result.blocks};
  }
}
