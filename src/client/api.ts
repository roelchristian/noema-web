import type { Organization, Entity, EntityDetail, EntityInput, PropertyInput, RelationshipInput, Page, PageInput, PageSummary, Vault, TrashedPage } from '../shared/domain';
export class ApiError extends Error { constructor(public status: number,message: string){super(message);} }
export async function request<T>(route: string, method='GET', body?: unknown, vaultId?: string, signal?: AbortSignal): Promise<T> {
  const response=await fetch('/api/'+route,{method,signal,headers:{'X-Noema-Request':'1',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(vaultId?{'X-Vault-Id':vaultId}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  const result:unknown=await response.json();
  if(!response.ok)throw new ApiError(response.status,typeof result==='object'&&result&&'error' in result?String(result.error):'Request failed');
  return result as T;
}
export const api={
  scanEntities:(vault:string,id:string,revision:number)=>request<import('../shared/entity-scan').EntityScan>(`pages/${id}/entity-scan`,'POST',{revision},vault),
  reviewEntity:(vault:string,id:string,revision:number,scanId:string,suggestionId:string|string[],decision:'accepted'|'rejected',edits?:import('../shared/entity-scan').EntitySuggestionEdit[])=>request<import('../shared/entity-scan').EntityReview>(`pages/${id}/entity-review`,'POST',{revision,scanId,...(Array.isArray(suggestionId)?{suggestionIds:suggestionId}:{suggestionId}),decision,...(edits?{edits}:{})},vault),
  searchSnippets:(vault:string,query:string,pageIds:string[],signal?:AbortSignal)=>request<{snippets:Record<string,string>}>('search/snippets','POST',{query,pageIds},vault,signal),
  embeddings:(vault:string)=>request<import('../shared/embeddings').EmbeddingStatus>('embeddings','GET',undefined,vault),
  saveEmbeddingSettings:(vault:string,settings:import('../shared/embeddings').EmbeddingSettings)=>request<import('../shared/embeddings').EmbeddingStatus>('embeddings','PUT',settings,vault),
  enqueueEmbeddings:(vault:string,mode:'missing'|'eligible')=>request<{queued:number;skipped:number}>('embeddings/enqueue','POST',{mode},vault),
  retryEmbedding:(vault:string,id:string)=>request<{queued:number}>(`embeddings/jobs/${id}/retry`,'POST',{},vault),
  semanticSearch:(vault:string,query:string,signal?:AbortSignal,limit=20)=>request<import('../shared/embeddings').SemanticSearchResults>('embeddings/search','POST',{query,limit},vault,signal),
  entitySchema:(vault:string)=>request<import('../shared/entity-schema').EntitySchema>('entity-schema','GET',undefined,vault),
  addSubtype:(vault:string,type:EntityInput['type'],name:string)=>request<import('../shared/entity-schema').EntitySchema>('entity-schema/subtypes','POST',{type,name},vault),
  addTypeProperty:(vault:string,type:EntityInput['type'],name:string)=>request<import('../shared/entity-schema').EntitySchema>('entity-schema/properties','POST',{type,name},vault),
  clearAIActivity:()=>request<{ok:true}>('intelligence/activity','DELETE'),
  aiActivity:(cursor?:number)=>request<import('../shared/intelligence').AIActivityPage>('intelligence/activity'+(cursor?'?before='+cursor:'')),
  intelligence:()=>request<import('../shared/domain').IntelligenceStatus>('intelligence'),
  saveIntelligence:(apiKey:string,days:number)=>request<import('../shared/domain').IntelligenceStatus>('intelligence','PUT',{apiKey,days}),
  saveIntelligencePreferences:(preferences:import('../shared/intelligence').IntelligencePreferences)=>request<import('../shared/intelligence').IntelligencePreferences>('intelligence/preferences','PUT',preferences),
  removeIntelligence:()=>request<import('../shared/domain').IntelligenceStatus>('intelligence','DELETE'),
  validateIntelligence:()=>request<{ok:true}&import('../shared/intelligence').IntelligencePreferences>('intelligence/validate','POST',{}),
  generateTitle:(vault:string,id:string,revision:number)=>request<{title:string;revision:number}>(`pages/${id}/title`,'POST',{revision},vault),
  enrichments:(vault:string,id:string)=>request<import('../shared/domain').AIEnrichment[]>(`pages/${id}/enrichments`,'GET',undefined,vault),
  summarize:(vault:string,id:string,revision:number)=>request<import('../shared/domain').AISummary>(`pages/${id}/summary`,'POST',{revision},vault),
  organization:(vault:string)=>request<Organization>('organization','GET',undefined,vault),
  organize:(vault:string,route:string,body?:unknown,method='PUT')=>request<Organization>('organization/'+route,method,body,vault),
  vaults:()=>request<Vault[]>('vaults'),
  createVault:(name:string)=>request<Vault>('vaults','POST',{name}),
  lock:(id:string,passphrase?:string)=>request<Vault>(`vaults/${id}/lock`,'POST',{passphrase}),
  unlock:(id:string,passphrase:string)=>request<Vault>(`vaults/${id}/unlock`,'POST',{passphrase}),
  pages:(vault:string)=>request<PageSummary[]>('pages','GET',undefined,vault),
  page:(vault:string,id:string)=>request<Page>(`pages/${id}`,'GET',undefined,vault),
  createPage:(vault:string)=>request<Page>('pages','POST',{title:'Untitled'},vault),
  savePage:(vault:string,id:string,page:PageInput)=>request<Page>(`pages/${id}`,'PUT',page,vault),
  deletePage:(vault:string,id:string)=>request<{ok:true}>(`pages/${id}`,'DELETE',undefined,vault),
  trash:(vault:string)=>request<TrashedPage[]>('trash','GET',undefined,vault),
  restorePage:(vault:string,id:string)=>request<Page>(`trash/${id}/restore`,'POST',{},vault),
  permanentlyDeletePage:(vault:string,id:string)=>request<{ok:true}>(`trash/${id}`,'DELETE',undefined,vault),
  entities:(vault:string)=>request<Entity[]>('entities','GET',undefined,vault),
  entity:(vault:string,id:string)=>request<EntityDetail>(`entities/${id}`,'GET',undefined,vault),
  createEntity:(vault:string,input:EntityInput)=>request<EntityDetail>('entities','POST',input,vault),
  updateEntity:(vault:string,id:string,input:EntityInput)=>request<EntityDetail>(`entities/${id}`,'PUT',input,vault),
  saveProperty:(vault:string,id:string,input:PropertyInput,propertyId?:string)=>request<EntityDetail>(`entities/${id}/properties${propertyId?'/'+propertyId:''}`,propertyId?'PUT':'POST',input,vault),
  saveRelationship:(vault:string,id:string,input:RelationshipInput,relationshipId?:string)=>request<EntityDetail>(`entities/${id}/relationships${relationshipId?'/'+relationshipId:''}`,relationshipId?'PUT':'POST',input,vault),
  removeConnection:(vault:string,id:string,kind:'properties'|'relationships',childId:string)=>request<EntityDetail>(`entities/${id}/${kind}/${childId}`,'DELETE',undefined,vault),
};
