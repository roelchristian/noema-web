import {entityMentionName, type Page, type PageDomains} from '../../shared/domain.js';
import {TAXONOMY_VERSION} from '../../shared/domains.js';
import type {AIRequestObserver} from './ai-debug.js';
import {Store} from '../store.js';
import {HttpError, now} from '../validation.js';
import {Vaults} from './vaults.js';
import {Pages} from './pages.js';
import {Knowledge} from './knowledge.js';
import {AIEnrichments} from './ai-enrichments.js';
import {Intelligence} from './intelligence.js';
import {Domains} from './domains.js';
import {AINotifications} from './ai-notifications.js';
import {summaryBaseline,materiallyStaleSummary} from './page-summary-freshness.js';
import {representativeEnrichmentText} from './page-enrichment-prompt.js';
import {languageComposition,languageCompositionChanged} from './page-language-composition.js';
import {PageEnrichmentState} from './page-enrichment-state.js';
import {domainShortlist} from './domain-shortlist.js';
import {summaryInput,summaryContentHash} from './summary-content.js';

export type EnrichmentField='title'|'domains'|'language'|'summary';
export interface EnrichmentOptions {fields?:readonly EnrichmentField[];explicit?:boolean;background?:boolean;refreshFields?:readonly EnrichmentField[];signal?:AbortSignal}
export interface PageEnrichmentResult {title:string;revision:number;pageDomains:PageDomains;summary?:string;contentHash?:string;language?:string|null;classified?:boolean}
const untitled=(page:Page)=>!page.title.trim()||page.title.trim()==='Untitled';
const cooldown=30*60*1000;
/** Each field is selected and committed independently; content is shared once per request. */
export class PageEnrichment {
  private controllers=new Map<string,{vault:string;controller:AbortController}>();
  pauseVault(vault:string) {for(const operation of this.controllers.values())if(operation.vault===vault)operation.controller.abort();}
  private running=new Map<string,{promise:Promise<PageEnrichmentResult>;revision:number;fields:EnrichmentField[];identity:string}>();
  constructor(private store:Store,private pages:Pages,private knowledge:Knowledge,private enrichments:AIEnrichments,private intelligence:Intelligence) {}
  private names(vault:string) {return new Map(this.knowledge.list(vault).map(entity=>[entity.id,entityMentionName(entity)]));}
  private data(pageId:string,kind:string):Record<string,unknown> {
    const row=this.store.get<{data:string}>('SELECT data FROM page_ai_enrichments WHERE page_id=? AND kind=?',pageId,kind);
    if(!row)return {};try{return JSON.parse(row.data);}catch{return {};}
  }
  settings(vault:string) {new Vaults(this.store).requireOpen(vault);return {automaticSummaries:this.store.get<{automatic_summaries:number}>('SELECT automatic_summaries FROM page_enrichment_settings WHERE vault_id=?',vault)?.automatic_summaries!==0};}
  configure(vault:string,input:Record<string,unknown>) {
    if(typeof input.automaticSummaries!=='boolean')throw new HttpError(400,'Choose whether to generate summaries automatically.');
    new Vaults(this.store).requireOpen(vault);
    this.store.run('INSERT INTO page_enrichment_settings (vault_id,automatic_summaries) VALUES (?,?) ON CONFLICT(vault_id) DO UPDATE SET automatic_summaries=excluded.automatic_summaries',vault,Number(input.automaticSummaries));
    return this.settings(vault);
  }
  prepare(vault:string,pageId:string,options:EnrichmentOptions={}) {
    new Vaults(this.store).requireOpen(vault);
    const page=this.pages.get(vault,pageId);if(page.editLocked)return null;
    const names=this.names(vault),resolve=(id:string)=>names.get(id);
    const text=summaryInput(page,resolve,false);
    if(!text.trim()) {if(options.explicit)throw new HttpError(400,'Add some page content first.');return null;}
    if(text.trim().length<20&&!options.explicit)return null;
    const explicitDomains=!!options.explicit&&!!(options.refreshFields??options.fields)?.includes('domains');
    const domains=new Domains(this.store),decision=domains.assess(page,resolve,{explicit:explicitDomains});
    const fields:EnrichmentField[]=[];
    const state=new PageEnrichmentState(this.store);
    const eligible=(field:EnrichmentField)=>!options.fields||options.fields.includes(field);
    if(eligible('title')&&untitled(page)&&state.eligible(page.id,'title'))fields.push('title');
    const previous=this.data(page.id,'domain_classification'),last=typeof previous.lastClassifiedAt==='string'?Date.parse(previous.lastClassifiedAt):0;
    if(eligible('domains')&&text.trim().length>=20&&decision.needsClassification&&page.pageDomains?.origin!=='manual'&&(explicitDomains||!last||Date.now()-last>=cooldown))fields.push('domains');
    const language=this.data(page.id,'language');
    const compositionChanged=languageCompositionChanged(language.composition,languageComposition(text));
    const languageNeeded=!page.language&&(language.origin!=='inferred'||compositionChanged)||language.origin==='inferred'&&compositionChanged;
    if(eligible('language')&&languageNeeded&&language.origin!=='manual'&&state.eligible(page.id,'language'))fields.push('language');
    const summary=this.store.get<{content_hash:string|null;data:string}>("SELECT content_hash,data FROM page_ai_enrichments WHERE page_id=? AND kind='summary'",page.id);
    const suppressed=this.data(page.id,'summary_preferences').suppressed===true;
    let summaryStale=summary?.content_hash!==page.summaryContentHash;
    if(summary&&summaryStale) {
      let baseline:unknown;try{baseline=JSON.parse(summary.data).baseline;}catch {/* Legacy provenance remains stale. */}
      summaryStale=materiallyStaleSummary(baseline,summaryBaseline(page,resolve));
      if(!summaryStale)this.store.run("UPDATE page_ai_enrichments SET content_hash=? WHERE page_id=? AND kind='summary'",page.summaryContentHash!,page.id);
    }
    if(eligible('summary')&&state.eligible(page.id,'summary',options.explicit)&&(!suppressed||options.explicit)&&(options.explicit&&(options.refreshFields??options.fields)?.includes('summary')||this.settings(vault).automaticSummaries&&!suppressed&&summaryStale))fields.push('summary');
    this.recordDecision(vault,page.id,fields.length?(options.explicit?'explicit_refresh':decision.reason):decision.needsClassification&&last&&Date.now()-last<cooldown?'cooldown':decision.reason,fields);
    if(!fields.length)return null;
    return {page,requestedFields:fields,contentHash:page.conceptContentHash!,schemaVersion:'page-enrichment-v1',modelProfile:JSON.stringify(this.intelligence.enrichmentSelection()),ownership:JSON.stringify([state.get(page.id).fields,this.data(page.id,'summary_preferences')]),revision:page.revision};
  }
  private recordDecision(vault:string,pageId:string,reason:string,fields:EnrichmentField[]) {
    this.store.run('INSERT INTO page_enrichment_decisions (page_id,vault_id,reason,requested_fields,assessed_at,provider_requested) VALUES (?,?,?,?,?,0)',pageId,vault,reason,JSON.stringify(fields),now());
    this.store.run('DELETE FROM page_enrichment_decisions WHERE id NOT IN (SELECT id FROM page_enrichment_decisions ORDER BY id DESC LIMIT 2000)');
  }

