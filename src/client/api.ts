import type { Entity, EntityDetail, EntityInput, PropertyInput, RelationshipInput, Page, PageInput, PageSummary, Vault } from '../shared/domain';
export class ApiError extends Error { constructor(public status: number,message: string){super(message);} }
export async function request<T>(route: string, method='GET', body?: unknown, vaultId?: string): Promise<T> {
  const response=await fetch('/api/'+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(vaultId?{'X-Vault-Id':vaultId}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  const result:unknown=await response.json();
  if(!response.ok)throw new ApiError(response.status,typeof result==='object'&&result&&'error' in result?String(result.error):'Request failed');
  return result as T;
}
export const api={
  vaults:()=>request<Vault[]>('vaults'),
  createVault:(name:string)=>request<Vault>('vaults','POST',{name}),
  lock:(id:string,passphrase?:string)=>request<Vault>(`vaults/${id}/lock`,'POST',{passphrase}),
  unlock:(id:string,passphrase:string)=>request<Vault>(`vaults/${id}/unlock`,'POST',{passphrase}),
  pages:(vault:string)=>request<PageSummary[]>('pages','GET',undefined,vault),
  page:(vault:string,id:string)=>request<Page>(`pages/${id}`,'GET',undefined,vault),
  createPage:(vault:string)=>request<Page>('pages','POST',{title:'Untitled'},vault),
  savePage:(vault:string,id:string,page:PageInput)=>request<Page>(`pages/${id}`,'PUT',page,vault),
  deletePage:(vault:string,id:string)=>request<{ok:true}>(`pages/${id}`,'DELETE',undefined,vault),
  entities:(vault:string)=>request<Entity[]>('entities','GET',undefined,vault),
  entity:(vault:string,id:string)=>request<EntityDetail>(`entities/${id}`,'GET',undefined,vault),
  createEntity:(vault:string,input:EntityInput)=>request<EntityDetail>('entities','POST',input,vault),
  updateEntity:(vault:string,id:string,input:EntityInput)=>request<EntityDetail>(`entities/${id}`,'PUT',input,vault),
  saveProperty:(vault:string,id:string,input:PropertyInput,propertyId?:string)=>request<EntityDetail>(`entities/${id}/properties${propertyId?'/'+propertyId:''}`,propertyId?'PUT':'POST',input,vault),
  saveRelationship:(vault:string,id:string,input:RelationshipInput,relationshipId?:string)=>request<EntityDetail>(`entities/${id}/relationships${relationshipId?'/'+relationshipId:''}`,relationshipId?'PUT':'POST',input,vault),
  removeConnection:(vault:string,id:string,kind:'properties'|'relationships',childId:string)=>request<EntityDetail>(`entities/${id}/${kind}/${childId}`,'DELETE',undefined,vault),
};
