import type {Page, Segment} from '../../shared/domain.js';
import {makeSearchSnippet} from '../../shared/search-snippets.js';
import {HttpError} from '../validation.js';
import {Knowledge} from './knowledge.js';
import {Pages} from './pages.js';
import {Vaults} from './vaults.js';

// Search excerpts share the same plain-text representation as embedding input.
// Titles stay separate, and mention names are resolved inside the active vault.
export function pageBodyText(vault: string,page: Page,knowledge: Knowledge): string {
 const segments=(items: Segment[])=>items.map(s=>s.entityId ? knowledge.find(vault,s.entityId)?.name ?? '' : s.text ?? '').join('');
 return page.blocks.map(b=>b.type==='table' ? (b.rows ?? []).map(row=>row.map(segments).join(' | ')).join('\n') : segments(b.content)).join('\n').trim();
}
export class SearchSnippets {
 constructor(private pages: Pages,private knowledge: Knowledge,private vaults: Vaults) {}
 get(vault: string,body: Record<string,unknown>): {snippets: Record<string,string>} {
  this.vaults.requireOpen(vault);
  if(typeof body.query!=='string'||body.query.length>2000)throw new HttpError(400,'Use a search query up to 2,000 characters.');
  if(!Array.isArray(body.pageIds)||body.pageIds.length>100||body.pageIds.some(id=>typeof id!=='string'||!id||id.length>200))throw new HttpError(400,'Choose up to 100 note IDs.');
  const snippets: Record<string,string>=Object.create(null);
  for(const id of new Set(body.pageIds as string[])) {
   try {
    const page=this.pages.get(vault,id);
    snippets[id]=makeSearchSnippet(pageBodyText(vault,page,this.knowledge),body.query);
   }catch(error) {if(!(error instanceof HttpError)||error.status!==404)throw error;}
  }
  return {snippets};
 }
}
