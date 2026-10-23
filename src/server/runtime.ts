import {LiturgicalCalendar} from './modules/liturgical-calendar.js';
import {TemporalIndex} from './modules/temporal.js';
import {EntityDiscoveryService} from './modules/entity-discovery.js';
import {createSourcePageGeneration} from './modules/source-page-generation.js';
import {SourcePageImages} from './modules/source-page-images.js';
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
  const sourceFiles=new SourceFiles(store);
  const sourcePageImages=new SourcePageImages(sourceFiles);
  const sourceReading=new SourceReading(store);
  sourceFiles.recover();
  const backups=new VaultBackups(store);
  const images=new Images(store),notifications=new AINotifications(store);
  const vaults=new Vaults(store),knowledge=new Knowledge(store),pages=new Pages(store,knowledge),organizer=new Organizer(store);
  const activity=new AIActivityLog(store),enrichments=new AIEnrichments(store,pages);
  const entityDiscovery=new EntityDiscoveryService(store,knowledge,intelligence,activity);
  const sourceReprocessing=new SourceReprocessing(store,sourceFiles,intelligence,vault=>vaults.requireOpen(vault),activity);
  const scans=new EntityScans(store,pages,knowledge,enrichments);
  const pageEnrichment=new PageEnrichment(store,pages,knowledge,enrichments,intelligence);
  const enrichmentScheduler=new PageEnrichmentScheduler(store,{
    prepare:(vault,pageId,job)=>{const snapshot=pageEnrichment.prepare(vault,pageId,{fields:job.fields,explicit:job.explicit,background:true});return snapshot?{...snapshot,explicit:job.explicit}:null;},
    execute:async(vault,pageId,snapshot,signal)=>{
      if(signal.aborted)return;
      const id=activity.start('page_enrichment',intelligence.enrichmentSelection(),vault,pageId);
      try {
        const result=await pageEnrichment.run(vault,pages.get(vault,pageId),bytes=>activity.request(id,bytes,snapshot.revision??null),{fields:snapshot.requestedFields,background:true,explicit:snapshot.explicit,signal});
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
  organizer.smart.setQueryEmbeddingProvider((vault,description)=>embeddings.queryEmbedding(vault,description));
  const sourcePassages=new SourcePassages(store);
  const sourceEnrichments=new SourceEnrichments(store,intelligence,activity);
  const sourcePages=new SourcePages(store,knowledge,pages);
  const sourcePageGeneration=createSourcePageGeneration({store,sourcePages,intelligence,vaults,activity,notifications});
  const searchSnippets=new SearchSnippets(pages,knowledge,vaults);
  const textSearch=new TextSearch(store,vaults);
  const temporal=new TemporalIndex(store);
  const liturgical=new LiturgicalCalendar(store);
  // Enforce retention on startup, periodically while running, and before scoped API access.
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
  return { store, temporal, liturgical, entityDiscovery, intelligence, networkAccess, vaultDeletion, sourceFiles, sourcePageImages, sourceReading, backups, images, notifications, vaults, knowledge, pages, organizer, activity, enrichments, sourceReprocessing, scans, pageEnrichment, enrichmentScheduler, scheduleEnrichment, entityMatches, embeddings, sourcePassages, sourceEnrichments, sourcePages, sourcePageGeneration, searchSnippets, textSearch,
    start() {
      enrichmentScheduler.start();
      liturgicalWorker=setInterval(()=>{void liturgical.tick().catch(()=>{});},1000);liturgicalWorker.unref();
      sourceReprocessingWorker=setInterval(()=>{void sourceReprocessing.tick().catch(()=>{});},1000);sourceReprocessingWorker.unref();
      vaultDeletion.cleanup();
      sourcePassageWorker=setInterval(()=>{try{sourcePassages.tick();temporal.tickEvidence();}catch{/* Durable passage state records failures for retry. */}},500);sourcePassageWorker.unref();
      sourceWorker=setInterval(()=>{void sourceFiles.tick().catch(()=>{});},500);sourceWorker.unref();
      sourceEnrichmentWorker=setInterval(()=>{void sourceEnrichments.tick().catch(()=>{});},1000);sourceEnrichmentWorker.unref();
      cleanup = setInterval(() => { try { pages.purgeExpired(); images.cleanup(); sourceFiles.cleanup(); vaultDeletion.cleanup(); } catch (error) { console.error('Trash cleanup failed',error); } },60 * 60 * 1000);
      cleanup.unref();
      keyCleanup=setInterval(()=>{try{intelligence.purgeExpired();}catch{/* Keychain may be locked; all AI access still fails closed. */}},60000);keyCleanup.unref();
      embeddingWorker=setInterval(()=>{void embeddings.tick().catch(()=>{/* Durable job history records failures; never log note content. */});},1000);embeddingWorker.unref();
    },
    close() {
      clearInterval(liturgicalWorker);liturgical.close();
      clearInterval(sourceReprocessingWorker);sourceReprocessing.close();enrichmentScheduler.dispose();clearInterval(sourceWorker);sourceFiles.close();sourcePageImages.close();clearInterval(sourcePassageWorker);clearInterval(sourceEnrichmentWorker);sourceEnrichments.close();clearInterval(cleanup);clearInterval(keyCleanup);clearInterval(embeddingWorker);embeddings.close();
    },
  };
}
export type Runtime = ReturnType<typeof createRuntime>;
