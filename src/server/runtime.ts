import {SOURCE_INGESTION_ENRICHMENT_SCHEMA,sourceIngestionEnrichmentPrompt} from './modules/source-ingestion-enrichment.js';
import {sourceIngestionWithActivity} from './modules/source-ingestion-activity.js';
import {SOURCE_INGESTION_RELATIONS_SCHEMA,sourceIngestionRelationsPrompt} from './modules/source-ingestion-relations.js';
import {sourceIngestionContextManifest} from './modules/source-ingestion-planner.js';
import {sourceIngestionRepairFindings,validateSourceIngestionDocument} from './modules/source-ingestion-validation.js';
import {SOURCE_INGESTION_TARGETED_REPAIR_SCHEMA,sourceIngestionTargetedRepairPrompt} from './modules/source-ingestion-targeted-repair.js';
import {SourceIngestion} from './modules/source-ingestion.js';
import {PdfPlatform} from './modules/pdf-platform.js';
import {SOURCE_INGESTION_JSON_SCHEMA} from './modules/source-ingestion-validation.js';
import {documentSystemPrompt} from './modules/document-provider.js';
import {Chat} from './modules/chat.js';
import {ChatRetrieval} from './modules/chat-retrieval.js';
import {SourceMetadata} from './modules/source-metadata.js';
import {SourceMetadataExtraction} from './modules/source-metadata-extraction.js';
import {BibliographicMetadata} from './modules/bibliographic-metadata.js';
import {SpeechCache} from './modules/speech-cache.js';
import {buildCollectionRulePrompt} from './modules/collection-rule-generation.js';
import {LiturgicalCalendar} from './modules/liturgical-calendar.js';
import {TemporalIndex} from './modules/temporal.js';
import {EntityDiscoveryService} from './modules/entity-discovery.js';
import {createSourcePageGeneration} from './modules/source-page-generation.js';
import {SourcePageImages} from './modules/source-page-images.js';
import {SourceReprocessingEvidence} from './modules/source-reprocessing-evidence.js';
import {SourceReprocessing} from './modules/source-reprocessing.js';
import {SourceReading} from './modules/source-reading.js';
import { SourcePages} from './modules/source-pages.js';
import { SourceFiles} from './modules/source-files.js';
import { VaultBackups} from './modules/vault-backups.js';
import { AINotifications } from './modules/ai-notifications.js';
import { Images} from './modules/images.js';
import {PageEnrichment} from './modules/page-enrichment.js';
import {PageEnrichmentScheduler} from './modules/page-enrichment-scheduler.js';
import { EntityScans } from './modules/entity-scan.js';
import { EntityMatches } from './modules/entity-matches.js';
import { AIEnrichments } from './modules/ai-enrichments.js';
import { AIActivityLog } from './modules/ai-activity.js';
import { Store } from './store.js';
import {VaultDeletion} from './modules/vault-deletion.js';
import { Vaults } from './modules/vaults.js';
import { Knowledge } from './modules/knowledge.js';
import { Organizer } from './modules/organization.js';
import { Intelligence} from './modules/intelligence.js';
import { Pages } from './modules/pages.js';
import { Embeddings } from './modules/embeddings.js';
import {SourcePassages} from './modules/source-passages.js';
import { SourceEnrichments } from './modules/source-enrichments.js';
import { SearchSnippets } from './modules/search-snippets.js';
import { TextSearch } from './modules/text-search.js';
import { HttpError} from './validation.js';
import { type NetworkConfig} from './network.js';
import {NetworkAccess, networkSettingsPath} from './network-settings.js';

