import type {Page,PageEnrichmentMetadata} from '../../shared/domain';

export interface KnowledgeMetadataSnapshot {source:Page;metadata:PageEnrichmentMetadata}
/** Overlay persisted Knowledge fields without replacing any editor-owned content. */
export function knowledgeMetadataPage(page:Page,snapshot:KnowledgeMetadataSnapshot|null,dirty=false):Page {
  if(dirty)return {...page,summaryContentHash:undefined};
  if(!snapshot)return page;
  const {source,metadata}=snapshot;
  if(page.id!==source.id||page.vault_id!==source.vault_id||metadata.id!==page.id||metadata.vault_id!==page.vault_id
    ||source.revision!==page.revision||source.title!==page.title||source.blocks!==page.blocks)return page;
  if(metadata.revision!==page.revision)return {...page,summaryContentHash:undefined,
    ...(page.pageDomains?.origin==='inferred'?{pageDomains:{...page.pageDomains,status:'needs_refresh'}}:{})};
  const localDomains=page.pageDomains,remoteDomains=metadata.pageDomains;
  const pageDomains=remoteDomains&&(remoteDomains.revision>=(localDomains?.revision??0))
    &&!(localDomains?.origin==='manual'&&remoteDomains.origin!=='manual')?remoteDomains:localDomains;
  return {...page,pageDomains,summaryContentHash:metadata.summaryContentHash,language:metadata.language,
    enrichmentFields:metadata.enrichmentFields,enrichmentPending:metadata.enrichmentPending,enrichmentPendingFields:metadata.enrichmentPendingFields};
}
