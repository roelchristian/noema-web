import type { WorkspaceState } from './workspace';

export interface NavigationAddress {
  view: WorkspaceState['view']; pageId: string | null; entityId: string | null; collection: string; folder: string;
}
export interface WorkspaceAddress extends NavigationAddress { vaultId: string }
const views = ['pages', 'entities', 'organization', 'favourites', 'recent', 'trash', 'inbox'] as const;

export function readWorkspaceURL(): WorkspaceAddress | null {
  const params = new URLSearchParams(window.location.search);
  const vaultId = params.get('vault');
  if (!vaultId) return null;
  const pageId = params.get('page');
  const view = pageId ? 'pages' : params.get('view') ?? 'organization';
  if (!views.some(item => item === view)) return null;
  return {vaultId, view: view as WorkspaceState['view'], pageId, entityId: params.get('entity'), collection: params.get('collection') ?? '', folder: params.get('folder') ?? ''};
}

export function workspaceURL(address: WorkspaceAddress): string {
  const params = new URLSearchParams({vault: address.vaultId});
  if (address.view === 'pages' && address.pageId) params.set('page', address.pageId);
  else params.set('view', address.view);
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
