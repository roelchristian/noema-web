import type {Store} from '../store.js';
import {PageEnrichmentState} from './page-enrichment-state.js';

interface TitleRow {id:string;title:string;revision:number}
/** Generated titles stay derived until an authored save accepts them. */
export function resolvePageTitle(store:Store,page:TitleRow):string {
  if(page.title.trim()&&page.title.trim()!=='Untitled')return page.title;
  const generated=store.get<{data:string;revision:number}>("SELECT data,revision FROM page_ai_enrichments WHERE page_id=? AND kind='title'",page.id);
  if(generated)try {
    const {title}=JSON.parse(generated.data);
    const inferred=new PageEnrichmentState(store).metadata(page.id).fields.title?.origin==='inferred';
    if((generated.revision===page.revision||inferred)&&typeof title==='string'&&title.trim())return title;
  }catch{/* Unknown legacy records do not replace authored text. */}
  return page.title;
}

/** Deduplicate lookups within one response without caching across renames. */
export function pageTitleResolver(store:Store) {
  const titles=new Map<string,string|null>();
  return (vault:string,id:string,fallback:string|null):string|null=>{
    const key=JSON.stringify([vault,id]);
    if(!titles.has(key)) {
      const page=store.get<TitleRow>('SELECT id,title,revision FROM pages WHERE vault_id=? AND id=?',vault,id);
      titles.set(key,page?resolvePageTitle(store,page):null);
    }
    return titles.get(key)??fallback;
  };
}