// Construction performs recovery and retention writes before the server can listen.
export function createRuntime(store: Store, intelligence: Intelligence, network: NetworkConfig, access?: NetworkAccess) {
  const database = store.all<{name: string; file: string}>('PRAGMA database_list').find(item => item.name === 'main')?.file;
  const networkAccess = access ?? new NetworkAccess(database ? networkSettingsPath(database) : undefined, network, network.lan ? network : undefined);
  const vaultDeletion=new VaultDeletion(store);
  const speechCache=new SpeechCache(store);
  const sourceFiles=new SourceFiles(store);
  const activity=new AIActivityLog(store);
  const pdfPlatform=new PdfPlatform();
  const sourceIngestion=new SourceIngestion(store,{
    prepare:async(file,signal)=>{if(signal.aborted)throw new HttpError(499,'PDF ingestion paused.');const prepared=await sourceFiles.prepareProviderPDF(file.vault_id,file.id,pdfPlatform,signal);let context;try{context=sourceIngestionContextManifest(await pdfPlatform.inspectContext(prepared.bytes,signal));}catch{context=sourceIngestionContextManifest({conventions:['Native PDF context inspection unavailable; rely on page evidence.']});}return {...prepared,context};},
    split:(bytes,pages)=>pdfPlatform.split(bytes,pages),
    extract:async({vaultId,fileId,options,pdf,pageMap,plan,signal,onSubmitted,context})=>{
      if(options.route==='local'||!options.model)throw new HttpError(400,'Choose a document provider and model.');
      const provider=intelligence.documentProvider(options.route);
      const result=await sourceIngestionWithActivity(activity,store,{vaultId,fileId,phase:sourceFiles.require(vaultId,fileId).status==='ready'?'recover':'extract'},provider,{model:options.model,pdf,pages:pageMap.length,prompt:documentSystemPrompt+'\n'+JSON.stringify({pageMap,ownedPhysicalPages:plan.ownedPages,contextPhysicalPages:plan.contextPages,context,depth:options.depth,containsMath:options.containsMath,guidance:options.guidance}),schema:SOURCE_INGESTION_JSON_SCHEMA as Record<string,unknown>,maxOutputTokens:options.budget.maxOutputTokens,signal,onSubmitted});
      if(result.status==='completed') {
        let document;try{document=validateSourceIngestionDocument(result.candidate,{ownedPages:plan.ownedPages,pageCount:Math.max(...pageMap)});}catch{return result;}
        try {
          const native=(await pdfPlatform.inspectTexts(pdf,pageMap.map((_,index)=>index+1),signal)).map(item=>({...item,page:pageMap[item.page-1]!}));
          for(const finding of sourceIngestionRepairFindings(document,{nativePages:native}).filter(finding=>finding.kind==='native-text-anomaly')) {
            const page=document.pages.find(page=>page.number===finding.pages[0]);
            page?.unresolved.push({description:finding.reason,blockId:null});
          }
        } catch {
          // Optional native-layer evidence is never a prerequisite or independent OCR proof.
          const first=document.pages.find(page=>page.role==='owned');
          first?.unresolved.push({description:'Optional native text-layer comparison unavailable; inspect the PDF page evidence.',blockId:null});
        }
        return {...result,candidate:document};
      }
      return result;
    },
    enrich:async({vaultId,fileId,options,pdf,pageMap,plan,document,signal,onSubmitted})=>{
      if(options.route==='local'||!options.model)throw new HttpError(400,'Choose a document provider and model.');
      return sourceIngestionWithActivity(activity,store,{vaultId,fileId,phase:'enrich'},intelligence.documentProvider(options.route),{task:'enrichment',model:options.model,pdf,pages:pageMap.length,prompt:sourceIngestionEnrichmentPrompt(document,{ownedPages:plan.ownedPages,contextPages:plan.contextPages,pageMap,depth:options.depth}),schema:SOURCE_INGESTION_ENRICHMENT_SCHEMA,maxOutputTokens:Math.min(options.budget.maxOutputTokens,16000),signal,onSubmitted});
    },
    relate:async({vaultId,fileId,options,pdf,pageMap,document,request,signal,onSubmitted})=>{
      if(options.route==='local'||!options.model)throw new HttpError(400,'Choose a document provider and model.');
      return sourceIngestionWithActivity(activity,store,{vaultId,fileId,phase:'relate'},intelligence.documentProvider(options.route),{task:'relations',model:options.model,pdf,pages:pageMap.length,prompt:sourceIngestionRelationsPrompt(document,request)+'\n'+JSON.stringify({pageMap}),schema:SOURCE_INGESTION_RELATIONS_SCHEMA,maxOutputTokens:Math.min(options.budget.maxOutputTokens,6000),signal,onSubmitted});
    },
    repair:async({vaultId,fileId,options,pdf,pageMap,plan,document,signal,onSubmitted})=>{
      if(options.route==='local'||!options.model)throw new HttpError(400,'Choose a document provider and model.');
      const provider=intelligence.documentProvider(options.route);
      return sourceIngestionWithActivity(activity,store,{vaultId,fileId,phase:'repair'},provider,{model:options.model,pdf,pages:pageMap.length,prompt:sourceIngestionTargetedRepairPrompt(document,{ownedPages:plan.ownedPages,contextPages:plan.contextPages,pageMap,depth:options.depth}),task:'repair',schema:SOURCE_INGESTION_TARGETED_REPAIR_SCHEMA as Record<string,unknown>,maxOutputTokens:Math.min(options.budget.maxOutputTokens,8000),signal,onSubmitted});
    },
    reconcile:(file,document,assembly,options)=>sourceFiles.publishProviderEvidence(file.vault_id,file.id,assembly.text,{provider:options.route,model:options.model,coverage:'checked',independentEvidence:'not-checked',document}),
  });
  sourceFiles.bindIngestion(sourceIngestion);sourceIngestion.recover();
  const sourcePageImages=new SourcePageImages(sourceFiles);
  const sourceReading=new SourceReading(store);
  sourceFiles.recover();
  const backups=new VaultBackups(store);
  const images=new Images(store),notifications=new AINotifications(store);
  const vaults=new Vaults(store),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),organizer=new Organizer(store);
  const enrichments=new AIEnrichments(store,pages);
  const entityDiscovery=new EntityDiscoveryService(store,knowledge,intelligence,activity);
  const sourceReprocessingEvidence=new SourceReprocessingEvidence(sourceFiles,sourcePageImages);
  const sourceMetadata=new SourceMetadata(store);
  const sourceReprocessing=new SourceReprocessing(store,sourceFiles,intelligence,vault=>vaults.requireOpen(vault),activity,new SourceMetadataExtraction(store,sourceMetadata),sourceReprocessingEvidence);
  const scans=new EntityScans(store,pages,knowledge,enrichments);
  const pageEnrichment=new PageEnrichment(store,pages,knowledge,enrichments,intelligence);
  const enrichmentScheduler=new PageEnrichmentScheduler(store,{
    prepare:(vault,pageId,job)=>{const snapshot=pageEnrichment.prepare(vault,pageId,{fields:job.fields,explicit:job.explicit,background:true});return snapshot?{...snapshot,explicit:job.explicit}:null;},
    execute:async(vault,pageId,snapshot,signal)=>{
      if(signal.aborted)return;
      const id=activity.start('page_enrichment',intelligence.enrichmentSelection(),vault,pageId);
      try {
        const result=await pageEnrichment.runPrepared(vault,snapshot,bytes=>activity.request(id,bytes,snapshot.revision??null),{fields:snapshot.requestedFields,background:true,explicit:snapshot.explicit,signal});
        const sent=store.get<{prompt_bytes:number|null}>('SELECT prompt_bytes FROM ai_activity WHERE id=?',id)?.prompt_bytes;activity.finish(id,sent==null?'skipped':'completed',200);return {classified:result.classified};
      }catch(error){activity.finish(id,'failed',error instanceof HttpError?error.status:500);throw error;}
    },
  });
  const scheduleEnrichment=(vault:string,page:import('../shared/domain.js').Page)=>{
    pageEnrichment.cancelObsolete(vault,page.id);
    const initial=!page.title.trim()||page.title==='Untitled'||page.pageDomains?.status==='unclassified';
    enrichmentScheduler.enqueue(vault,page.id,{delayMs:initial?12_000:page.pageDomains?.status==='needs_refresh'?40_000:25_000});
  };
  const entityMatches=new EntityMatches(store,pages,knowledge);
  const embeddings=new Embeddings(store,pages,knowledge,vaults,intelligence,activity);
  const chat=new Chat(store,intelligence,new ChatRetrieval(store,embeddings,vaults),vaults,activity);
  organizer.smart.setQueryEmbeddingProvider((vault,description)=>embeddings.queryEmbedding(vault,description));
  organizer.smart.setRuleGenerationProvider(async(vault,input)=>{
    const selection={...intelligence.selection(),reasoningEffort:'none' as const},id=activity.start('collection_rules',selection,vault);
    try {const output=await intelligence.generate({kind:'collectionRules',...buildCollectionRulePrompt(input),onRequest:bytes=>activity.request(id,bytes,null)});activity.finish(id,'completed',200);return output;}
    catch(error){activity.finish(id,'failed',error instanceof HttpError?error.status:502);throw error;}
  });
  const bibliography=new BibliographicMetadata(store);
  const sourcePassages=new SourcePassages(store);
  const sourceEnrichments=new SourceEnrichments(store,intelligence,activity);
  const sourcePages=new SourcePages(store,knowledge,pages);
  const sourcePageGeneration=createSourcePageGeneration({store,sourcePages,intelligence,vaults,activity,notifications});
  const searchSnippets=new SearchSnippets(pages,knowledge,vaults);
  const textSearch=new TextSearch(store,vaults);
  const temporal=new TemporalIndex(store);
  const liturgical=new LiturgicalCalendar(store);
  // Enforce retention on startup, periodically while running, and before scoped API access.
  speechCache.cleanup();
  pages.purgeExpired();
  images.cleanup();
  let sourceReprocessingWorker: ReturnType<typeof setInterval> | undefined;
  let sourceWorker: ReturnType<typeof setInterval> | undefined;
  let cleanup: ReturnType<typeof setInterval> | undefined;
  let keyCleanup: ReturnType<typeof setInterval> | undefined;
  let embeddingWorker: ReturnType<typeof setInterval> | undefined;
  let sourcePassageWorker: ReturnType<typeof setInterval> | undefined;
  let liturgicalWorker: ReturnType<typeof setInterval> | undefined;
  let sourceEnrichmentWorker: ReturnType<typeof setInterval> | undefined;
  return { chat, bibliography, store, speechCache, temporal, liturgical, entityDiscovery, intelligence, networkAccess, vaultDeletion, sourceFiles, sourceIngestion, sourcePageImages, sourceReading, backups, images, notifications, vaults, knowledge, pages, organizer, activity, enrichments, sourceReprocessing, scans, pageEnrichment, enrichmentScheduler, scheduleEnrichment, entityMatches, embeddings, sourcePassages, sourceEnrichments, sourcePages, sourcePageGeneration, searchSnippets, textSearch,
    start() {
      enrichmentScheduler.start();
      liturgicalWorker=setInterval(()=>{void liturgical.tick().catch(()=>{});},1000);liturgicalWorker.unref();
      sourceReprocessingWorker=setInterval(()=>{void sourceReprocessing.tick().catch(()=>{});},1000);sourceReprocessingWorker.unref();
      vaultDeletion.cleanup();
      sourcePassageWorker=setInterval(()=>{try{sourcePassages.tick();temporal.tickEvidence();}catch{/* Durable passage state records failures for retry. */}},500);sourcePassageWorker.unref();
      sourceWorker=setInterval(()=>{void sourceFiles.tick().catch(()=>{});void sourceIngestion.tick().catch(()=>{});},500);sourceWorker.unref();
      sourceEnrichmentWorker=setInterval(()=>{void sourceEnrichments.tick().catch(()=>{});},1000);sourceEnrichmentWorker.unref();
      cleanup = setInterval(() => { try { speechCache.cleanup(); pages.purgeExpired(); images.cleanup(); sourceFiles.cleanup(); vaultDeletion.cleanup(); } catch (error) { console.error('Cache and trash cleanup failed',error); } },60 * 60 * 1000);
      cleanup.unref();
      keyCleanup=setInterval(()=>{try{intelligence.purgeExpired();}catch{/* Keychain may be locked; all AI access still fails closed. */}},60000);keyCleanup.unref();
      embeddingWorker=setInterval(()=>{void embeddings.tick().catch(()=>{/* Durable job history records failures; never log note content. */});},1000);embeddingWorker.unref();
    },
    close() {
      chat.close();
      clearInterval(liturgicalWorker);liturgical.close();
      clearInterval(sourceReprocessingWorker);sourceReprocessing.close();sourceReprocessingEvidence.close();enrichmentScheduler.dispose();clearInterval(sourceWorker);sourceFiles.close();sourceIngestion.close();sourcePageImages.close();clearInterval(sourcePassageWorker);clearInterval(sourceEnrichmentWorker);sourceEnrichments.close();clearInterval(cleanup);clearInterval(keyCleanup);clearInterval(embeddingWorker);embeddings.close();
    },
  };
}
export type Runtime = ReturnType<typeof createRuntime>;
