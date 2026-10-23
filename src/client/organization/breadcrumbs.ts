import type { Folder, Organization, OrganizationContext, PageSummary } from '../../shared/domain';

export interface LocationBreadcrumb {
  key: string;
  label: string;
  icon?: string;
  target?: OrganizationContext;
}

/** Resolve the absolute storage path, independently of collection/navigation context. */
export function folderBreadcrumbs(folders: Folder[], folderId: string | null | undefined): LocationBreadcrumb[] {
  const path: LocationBreadcrumb[] = [];
  const visited = new Set<string>();
  let folder = folders.find(item => item.id === folderId);
  while (folder && !visited.has(folder.id)) {
    visited.add(folder.id);
    path.unshift({key: 'folder:' + folder.id, label: folder.name, icon: 'folder', target: {collection: '', folder: folder.id}});
    folder = folders.find(item => item.id === folder!.parent_id);
  }
  return path;
}

export function pageBreadcrumbs(organization: Organization, page: PageSummary | null): LocationBreadcrumb[] {
  const path: LocationBreadcrumb[] = [];
  if (!page) return path;
  const location = organization.locations.find(item => item.kind === 'page' && item.item_id === page.id);
  path.push(...folderBreadcrumbs(organization.folders, location?.folder_id));
  path.push({key: 'page:' + page.id, label: page.title || 'Untitled'});
  return path;
}
