import { entityMentionName } from '../../shared/domain.js';
import type {AIRequestObserver} from './ai-debug.js';
import type {PageDomains,Page} from '../../shared/domain.js';
import {TAXONOMY_VERSION} from '../../shared/domains.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';
import {Vaults} from './vaults.js';
import {Pages} from './pages.js';
import {Knowledge} from './knowledge.js';
import {AIEnrichments} from './ai-enrichments.js';
import {Intelligence} from './intelligence.js';
import {Domains} from './domains.js';
import {domainShortlist} from './domain-shortlist.js';
import {summaryInput} from './summary-content.js';

export interface PageUtilityResult {title:string;revision:number;pageDomains:PageDomains}
interface SavedClassification {primaryDomainId:string|null;secondaryDomainIds:string[];contentHash:string;taxonomyVersion:string;generatedTitle?:string}
/** A single provider request shares content between titling and subject classification. */
export class PageUtility {
  private running=new Map<string,Promise<PageUtilityResult>>();
  constructor(private store:Store,private pages:Pages,private knowledge:Knowledge,private enrichments:AIEnrichments,private intelligence:Intelligence) {}
  run(vault:string,page:Page,onRequest?:AIRequestObserver,background=false):Promise<PageUtilityResult> {
    const domains=new Domains(this.store),assignments=domains.get(page.id,page.conceptContentHash);
    const saved=this.store.get<{data:string}>("SELECT data FROM page_ai_enrichments WHERE page_id=? AND kind='domain_classification'",page.id);
    const previous=saved?JSON.parse(saved.data) as SavedClassification:null;
    const untitled=!page.title.trim()||page.title.trim()==='Untitled';
    const fresh=previous?.contentHash===page.conceptContentHash&&previous?.taxonomyVersion===TAXONOMY_VERSION;
    if(assignments.origin==='manual'&&!untitled || fresh&&(!untitled||previous?.generatedTitle))return Promise.resolve({title:untitled?previous!.generatedTitle!:page.title,revision:page.revision,pageDomains:assignments});
    const key=JSON.stringify([vault,page.id,page.conceptContentHash,TAXONOMY_VERSION,assignments.origin]);
    const pending=this.running.get(key);if(pending)return pending;
    const work=this.generate(vault,page,onRequest,background).finally(()=>{if(this.running.get(key)===work)this.running.delete(key);});
    this.running.set(key,work);return work;
  }
  private async generate(vault:string,page:Page,onRequest?:AIRequestObserver,background=false):Promise<PageUtilityResult> {
    const entities=this.knowledge.list(vault), names=new Map(entities.map(entity=>[entity.id,entityMentionName(entity)]));
    const input=summaryInput(page,id=>names.get(id),false);
    if(!input.trim())throw new HttpError(400,'Add some page content before classifying it.');
    if(input.length>40000)throw new HttpError(413,'This page exceeds the AI limit of 40,000 characters.');
    const linked=new Set(page.blocks.flatMap(block=>[...block.content,...(block.rows??[]).flat(2)]).flatMap(segment=>segment.entityId?[segment.entityId]:[]));
    const shortlist=domainShortlist(input,entities.filter(entity=>linked.has(entity.id)).flatMap(entity=>entity.domainIds??[]));
    const result=await this.intelligence.generatePageUtility(input,shortlist,page.title,onRequest,background);
    new Vaults(this.store).requireOpen(vault);
    const current=this.pages.get(vault,page.id);
    if(current.editLocked||current.conceptContentHash!==page.conceptContentHash)throw new HttpError(409,'The page changed. Classification will retry after saving.');
    const title=current.title.trim()&&current.title.trim()!=='Untitled'?current.title:result.title;
    const classification={primaryDomainId:result.primaryDomainId,secondaryDomainIds:result.secondaryDomainIds,contentHash:current.conceptContentHash!,taxonomyVersion:TAXONOMY_VERSION};
    const selection=this.intelligence.titleSelection();
    this.enrichments.save(vault,page.id,'domain_classification',{...classification,generatedTitle:title},current.revision,selection);
    const pageDomains=new Domains(this.store).setInferred(vault,page.id,classification,classification.contentHash);
    if(!current.title.trim()||current.title.trim()==='Untitled')this.enrichments.save(vault,page.id,'title',{title},current.revision,selection);
    return {title,revision:current.revision,pageDomains};
  }
}
