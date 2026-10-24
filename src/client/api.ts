import type {NarrationPreferences} from '../shared/narration';
import type {SpeechProvider,SpeechVoice} from '../shared/intelligence';
import {cleanSpeechText} from '../shared/speech-text';
import type {EditorReviewText,EditorReviewSuggestion} from '../shared/editor-review';
import type { Organization, Entity, EntityDetail, EntityInput, PropertyInput, RelationshipInput, Page, PageInput, PageSummary, Vault, TrashedPage } from '../shared/domain';
export type PropertyProposalPreview=import('../shared/property-provenance').PropertyProposal & {stale:boolean;staleReason:string|null;fingerprint:string;conflicts:import('../shared/domain').Property[];currentName:string;definition?:import('../shared/property-definitions').PropertyDefinition;sourceName?:string};
export interface SpeechModelStatus {ready:boolean;model:string;missingFiles:string[];downloadCommand:string}
export class ApiError extends Error { constructor(public status: number,message: string){super(message);} }
export async function request<T>(route: string, method='GET', body?: unknown, vaultId?: string, signal?: AbortSignal): Promise<T> {
  const response=await fetch('/api/'+route,{method,signal,headers:{'X-Noema-Request':'1',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(vaultId?{'X-Vault-Id':vaultId}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  const result:unknown=await response.json();
  if(/^pages\/[^/]+\/(title|summary|entity-scan|explain|review)$/.test(route)&&typeof window!=='undefined')window.dispatchEvent(new Event('noema:ai-activity'));
  if(!response.ok)throw new ApiError(response.status,typeof result==='object'&&result&&'error' in result?String(result.error):'Request failed');
  return result as T;
}
export function imageURL(vault: string, id: string) { return `/api/images/${encodeURIComponent(id)}?vault=${encodeURIComponent(vault)}`; }
export async function fetchClipboardImage(vault: string, url: string): Promise<File> {
  const response = await fetch('/api/images/fetch', {method:'POST', headers:{'X-Noema-Request':'1','X-Vault-Id':vault,'Content-Type':'application/json'}, body:JSON.stringify({url})});
  if (!response.ok) {const result = await response.json(); throw new ApiError(response.status, result.error || 'Could not download clipboard image');}
  const blob = await response.blob();
  return new File([blob], 'pasted-image', {type:blob.type});
}
export async function createSpeech(vaultId:string,text:string,signal?:AbortSignal,pageId?:string,voice?:SpeechVoice,provider?:SpeechProvider,options?:{narration?:NarrationPreferences;expectedNarration?:NarrationPreferences;pauseAfterMs?:number;protectedText?:boolean}):Promise<Blob> {
  try {
    const response=await fetch('/api/intelligence/speech',{method:'POST',signal,headers:{'X-Noema-Request':'1','X-Vault-Id':vaultId,'Content-Type':'application/json'},body:JSON.stringify({text:cleanSpeechText(text),...(pageId?{pageId}:{}),...(voice?{voice}:{}),...(provider?{provider}:{}),...options})});
    if(!response.ok){const result=await response.json();throw new ApiError(response.status,result.error||'Could not generate speech.');}
    return await response.blob();
  } finally {if(typeof window!=='undefined')window.dispatchEvent(new Event('noema:ai-activity'));}
}
export async function uploadImage(vault: string, file: File): Promise<{id: string}> {
  if(file.size > 20 * 1024 * 1024) throw new Error('Images must be 20 MB or smaller');
  const response = await fetch('/api/images', {method:'POST', headers:{'X-Noema-Request':'1','X-Vault-Id':vault,'Content-Type':'application/octet-stream'}, body:file});
  const result = await response.json();
  if(!response.ok) throw new ApiError(response.status,result.error || 'Image upload failed');
  return result;
}
export async function uploadSourceFile(vault:string,file:File,entityId?:string,containsMath=false):Promise<import('../shared/domain').SourceFile> {
  const params=new URLSearchParams({name:file.name,containsMath:String(containsMath)});if(entityId)params.set('entity',entityId);
  const response=await fetch('/api/source-files?'+params,{method:'POST',headers:{'X-Noema-Request':'1','X-Vault-Id':vault,'Content-Type':'application/octet-stream'},body:file});
  const result=await response.json();if(!response.ok)throw new ApiError(response.status,result.error||'Source upload failed');return result;
}
const maxBackupBytes=128*1024*1024;
export async function exportVaultBackup(vault:string):Promise<{blob:Blob;filename:string}> {
  const response=await fetch(`/api/vaults/${encodeURIComponent(vault)}/backup`,{headers:{'X-Noema-Request':'1'}});
  if(!response.ok){const result=await response.json();throw new ApiError(response.status,result.error||'Vault export failed');}
  const filename=response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  return {blob:await response.blob(),filename:filename?decodeURIComponent(filename):'vault.noemabkp'};
}
export async function importVaultBackup(file:File,name?:string):Promise<Vault> {
  if(!/\.noemabkp$/i.test(file.name))throw new Error('Choose a .noemabkp backup file.');
  if(!file.size||file.size>maxBackupBytes)throw new Error('Choose a nonempty backup of 128 MB or smaller.');
  const params=new URLSearchParams();if(name)params.set('name',name);
  const response=await fetch('/api/vaults/import?'+params,{method:'POST',headers:{'X-Noema-Request':'1','Content-Type':'application/x-noema-backup'},body:file});
  const result=await response.json();if(!response.ok)throw new ApiError(response.status,result.error||'Vault import failed');return result;
}
export const api={
  pageHistory:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/page-history').PageVersion[]>(`pages/${id}/history`,'GET',undefined,vault,signal),
  pageVersion:(vault:string,id:string,version:string,signal?:AbortSignal)=>request<import('../shared/page-history').PageVersionDetail>(`pages/${id}/history/${encodeURIComponent(version)}`,'GET',undefined,vault,signal),
  checkpointPage:(vault:string,id:string,name:string,revision:number)=>request<import('../shared/page-history').PageVersionDetail>(`pages/${id}/history`,'POST',{name,revision},vault),
  restorePageVersion:(vault:string,id:string,version:string,revision:number)=>request<Page>(`pages/${id}/history/${encodeURIComponent(version)}/restore`,'POST',{revision},vault),
  copyPageVersion:(vault:string,id:string,version:string,revision:number)=>request<Page>(`pages/${id}/history/${encodeURIComponent(version)}/copy`,'POST',{revision},vault),
  liturgicalYear:(vault:string,year:number,signal?:AbortSignal,calendarId:import('../shared/liturgical').LiturgicalCalendarId='grc-en')=>request<import('../shared/liturgical').LiturgicalYear>(`temporal/liturgical/${year}?rite=${calendarId}`,'GET',undefined,vault,signal),
  prepareLiturgical:(vault:string,year:number,retry=false,signal?:AbortSignal)=>request<import('../shared/liturgical').LiturgicalDownloadStatus>('temporal/liturgical/preload','POST',{year,retry},vault,signal),
  liturgicalStatus:(vault:string,signal?:AbortSignal)=>request<import('../shared/liturgical').LiturgicalDownloadStatus>('temporal/liturgical/status','GET',undefined,vault,signal),
  temporalDates:(vault:string,from:string,to:string,options:{allReferences:boolean;layers:import('../shared/temporal').TemporalLayer[];offset?:number},signal?:AbortSignal)=>request<import('../shared/temporal').TemporalResults>('temporal/dates?'+new URLSearchParams({from,to,references:options.allReferences?'all':'curated',layers:options.layers.join(','),offset:String(options.offset??0),limit:'100'}),'GET',undefined,vault,signal),
  temporalDetail:(vault:string,id:string,offset=0,relationOffset=0,signal?:AbortSignal,extra:{sourceOffset?:number;propertyOffset?:number;proposalOffset?:number;proposalId?:string}={})=>request<import('../shared/temporal').TemporalDetail>(`temporal/dates/${encodeURIComponent(id)}?offset=${offset}&relationOffset=${relationOffset}&limit=20&sourceOffset=${extra.sourceOffset??0}&propertyOffset=${extra.propertyOffset??0}&proposalOffset=${extra.proposalOffset??0}${extra.proposalId?`&proposalId=${encodeURIComponent(extra.proposalId)}`:''}`,'GET',undefined,vault,signal),
  temporalSourceMention:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/temporal').TemporalSourceEvidence>(`temporal/source-mentions/${encodeURIComponent(id)}`,'GET',undefined,vault,signal),
  reviewTemporalRelation:(vault:string,id:string,status:'accepted'|'rejected',version:string)=>request(`temporal/relations/${encodeURIComponent(id)}`,'PUT',{status,version},vault),
  linkTemporalEntity:(vault:string,body:{dateId:string;entityId:string;kind:string;mentionId?:string;sourceMentionId?:string})=>request('temporal/relations','POST',body,vault),
  temporalMention:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/temporal').TemporalEvidence>(`temporal/mentions/${encodeURIComponent(id)}`,'GET',undefined,vault,signal),
  curateDate:(vault:string,value:string,curation:import('../shared/temporal').TemporalCuration)=>request('temporal/curation','PUT',{value,...curation},vault),
  uncurateDate:(vault:string,id:string)=>request(`temporal/curation/${encodeURIComponent(id)}`,'DELETE',{},vault),
  refreshTemporal:(vault:string)=>request<{refreshed:number;pending:number}>('temporal/refresh','POST',{},vault),
  suggestionVersion:(vault:string,id:string,signal?:AbortSignal)=>request<{version:string}>(`pages/${id}/suggestion-version`,'GET',undefined,vault,signal),
  relatedNotesState:(vault:string,id:string,previous:string[],signal?:AbortSignal)=>request<import('../shared/embeddings').RelatedNotesState>(`pages/${id}/related-notes?state=1&${new URLSearchParams(previous.map(id=>['previous',id]))}`,'GET',undefined,vault,signal),
  relatedNotes:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/embeddings').RelatedNote[]>(`pages/${id}/related-notes`,'GET',undefined,vault,signal),
  suggestedSources:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/embeddings').SuggestedSource[]>(`pages/${id}/source-suggestions`,'GET',undefined,vault,signal),
  dismissSource:(vault:string,id:string,sourceId:string)=>request<{dismissed:boolean}>(`pages/${id}/source-suggestions`,'POST',{sourceId},vault),
  domains:()=>request<{taxonomyVersion:string;domains:import('../shared/domain').Domain[]}>('domains'),
  setPageDomains:(vault:string,id:string,revision:number,primaryDomainId:string|null,secondaryDomainIds:string[])=>request<Page>(`pages/${id}/domains`,'PUT',{revision,primaryDomainId,secondaryDomainIds},vault),
  networkSettings:(signal?:AbortSignal)=>request<import('../shared/security').NetworkSettings>('security/network','GET',undefined,undefined,signal),
  saveNetworkSettings:(lan:boolean)=>request<import('../shared/security').NetworkSettings>('security/network','PUT',{lan}),
  setVaultPassphrase:(id:string,currentPassphrase:string,passphrase:string|null)=>request<Vault>(`vaults/${encodeURIComponent(id)}/passphrase`,'PUT',{currentPassphrase,passphrase}),
  previewVaultDeletion:(id:string)=>request<import('../shared/domain').VaultDeletionPreview>(`vaults/${encodeURIComponent(id)}/deletion-preview`),
  deleteVault:(id:string,confirmation:import('../shared/domain').VaultDeletionConfirmation)=>request<import('../shared/domain').VaultDeletionResult>(`vaults/${encodeURIComponent(id)}/delete`,'POST',confirmation),
  archivedPages:(vault:string)=>request<import('../shared/domain').ArchivedPage[]>('pages/archive','GET',undefined,vault),
  archivePage:(vault:string,id:string,revision:number,archived=true)=>request<Page>(`pages/${id}/archive`,archived?'PUT':'DELETE',{revision},vault),
  pageBacklinks:(vault:string,id:string,signal?:AbortSignal)=>request<PageSummary[]>(`pages/${id}/backlinks`,'GET',undefined,vault,signal),
  reviewText:(vault:string,id:string,texts:EditorReviewText[])=>request<{suggestions:EditorReviewSuggestion[]}>(`pages/${id}/review`,'POST',{texts},vault),
  explainBlocks:(vault:string,id:string,blocks:Page['blocks'],persona?:{id:string;version?:number})=>request<{markdown:string;persona:import('../shared/ai-personas').PersonaIdentity}>(`pages/${id}/explain`,'POST',{blocks,personaId:persona?.id,personaVersion:persona?.version},vault),
  exportVault:exportVaultBackup,
  importVault:importVaultBackup,
  entityMatches:(vault:string,id:string,revision:number,signal?:AbortSignal)=>request<import('../shared/entity-match-cache').EntityMatchCache>(`pages/${id}/entity-matches?revision=${revision}`,'GET',undefined,vault,signal),
  resolveEntityMatch:(vault:string,id:string,body:{revision:number;key:string;matchId:string;entityId:string;all:boolean})=>request<{blocks:Page['blocks']}>(`pages/${id}/entity-matches`,'POST',body,vault),
  aiNotifications:(signal?:AbortSignal)=>request<import('../shared/ai-notifications').AINotificationQueue>('intelligence/notifications','GET',undefined,undefined,signal),
  readAINotifications:(body:{ids:string[]}|{through:number})=>request<import('../shared/ai-notifications').AINotificationQueue>('intelligence/notifications','PUT',body),
  scanEntities:scanEntities,
  reviewEntity:(vault:string,id:string,revision:number,scanId:string,suggestionId:string|string[],decision:'accepted'|'rejected',edits?:import('../shared/entity-scan').EntitySuggestionEdit[])=>request<import('../shared/entity-scan').EntityReview>(`pages/${id}/entity-review`,'POST',{revision,scanId,...(Array.isArray(suggestionId)?{suggestionIds:suggestionId}:{suggestionId}),decision,...(edits?{edits}:{})},vault),
  textSearch:(vault:string,query:string,signal?:AbortSignal,scope?:import('../shared/text-search').TextSearchScope,limit=100)=>request<import('../shared/text-search').TextSearchResults>('search/text','POST',{query,limit,...(scope?{scope}:{})},vault,signal),
  searchSnippets:(vault:string,query:string,pageIds:string[],signal?:AbortSignal)=>request<{snippets:Record<string,string>}>('search/snippets','POST',{query,pageIds},vault,signal),
  embeddings:(vault:string)=>request<import('../shared/embeddings').EmbeddingStatus>('embeddings','GET',undefined,vault),
  saveEmbeddingSettings:(vault:string,settings:import('../shared/embeddings').EmbeddingSettings)=>request<import('../shared/embeddings').EmbeddingStatus>('embeddings','PUT',settings,vault),
  enqueueEmbeddings:(vault:string,mode:'missing'|'eligible')=>request<{queued:number;skipped:number}>('embeddings/enqueue','POST',{mode},vault),
  retryEmbedding:(vault:string,id:string)=>request<{queued:number}>(`embeddings/jobs/${id}/retry`,'POST',{},vault),
  semanticSearch:(vault:string,query:string,signal?:AbortSignal,limit=20)=>request<import('../shared/embeddings').SemanticSearchResults>('embeddings/search','POST',{query,limit},vault,signal),
  propertyProposals:(vault:string,id:string,status='pending',signal?:AbortSignal,proposalId?:string)=>request<PropertyProposalPreview[]>(`entities/${encodeURIComponent(id)}/property-proposals?status=${encodeURIComponent(status)}${proposalId?`&proposalId=${encodeURIComponent(proposalId)}`:''}`,'GET',undefined,vault,signal),
  reviewPropertyProposal:(vault:string,id:string,proposalId:string,body:{action:'accept'|'reject'|'retain_both';fingerprint:string;target_id?:string})=>request<PropertyProposalPreview>(`entities/${encodeURIComponent(id)}/property-proposals/${encodeURIComponent(proposalId)}/review`,'POST',body,vault),
  entitySchema:(vault:string)=>request<import('../shared/entity-schema').EntitySchema>('entity-schema','GET',undefined,vault),
  createPropertyDefinition:(vault:string,body:Record<string,unknown>)=>request<import('../shared/property-definitions').PropertyDefinition>('entity-schema/definitions','POST',body,vault),
  propertyDefinitionImpact:(vault:string,id:string,body:Record<string,unknown>)=>request<{fingerprint:string;definition:import('../shared/property-definitions').PropertyDefinition;affectedValues:number;compatibleValues:number;incompatible:{propertyId:string;entityId:string;reason:string}[]}>('entity-schema/definitions/'+encodeURIComponent(id)+'/impact','POST',body,vault),
  updatePropertyDefinition:(vault:string,id:string,body:Record<string,unknown>)=>request<import('../shared/property-definitions').PropertyDefinition>('entity-schema/definitions/'+encodeURIComponent(id),'PUT',body,vault),
  entityClassificationImpact:(vault:string,id:string,body:{type:EntityInput['type'];subtypes:string[]},signal?:AbortSignal)=>request<{fingerprint:string;requiresConfirmation:boolean;outgoing:{propertyId:string;reason:string}[];incoming:{propertyId:string;reason:string}[];structuralBlockers:string[]}>('entities/'+id+'/classification-impact','POST',body,vault,signal),
  addSubtype:(vault:string,type:EntityInput['type'],name:string)=>request<import('../shared/entity-schema').EntitySchema>('entity-schema/subtypes','POST',{type,name},vault),
  addSubtypeProperty:(vault:string,type:EntityInput['type'],subtype:string,name:string)=>request<import('../shared/entity-schema').EntitySchema>('entity-schema/properties','POST',{type,subtype,name},vault),
  clearAIActivity:()=>request<{ok:true}>('intelligence/activity','DELETE'),
  aiActivity:(cursor?:number)=>request<import('../shared/intelligence').AIActivityPage>('intelligence/activity'+(cursor?'?before='+cursor:'')),
  aiDebugSettings:()=>request<import('../shared/intelligence').AIDebugSettings>('intelligence/debug'),
  saveAIDebugSettings:(enabled:boolean,fullTraceMinutes?:number)=>request<import('../shared/intelligence').AIDebugSettings>('intelligence/debug','PUT',{enabled,...(fullTraceMinutes===undefined?{}:{fullTraceMinutes})}),
  aiActivityDebug:(id:string,signal?:AbortSignal,options?:{after?:number;eventCursor?:number;limit?:number;events?:boolean})=>{
    const query=new URLSearchParams();
    if(options)for(const [key,value] of Object.entries(options))if(value!==undefined)query.set(key,typeof value==='boolean'?(value?'1':'0'):String(value));
    return request<import('../shared/intelligence').AIActivityDebug>('intelligence/activity/'+encodeURIComponent(id)+(query.size?'?'+query:''),'GET',undefined,undefined,signal);
  },
  speechModel:()=>request<SpeechModelStatus>('intelligence/speech/model'),
  downloadSpeechModel:()=>request<SpeechModelStatus>('intelligence/speech/model','POST',{}),
  intelligence:()=>request<import('../shared/domain').IntelligenceStatus>('intelligence'),
  geminiCredential:()=>request<import('../shared/intelligence').SpeechCredentialStatus>('intelligence/gemini'),
  saveGeminiCredential:(apiKey:string,days:number)=>request<import('../shared/intelligence').SpeechCredentialStatus>('intelligence/gemini','PUT',{apiKey,days}),
  removeGeminiCredential:()=>request<import('../shared/intelligence').SpeechCredentialStatus>('intelligence/gemini','DELETE'),
  saveIntelligence:(apiKey:string,days:number)=>request<import('../shared/domain').IntelligenceStatus>('intelligence','PUT',{apiKey,days}),
  saveIntelligencePreferences:(preferences:import('../shared/intelligence').IntelligenceConfiguration)=>request<import('../shared/intelligence').IntelligenceConfiguration>('intelligence/preferences','PUT',preferences),
  removeIntelligence:()=>request<import('../shared/domain').IntelligenceStatus>('intelligence','DELETE'),
  validateIntelligence:()=>request<{ok:true}&import('../shared/intelligence').IntelligencePreferences>('intelligence/validate','POST',{}),
  setPageEditLock:(vault:string,id:string,revision:number,locked:boolean,password?:string)=>request<Page>(`pages/${id}/edit-lock`,'PUT',{revision,locked,...(password===undefined?{}:{password})},vault),
  generateTitle:(vault:string,id:string,revision:number)=>request<{title:string;revision:number;pageDomains:import('../shared/domain').PageDomains}>(`pages/${id}/title`,'POST',{revision},vault),
  generateEnrichment:(vault:string,id:string,revision:number,requestedFields:('title'|'domains'|'language'|'summary')[])=>request<{title:string;revision:number;pageDomains:import('../shared/domain').PageDomains;summary?:string;contentHash?:string}>(`pages/${id}/enrich`,'POST',{revision,requestedFields},vault),
  enrichmentSettings:(vault:string,id:string)=>request<{automaticSummaries:boolean}>(`pages/${id}/enrichment-settings`,'GET',undefined,vault),
  saveEnrichmentSettings:(vault:string,id:string,automaticSummaries:boolean)=>request<{automaticSummaries:boolean}>(`pages/${id}/enrichment-settings`,'PUT',{automaticSummaries},vault),
  enrichments:(vault:string,id:string)=>request<import('../shared/domain').AIEnrichment[]>(`pages/${id}/enrichments`,'GET',undefined,vault),
  deleteSummary:(vault:string,id:string)=>request<{ok:true}>(`pages/${id}/summary`,'DELETE',undefined,vault),
  summarize:(vault:string,id:string,revision:number)=>request<import('../shared/domain').AISummary>(`pages/${id}/summary`,'POST',{revision},vault),
  organization:(vault:string)=>request<Organization>('organization','GET',undefined,vault),
  organize:(vault:string,route:string,body?:unknown,method='PUT')=>request<Organization>('organization/'+route,method,body,vault),
  vaults:()=>request<Vault[]>('vaults'),
  createVault:(name:string)=>request<Vault>('vaults','POST',{name}),
  lock:(id:string,passphrase?:string)=>request<Vault>(`vaults/${id}/lock`,'POST',{passphrase}),
  unlock:(id:string,passphrase:string)=>request<Vault>(`vaults/${id}/unlock`,'POST',{passphrase}),
  pages:(vault:string)=>request<PageSummary[]>('pages','GET',undefined,vault),
  page:(vault:string,id:string,signal?:AbortSignal)=>request<Page>(`pages/${id}/editor`,'GET',undefined,vault,signal),
  pagePreview:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/domain').PagePreview>(`pages/${id}/preview`,'GET',undefined,vault,signal),
  pageMetadata:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/domain').PageEnrichmentMetadata>(`pages/${id}/metadata`,'GET',undefined,vault,signal),
  createPage:(vault:string,destination:{collection:string;folder:string}={collection:'',folder:''})=>request<Page>('pages','POST',{title:'Untitled',destination},vault),
  savePage:(vault:string,id:string,page:PageInput)=>{
    const {entityMatchCache: _reviewCache, ...input} = page as Page;
    return request<Page>(`pages/${id}`,'PUT',input,vault);
  },
  deletePage:(vault:string,id:string)=>request<{ok:true}>(`pages/${id}`,'DELETE',undefined,vault),
  trash:(vault:string)=>request<TrashedPage[]>('trash','GET',undefined,vault),
  restorePage:(vault:string,id:string)=>request<Page>(`trash/${id}/restore`,'POST',{},vault),
  permanentlyDeletePage:(vault:string,id:string)=>request<{ok:true}>(`trash/${id}`,'DELETE',undefined,vault),
  entities:(vault:string,signal?:AbortSignal)=>request<Entity[]>('entities','GET',undefined,vault,signal),
  entityReferenceOptions:(vault:string,options:{query?:string;types?:import('../shared/domain').EntityType[];subtypes?:string[];offset?:number;limit?:number;selected?:string}={},signal?:AbortSignal)=>request<{items:Entity[];nextOffset:number|null;total:number}>(`entities/reference-options?${new URLSearchParams({q:options.query??'',types:(options.types??[]).join(','),subtypes:(options.subtypes??[]).join(','),offset:String(options.offset??0),limit:String(options.limit??30),selected:options.selected??''})}`,'GET',undefined,vault,signal),
  entity:(vault:string,id:string,preview=false)=>request<EntityDetail>(`entities/${id}${preview ? '?preview=1' : ''}`,'GET',undefined,vault),
  entityNeighborhood:(vault:string,id:string,depth:1|2,relationType?:string,signal?:AbortSignal)=>request<import('../shared/entity-neighborhood').EntityNeighborhood>(`entities/${encodeURIComponent(id)}/neighborhood?${new URLSearchParams({depth:String(depth),...(relationType?{relationType}:{})})}`,'GET',undefined,vault,signal),
  entityDiscovery:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/entity-discovery').EntityDiscovery|null>(`entities/${encodeURIComponent(id)}/discovery`,'GET',undefined,vault,signal),
  generateEntityDiscovery:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/entity-discovery').EntityDiscovery>(`entities/${encodeURIComponent(id)}/discovery`,'POST',{},vault,signal),
  reviewEntityDiscovery:(vault:string,id:string,runId:string,body:import('../shared/entity-discovery').EntityDiscoveryReview,signal?:AbortSignal)=>request<import('../shared/entity-discovery').EntityDiscovery>(`entities/${encodeURIComponent(id)}/discovery/${encodeURIComponent(runId)}/review`,'POST',body,vault,signal),
  entityOverviewEvidence:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/entity-evidence').EntityEvidence>(`entities/${encodeURIComponent(id)}/evidence?preview=1`,'GET',undefined,vault,signal),
  entityEvidence:(vault:string,id:string,signal?:AbortSignal,offset=0)=>request<import('../shared/entity-evidence').EntityEvidence>(`entities/${encodeURIComponent(id)}/evidence?offset=${offset}`,'GET',undefined,vault,signal),
  createEntityPage:(vault:string,id:string,body:{title?:string}={})=>request<Page>(`entities/${id}/pages`,'POST',body,vault),
  saveEntityOverview:(vault:string,id:string,body:{content:string;revision:number})=>request<EntityDetail>(`entities/${id}/overview`,'PUT',body,vault),
  associateEntityPage:(vault:string,id:string,pageId:string,body:{pinned?:boolean;annotation?:string}={})=>request<EntityDetail>(`entities/${id}/pages/${pageId}`,'PUT',body,vault),
  removeEntityPage:(vault:string,id:string,pageId:string)=>request<EntityDetail>(`entities/${id}/pages/${pageId}`,'DELETE',undefined,vault),
  pageEntityAssociations:(vault:string,id:string,signal?:AbortSignal)=>request<import('../shared/domain').PageEntityAssociation[]>(`pages/${id}/entities`,'GET',undefined,vault,signal),
  sourceLifecycle:(vault:string,id:string)=>request<import('../shared/entity-lifecycle').EntityImpact>(`entities/${id}/lifecycle`,'GET',undefined,vault),
  changeSourceLifecycle:(vault:string,id:string,action:'archive'|'restore'|'delete',confirmation?:string,version?:string)=>request<import('../shared/entity-lifecycle').EntityImpact|{ok:true}>(`entities/${id}/lifecycle`,'POST',{action,confirmation,version},vault),
  createEntity:(vault:string,input:EntityInput)=>request<EntityDetail>('entities','POST',input,vault),
  updateEntity:(vault:string,id:string,input:EntityInput)=>request<EntityDetail>(`entities/${id}`,'PUT',input,vault),
  addEntityAlias:(vault:string,id:string,alias:string)=>request<EntityDetail>(`entities/${id}/aliases`,'POST',{alias},vault),
  saveProperty:(vault:string,id:string,input:PropertyInput,propertyId?:string)=>request<EntityDetail>(`entities/${id}/properties${propertyId?'/'+propertyId:''}`,propertyId?'PUT':'POST',input,vault),
  saveRelationship:(vault:string,id:string,input:RelationshipInput,relationshipId?:string)=>request<EntityDetail>(`entities/${id}/relationships${relationshipId?'/'+relationshipId:''}`,relationshipId?'PUT':'POST',input,vault),
  removeConnection:(vault:string,id:string,kind:'properties'|'relationships',childId:string)=>request<EntityDetail>(`entities/${id}/${kind}/${childId}`,'DELETE',undefined,vault),
};

/** Consume provisional text deltas and verified blocks, retaining the saved draft for recovery. */
export async function createPageFromSource(vault:string,sourceId:string,focus:string,options:import('../shared/source-page').SourcePageOptions,requestId:string,onEvent:(event:import('../shared/source-page').SourcePageEvent)=>void,signal:AbortSignal,revision?:import('../shared/source-page').SourcePageRevision,personaId?:string):Promise<void> {
  const response=await fetch(`/api/entities/${encodeURIComponent(sourceId)}/create-page`,{method:'POST',signal,headers:{'X-Noema-Request':'1','X-Vault-Id':vault,'Content-Type':'application/json'},body:JSON.stringify({focus,options,requestId,...(personaId?{personaId}:{}),...(revision?{revision}:{})})});
  if(!response.ok){const result=await response.json();throw new ApiError(response.status,result.error||'Could not create a page from this source.');}
  const reader=response.body?.getReader();
  if(!reader)throw new Error('The page stream is unavailable. Please retry.');
  const decoder=new TextDecoder();let pending='',size=0,terminal=false,finished=false;
  const consume=(line:string)=>{
    if(!line.trim())return;
    const event=JSON.parse(line) as import('../shared/source-page').SourcePageEvent;
    if(event.type==='error')throw new Error(event.message);
    if(event.type==='completed'||event.type==='review'){terminal=true;window.dispatchEvent(new Event('noema:ai-activity'));}
    onEvent(event);
  };
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;if(size>1024*1024)throw new Error('The page stream exceeded its size limit.');
      pending+=decoder.decode(value,{stream:true});
      let newline:number;while(!terminal&&(newline=pending.indexOf('\n'))>=0){consume(pending.slice(0,newline));pending=pending.slice(newline+1);}
      if(terminal){finished=true;await reader.cancel().catch(()=>{});return;}
    }
    pending+=decoder.decode();if(pending.trim())consume(pending);
    if(!terminal)throw new Error('The connection ended before the draft was confirmed. Retry to recover the result.');
    finished=true;
  }finally{if(!finished)await reader.cancel().catch(()=>{});reader.releaseLock();window.dispatchEvent(new Event('noema:ai-activity'));}
}

/** Provisional scan rows are display-only until the completed event confirms persistence. */
export async function scanEntities(vault:string,id:string,revision:number,onProgress?:(scan:import('../shared/entity-scan').EntityScan)=>void,signal?:AbortSignal,continuation?:{scanId:string;token:string}):Promise<import('../shared/entity-scan').EntityScan> {
  const response=await fetch(`/api/pages/${id}/entity-scan`,{method:'POST',signal,headers:{'X-Noema-Request':'1','X-Vault-Id':vault,'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify({revision,...(continuation?{continueScanId:continuation.scanId,continuationToken:continuation.token}:{})})});
  if(!response.ok){const result=await response.json();throw new ApiError(response.status,result.error||'Entity scan failed.');}
  const reader=response.body?.getReader();if(!reader)throw new Error('The entity scan stream is unavailable.');
  const decoder=new TextDecoder();let pending='',size=0,completed:import('../shared/entity-scan').EntityScan|undefined;
  const consume=(line:string)=>{
    if(!line.trim())return;
    const event=JSON.parse(line) as import('../shared/entity-scan').EntityScanEvent;
    if(event.type==='error')throw new Error(event.message);
    if(event.type==='progress')onProgress?.(event.scan);
    if(event.type==='completed')completed=event.scan;
  };
  try {
    while(!completed) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>16*1024*1024)throw new Error('The entity scan exceeded its size limit.');
      pending+=decoder.decode(value,{stream:true});
      let newline:number;while(!completed&&(newline=pending.indexOf('\n'))>=0){consume(pending.slice(0,newline));pending=pending.slice(newline+1);}
    }
    if(!completed){pending+=decoder.decode();if(pending.trim())consume(pending);}
    if(!completed)throw new Error('The connection ended before the scan finished. Please scan again.');
    return completed;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();if(typeof window!=='undefined')window.dispatchEvent(new Event('noema:ai-activity'));}
}
