import type { WorkspaceState } from './workspace';

export type InboxFacet = 'overview'|'review'|'organise'|'issues'|'progress'|'activity';
export function inboxFacet(value:unknown):InboxFacet {return ['overview','review','organise','issues','progress','activity'].includes(String(value))?value as InboxFacet:'overview';}

export interface NavigationAddress {
  inboxFacet?: InboxFacet; view: WorkspaceState['view']; pageId: string | null; sourceId?: string | null; entityId: string | null; subjectId?: string | null; collection: string; folder: string;
}
export interface WorkspaceAddress extends NavigationAddress { vaultId: string }
const views = ['review', 'calendar', 'pages', 'source', 'entity', 'entities', 'organization', 'favourites', 'recent', 'trash', 'archive', 'inbox'] as const;

export function readWorkspaceURL(): WorkspaceAddress | null {
  const params = new URLSearchParams(window.location.search);
  const vaultId = params.get('vault');
  if (!vaultId) return null;
  const pageId = params.get('page');
  const sourceId = params.get('source');
  const requestedView = params.get('view');
  const view = pageId ? 'pages' : sourceId ? 'source' : requestedView==='review'?'inbox':requestedView ?? 'organization';
  if (!views.some(item => item === view)) return null;
  return {vaultId, ...(view==='inbox'?{inboxFacet:requestedView==='review'?'review' as const:inboxFacet(params.get('facet'))}:{}), view: view as WorkspaceState['view'], pageId, sourceId, entityId: params.get('entity'), subjectId: params.get('subject'), collection: params.get('collection') ?? '', folder: params.get('folder') ?? ''};
}

export function workspaceURL(address: WorkspaceAddress): string {
  const params = new URLSearchParams({vault: address.vaultId});
  if (address.view === 'pages' && address.pageId) params.set('page', address.pageId);
  else if (address.view === 'source' && address.sourceId) params.set('source', address.sourceId);
  else params.set('view', address.view);
  if (address.view === 'inbox') params.set('facet',address.inboxFacet??'overview');
  if (address.view === 'entity' && address.subjectId) params.set('subject', address.subjectId);
  if (address.view === 'organization') {
    if (address.collection) params.set('collection', address.collection);
    if (address.folder) params.set('folder', address.folder);
  }
  if (address.entityId) params.set('entity', address.entityId);
  return '/?' + params.toString();
}
export function pageURL(vaultId: string, pageId: string): string {
  return workspaceURL({vaultId, pageId, view:'pages', entityId:null, collection:'', folder:''});
}

/** A full entity workspace; the `entity` parameter remains the contextual panel. */
export function entityURL(vaultId: string, entityId: string): string {
  return workspaceURL({vaultId, view:'entity', subjectId:entityId, pageId:null, entityId:null, collection:'', folder:''});
}
