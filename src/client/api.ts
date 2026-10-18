import type { Organization, Entity, EntityDetail, EntityInput, PropertyInput, RelationshipInput, Page, PageInput, PageSummary, Vault, TrashedPage } from '../shared/domain';
export class ApiError extends Error { constructor(public status: number,message: string){super(message);} }
export async function request<T>(route: string, method='GET', body?: unknown, vaultId?: string, signal?: AbortSignal): Promise<T> {
  const response=await fetch('/api/'+route,{method,signal,headers:{'X-Noema-Request':'1',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(vaultId?{'X-Vault-Id':vaultId}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  const result:unknown=await response.json();
  if(/^pages\/[^/]+\/(title|summary|entity-scan|explain)$/.test(route)&&typeof window!=='undefined')window.dispatchEvent(new Event('noema:ai-activity'));
  if(!response.ok)throw new ApiError(response.status,typeof result==='object'&&result&&'error' in result?String(result.error):'Request failed');
  return result as T;
}
export function imageURL(vault: string, id: string) { return `/api/images/${encodeURIComponent(id)}?vault=${encodeURIComponent(vault)}`; }
export async function uploadImage(vault: string, file: File): Promise<{id: string}> {
  if(file.size > 20 * 1024 * 1024) throw new Error('Images must be 20 MB or smaller');
  const response = await fetch('/api/images', {method:'POST', headers:{'X-Noema-Request':'1','X-Vault-Id':vault,'Content-Type':'application/octet-stream'}, body:file});
  const result = await response.json();
  if(!response.ok) throw new ApiError(response.status,result.error || 'Image upload failed');
  return result;
}
export async function uploadSourceFile(vault:string,file:File,entityId?:string):Promise<import('../shared/domain').SourceFile> {
  const params=new URLSearchParams({name:file.name});if(entityId)params.set('entity',entityId);
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
  networkSettings:(signal?:AbortSignal)=>request<import('../shared/security').NetworkSettings>('security/network','GET',undefined,undefined,signal),
  saveNetworkSettings:(lan:boolean)=>request<import('../shared/security').NetworkSettings>('security/network','PUT',{lan}),
  setVaultPassphrase:(id:string,currentPassphrase:string,passphrase:string|null)=>request<Vault>(`vaults/${encodeURIComponent(id)}/passphrase`,'PUT',{currentPassphrase,passphrase}),
  previewVaultDeletion:(id:string)=>request<import('../shared/domain').VaultDeletionPreview>(`vaults/${encodeURIComponent(id)}/deletion-preview`),
  deleteVault:(id:string,confirmation:import('../shared/domain').VaultDeletionConfirmation)=>request<import('../shared/domain').VaultDeletionResult>(`vaults/${encodeURIComponent(id)}/delete`,'POST',confirmation),
  pageBacklinks:(vault:string,id:string,signal?:AbortSignal)=>request<PageSummary[]>(`pages/${id}/backlinks`,'GET',undefined,vault,signal),
  explainBlocks:(vault:string,id:string,blocks:Page['blocks'])=>request<{markdown:string}>(`pages/${id}/explain`,'POST',{blocks},vault),
  exportVault:exportVaultBackup,
  importVault:importVaultBackup,
  entityMatches:(vault:string,id:string,revision:number,signal?:AbortSignal)=>request<import('../shared/entity-match-cache').EntityMatchCache>(`pages/${id}/entity-matches?revision=${revision}`,'GET',undefined,vault,signal),
  resolveEntityMatch:(vault:string,id:string,body:{revision:number;key:string;matchId:string;entityId:string;all:boolean})=>request<{blocks:Page['blocks']}>(`pages/${id}/entity-matches`,'POST',body,vault),
  aiNotifications:(signal?:AbortSignal)=>request<import('../shared/ai-notifications').AINotificationQueue>('intelligence/notifications','GET',undefined,undefined,signal),
  readAINotifications:(body:{ids:string[]}|{through:number})=>request<import('../shared/ai-notifications').AINotificationQueue>('intelligence/notifications','PUT',body),
  scanEntities:(vault:string,id:string,revision:number)=>request<import('../shared/entity-scan').EntityScan>(`pages/${id}/entity-scan`,'POST',{revision},vault),
  reviewEntity:(vault:string,id:string,revision:number,scanId:string,suggestionId:string|string[],decision:'accepted'|'rejected',edits?:import('../shared/entity-scan').EntitySuggestionEdit[])=>request<import('../shared/entity-scan').EntityReview>(`pages/${id}/entity-review`,'POST',{revision,scanId,...(Array.isArray(suggestionId)?{suggestionIds:suggestionId}:{suggestionId}),decision,...(edits?{edits}:{})},vault),
  textSearch:(vault:string,query:string,signal?:AbortSignal,scope?:import('../shared/text-search').TextSearchScope,limit=100)=>request<import('../shared/text-search').TextSearchResults>('search/text','POST',{query,limit,...(scope?{scope}:{})},vault,signal),
  searchSnippets:(vault:string,query:string,pageIds:string[],signal?:AbortSignal)=>request<{snippets:Record<string,string>}>('search/snippets','POST',{query,pageIds},vault,signal),
  embeddings:(vault:string)=>request<import('../shared/embeddings').EmbeddingStatus>('embeddings','GET',undefined,vault),
  saveEmbeddingSettings:(vault:string,settings:import('../shared/embeddings').EmbeddingSettings)=>request<import('../shared/embeddings').EmbeddingStatus>('embeddings','PUT',settings,vault),
  enqueueEmbeddings:(vault:string,mode:'missing'|'eligible')=>request<{queued:number;skipped:number}>('embeddings/enqueue','POST',{mode},vault),
  retryEmbedding:(vault:string,id:string)=>request<{queued:number}>(`embeddings/jobs/${id}/retry`,'POST',{},vault),
  semanticSearch:(vault:string,query:string,signal?:AbortSignal,limit=20)=>request<import('../shared/embeddings').SemanticSearchResults>('embeddings/search','POST',{query,limit},vault,signal),
  entitySchema:(vault:string)=>request<import('../shared/entity-schema').EntitySchema>('entity-schema','GET',undefined,vault),
  addSubtype:(vault:string,type:EntityInput['type'],name:string)=>request<import('../shared/entity-schema').EntitySchema>('entity-schema/subtypes','POST',{type,name},vault),
  addSubtypeProperty:(vault:string,type:EntityInput['type'],subtype:string,name:string)=>request<import('../shared/entity-schema').EntitySchema>('entity-schema/properties','POST',{type,subtype,name},vault),
  clearAIActivity:()=>request<{ok:true}>('intelligence/activity','DELETE'),
  aiActivity:(cursor?:number)=>request<import('../shared/intelligence').AIActivityPage>('intelligence/activity'+(cursor?'?before='+cursor:'')),
  aiDebugSettings:()=>request<import('../shared/intelligence').AIDebugSettings>('intelligence/debug'),
  saveAIDebugSettings:(enabled:boolean)=>request<import('../shared/intelligence').AIDebugSettings>('intelligence/debug','PUT',{enabled}),
  aiActivityDebug:(id:string,signal?:AbortSignal)=>request<import('../shared/intelligence').AIActivityDebug>('intelligence/activity/'+encodeURIComponent(id),'GET',undefined,undefined,signal),
  intelligence:()=>request<import('../shared/domain').IntelligenceStatus>('intelligence'),
  saveIntelligence:(apiKey:string,days:number)=>request<import('../shared/domain').IntelligenceStatus>('intelligence','PUT',{apiKey,days}),
  saveIntelligencePreferences:(preferences:import('../shared/intelligence').IntelligenceConfiguration)=>request<import('../shared/intelligence').IntelligenceConfiguration>('intelligence/preferences','PUT',preferences),
  removeIntelligence:()=>request<import('../shared/domain').IntelligenceStatus>('intelligence','DELETE'),
  validateIntelligence:()=>request<{ok:true}&import('../shared/intelligence').IntelligencePreferences>('intelligence/validate','POST',{}),
  setPageEditLock:(vault:string,id:string,revision:number,locked:boolean,password?:string)=>request<Page>(`pages/${id}/edit-lock`,'PUT',{revision,locked,...(password===undefined?{}:{password})},vault),
  generateTitle:(vault:string,id:string,revision:number,background=false)=>request<{title:string;revision:number;conceptClassification:import('../shared/domain').ConceptClassification}>(`pages/${id}/title`,'POST',{revision,background},vault),
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
  createPage:(vault:string)=>request<Page>('pages','POST',{title:'Untitled'},vault),
  savePage:(vault:string,id:string,page:PageInput)=>{
    const {entityMatchCache: _reviewCache, ...input} = page as Page;
    return request<Page>(`pages/${id}`,'PUT',input,vault);
  },
  deletePage:(vault:string,id:string)=>request<{ok:true}>(`pages/${id}`,'DELETE',undefined,vault),
  trash:(vault:string)=>request<TrashedPage[]>('trash','GET',undefined,vault),
  restorePage:(vault:string,id:string)=>request<Page>(`trash/${id}/restore`,'POST',{},vault),
  permanentlyDeletePage:(vault:string,id:string)=>request<{ok:true}>(`trash/${id}`,'DELETE',undefined,vault),
  entities:(vault:string,signal?:AbortSignal)=>request<Entity[]>('entities','GET',undefined,vault,signal),
  entity:(vault:string,id:string)=>request<EntityDetail>(`entities/${id}`,'GET',undefined,vault),
  createEntity:(vault:string,input:EntityInput)=>request<EntityDetail>('entities','POST',input,vault),
  updateEntity:(vault:string,id:string,input:EntityInput)=>request<EntityDetail>(`entities/${id}`,'PUT',input,vault),
  addEntityAlias:(vault:string,id:string,alias:string)=>request<EntityDetail>(`entities/${id}/aliases`,'POST',{alias},vault),
  saveProperty:(vault:string,id:string,input:PropertyInput,propertyId?:string)=>request<EntityDetail>(`entities/${id}/properties${propertyId?'/'+propertyId:''}`,propertyId?'PUT':'POST',input,vault),
  saveRelationship:(vault:string,id:string,input:RelationshipInput,relationshipId?:string)=>request<EntityDetail>(`entities/${id}/relationships${relationshipId?'/'+relationshipId:''}`,relationshipId?'PUT':'POST',input,vault),
  removeConnection:(vault:string,id:string,kind:'properties'|'relationships',childId:string)=>request<EntityDetail>(`entities/${id}/${kind}/${childId}`,'DELETE',undefined,vault),
};

/** Consume provisional text deltas and verified blocks, retaining the saved draft for recovery. */
export async function createPageFromSource(vault:string,sourceId:string,focus:string,options:import('../shared/source-page').SourcePageOptions,requestId:string,onEvent:(event:import('../shared/source-page').SourcePageEvent)=>void,signal:AbortSignal,revision?:import('../shared/source-page').SourcePageRevision):Promise<void> {
  const response=await fetch(`/api/entities/${encodeURIComponent(sourceId)}/create-page`,{method:'POST',signal,headers:{'X-Noema-Request':'1','X-Vault-Id':vault,'Content-Type':'application/json'},body:JSON.stringify({focus,options,requestId,...(revision?{revision}:{})})});
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