  async run(vault:string,page:Page,onRequest?:AIRequestObserver,options:EnrichmentOptions={}):Promise<PageEnrichmentResult> {
    const snapshot=this.prepare(vault,page.id,options);
    if(!snapshot)return {title:this.pages.get(vault,page.id).title,revision:page.revision,pageDomains:new Domains(this.store).get(page.id,page.conceptContentHash)};
    if(snapshot.revision!==page.revision)throw new HttpError(409,'The page changed. Enrichment will use the latest saved version.');
    const key=JSON.stringify([vault,page.id]);
    const identity=JSON.stringify([snapshot.revision,snapshot.contentHash,snapshot.schemaVersion,snapshot.modelProfile,snapshot.ownership]);
    const pending=this.running.get(key);
    if(pending) {
      if(pending.identity===identity&&snapshot.requestedFields.every(field=>pending.fields.includes(field)))return pending.promise;
      await pending.promise.catch(()=>{});
      const current=this.pages.get(vault,page.id);
      if(current.revision!==page.revision)throw new HttpError(409,'The page changed while waiting for enrichment.');
      return this.run(vault,current,onRequest,options);
    }
    const work=this.generate(vault,snapshot.page,snapshot.requestedFields,onRequest,options).finally(()=>{if(this.running.get(key)?.promise===work)this.running.delete(key);});
    this.running.set(key,{promise:work,revision:snapshot.revision,fields:snapshot.requestedFields,identity});
    return work;
  }
  private async generate(vault:string,page:Page,fields:EnrichmentField[],onRequest:AIRequestObserver|undefined,options:EnrichmentOptions):Promise<PageEnrichmentResult> {
    const entities=this.knowledge.list(vault),names=new Map(entities.map(entity=>[entity.id,entityMentionName(entity)])),resolve=(id:string)=>names.get(id);
    const input=page.blocks.map(block=>{
      const body=summaryInput({title:'',blocks:[block]},resolve,false);
      return (block.type==='heading1'?'# ':block.type==='heading2'?'## ':'')+body;
    }).join('');
    const baseline=new PageEnrichmentState(this.store).get(page.id).classification?.baseline;
    const changedPassages=baseline?page.blocks.map(block=>summaryInput({title:'',blocks:[block]},resolve,false).trim()).filter(text=>text&&!baseline.body.includes(text.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim())).slice(-12):[];
    const coverage=representativeEnrichmentText(input,changedPassages);
    const shortlist=fields.includes('domains')?domainShortlist(input,[...(page.pageDomains?.primaryDomainId?[page.pageDomains.primaryDomainId]:[]),...(page.pageDomains?.secondaryDomainIds??[])]):undefined;
    const preferences=this.data(page.id,'summary_preferences');
    this.store.run('INSERT INTO page_enrichment_decisions (page_id,vault_id,reason,requested_fields,assessed_at,provider_requested) VALUES (?,?,?,?,?,1)',page.id,vault,options.explicit?'explicit_refresh':'initial_enrichment',JSON.stringify(fields),now());
    const controller=new AbortController(),abort=()=>controller.abort();
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted)controller.abort();
    this.controllers.set(page.id,{vault,controller});
    let output:Awaited<ReturnType<Intelligence['generatePageEnrichment']>>;
    try {
      output=await this.intelligence.generatePageEnrichment(input,{requestedFields:fields,domains:shortlist,currentTitle:page.title,currentPrimaryDomainId:page.pageDomains?.primaryDomainId,currentSecondaryDomainIds:page.pageDomains?.secondaryDomainIds,changedPassages,signal:controller.signal},onRequest,options.background);
    }finally {
      options.signal?.removeEventListener('abort',abort);
      if(this.controllers.get(page.id)?.controller===controller)this.controllers.delete(page.id);
    }
    if(controller.signal.aborted)throw new HttpError(409,'Enrichment was paused.');
    new Vaults(this.store).requireOpen(vault);
    return this.store.transaction(()=>{
      const current=this.pages.get(vault,page.id);
      if(current.editLocked||current.revision!==page.revision||current.conceptContentHash!==page.conceptContentHash||current.title!==page.title||current.language!==page.language)throw new HttpError(409,'The page changed. Generate fresh enrichment.');
      const selection=this.intelligence.enrichmentSelection();
      const state=new PageEnrichmentState(this.store);
      let title=current.title;
      if(fields.includes('title')&&output.title&&untitled(current)&&state.eligible(page.id,'title')) {
        title=output.title;
        state.setField(page.id,'title',{origin:'inferred',contentHash:current.conceptContentHash,updatedAt:now()});
        this.enrichments.save(vault,page.id,'title',{title,origin:'inferred'},current.revision,selection);
        new AINotifications(this.store).record(vault,page.id,'page_title');
        this.store.run('UPDATE pages SET summary_content_hash=NULL WHERE id=?',page.id);
      }
      let classified=false;
      if(fields.includes('domains')&&output.primaryDomainId!==undefined&&new Domains(this.store).get(page.id).origin!=='manual') {
        const classification={primaryDomainId:output.primaryDomainId,secondaryDomainIds:output.secondaryDomainIds??[],contentHash:current.conceptContentHash!,taxonomyVersion:TAXONOMY_VERSION,lastClassifiedAt:now(),generatedTitle:title,coverage:{sampled:coverage.sampled,inputCharacters:input.length,examinedCharacters:coverage.text.length,policy:'representative-v1'}};
        this.enrichments.save(vault,page.id,'domain_classification',classification,current.revision,selection);
        new Domains(this.store).setInferred(vault,page.id,classification,classification.contentHash,{...current,title},resolve);
        classified=true;
      }
      if(fields.includes('language')&&output.language!==undefined&&this.data(page.id,'language').origin!=='manual'&&state.eligible(page.id,'language')) {
        state.setField(page.id,'language',{origin:'inferred',contentHash:current.conceptContentHash,updatedAt:now()});
        this.store.run('UPDATE pages SET language=? WHERE id=?',output.language,page.id);
        this.enrichments.save(vault,page.id,'language',{language:output.language,origin:'inferred',contentHash:current.conceptContentHash,composition:languageComposition(input)},current.revision,selection);
      }
      let summary:string|undefined;
      const stillAllowed=JSON.stringify(this.data(page.id,'summary_preferences'))===JSON.stringify(preferences);
      const contentHash=summaryContentHash({...current,title},resolve);
      if(fields.includes('summary')&&output.summary&&stillAllowed&&state.eligible(page.id,'summary',options.explicit)) {
        summary=output.summary;
        state.setField(page.id,'summary',{origin:'inferred',contentHash,updatedAt:now()});
        this.enrichments.save(vault,page.id,'summary',{summary,origin:'inferred',baseline:summaryBaseline({...current,title},resolve),generatedContentHash:contentHash},current.revision,selection);
        this.store.run("UPDATE page_ai_enrichments SET content_hash=? WHERE page_id=? AND kind='summary'",contentHash,page.id);
        if(options.explicit)this.enrichments.save(vault,page.id,'summary_preferences',{suppressed:false},current.revision,selection);
      }
      return {title,revision:current.revision,pageDomains:new Domains(this.store).get(page.id,current.conceptContentHash),...(summary?{summary,contentHash}:{}),...(fields.includes('language')&&output.language!==undefined?{language:this.pages.get(vault,page.id).language}:{}),classified};
    });
  }
}
