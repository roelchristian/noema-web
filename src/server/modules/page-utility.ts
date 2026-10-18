import type {Page} from '../../shared/domain.js';
import type {AIRequestObserver} from './ai-debug.js';
import {PageEnrichment,type PageEnrichmentResult} from './page-enrichment.js';
export type PageUtilityResult=PageEnrichmentResult;
/** Compatibility facade for older clients; all generation uses selective enrichment. */
export class PageUtility extends PageEnrichment {
  override run(vault:string,page:Page,onRequest?:AIRequestObserver,backgroundOrOptions:boolean|import('./page-enrichment.js').EnrichmentOptions=false):Promise<PageUtilityResult> {
    return super.run(vault,page,onRequest,typeof backgroundOrOptions==='boolean'?{background:backgroundOrOptions,explicit:!backgroundOrOptions,refreshFields:backgroundOrOptions?[]:['domains']}:backgroundOrOptions);
  }
}
