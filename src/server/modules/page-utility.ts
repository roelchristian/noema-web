import { entityMentionName } from '../../shared/domain.js';
import type {AIRequestObserver} from './ai-debug.js';
import {createHash} from 'node:crypto';
import type {ConceptClassification,Page} from '../../shared/domain.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';
import {Pages} from './pages.js';
import {Knowledge} from './knowledge.js';
import {AIEnrichments} from './ai-enrichments.js';
import {Intelligence} from './intelligence.js';
import {summaryInput} from './summary-content.js';

export interface PageUtilityResult {title:string;revision:number;conceptClassification:ConceptClassification}
/** One provider request shares the note between titling and domain classification. */
export class PageUtility {
  private running=new Map<string,Promise<PageUtilityResult>>();
  constructor(private store:Store,private pages:Pages,private knowledge:Knowledge,private enrichments:AIEnrichments,private intelligence:Intelligence) {}
  run(vault:string,page:Page,onRequest?:AIRequestObserver,background=false):Promise<PageUtilityResult> {
    const subtypes=this.knowledge.schema(vault).subtypes.filter(subtype=>subtype.type==='concept').map(({id,name})=>({id,name}));
    const schemaKey=createHash('sha256').update(JSON.stringify(subtypes)).digest('hex');
    const saved=this.store.get<{data:string}>("SELECT data FROM page_ai_enrichments WHERE page_id=? AND kind='concept_classification'",page.id);
    const previous=saved?JSON.parse(saved.data) as ConceptClassification&{schemaKey?:string;generatedTitle?:string}:null;
    const untitled=!page.title.trim()||page.title.trim()==='Untitled';
    if(previous && previous.contentHash===page.conceptContentHash&&previous.schemaKey===schemaKey&&(!untitled||previous.generatedTitle))return Promise.resolve({title:untitled?previous.generatedTitle!:page.title,revision:page.revision,conceptClassification:{subtypeIds:previous.subtypeIds,contentHash:previous.contentHash}});
    const key=JSON.stringify([vault,page.id,page.conceptContentHash,schemaKey]);
    const pending=this.running.get(key);if(pending)return pending;
    const work=this.generate(vault,page,subtypes,schemaKey,onRequest,background).finally(()=>{if(this.running.get(key)===work)this.running.delete(key);});
    this.running.set(key,work);return work;
  }
  private async generate(vault:string,page:Page,subtypes:{id:string;name:string}[],schemaKey:string,onRequest?:AIRequestObserver,background=false):Promise<PageUtilityResult> {
    const names=new Map(this.knowledge.list(vault).map(entity=>[entity.id,entityMentionName(entity)]));
    const input=summaryInput(page,id=>names.get(id),false);
    if(!input.trim())throw new HttpError(400,'Add some page content before classifying it.');
    if(input.length>40000)throw new HttpError(413,'This page exceeds the AI limit of 40,000 characters.');
    const result=await this.intelligence.generatePageUtility(input,subtypes,page.title,onRequest,background);
    new Vaults(this.store).requireOpen(vault);
    const current=this.pages.get(vault,page.id);
    if(current.conceptContentHash!==page.conceptContentHash)throw new HttpError(409,'The page changed. Classification will retry after saving.');
    const title=current.title.trim()&&current.title.trim()!=='Untitled'?current.title:result.title;
    const conceptClassification={subtypeIds:result.conceptSubtypeIds,contentHash:current.conceptContentHash!};
    const selection=this.intelligence.titleSelection();
    this.enrichments.save(vault,page.id,'concept_classification',{...conceptClassification,schemaKey,generatedTitle:title},current.revision,selection);
    if(!current.title.trim()||current.title.trim()==='Untitled')this.enrichments.save(vault,page.id,'title',{title},current.revision,selection);
    return {title,revision:current.revision,conceptClassification};
  }
}
