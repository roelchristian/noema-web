import type { Organization, OrganizationContext } from '../../shared/domain';
import { Icon } from '../components/Icon';

export function SidebarOrganization({data, context, active, disabled, onOpen}: {
  data: Organization; context: OrganizationContext; active: boolean; disabled: boolean;
  onOpen: (collection?: string, folder?: string) => void;
}) {
  function folders(collection: string, parent: string | null, depth: number) {
    return data.folders.filter(folder => (folder.collection_id || '') === collection && folder.parent_id === parent).map(folder => <div key={folder.id}>
      <button className={'nav container-link ' + (active && context.folder === folder.id ? 'active' : '')} style={{paddingLeft: 12 + Math.min(depth, 5) * 12}} disabled={disabled} aria-label={'Open folder: ' + folder.name} title={folder.name} onClick={() => onOpen(collection, folder.id)}><span data-icon="folder"><Icon name="folder"/></span><span>{folder.name}</span></button>
      {folders(collection, folder.id, depth + 1)}
    </div>);
  }
  return <nav className="sidebar-group organization-sidebar" aria-label="Folders and collections">
    <div className="workspace-label">FOLDERS & COLLECTIONS</div>
    <button className={'nav ' + (active && !context.collection && !context.folder ? 'active' : '')} disabled={disabled} aria-label="Browse all content" title="All content" onClick={() => onOpen()}><span data-icon="folder"><Icon name="folder"/></span><span>All content</span></button>
    {!disabled && <>{folders('', null, 0)}{data.collections.map(collection => <div key={collection.id}>
      <button className={'nav container-link ' + (active && context.collection === collection.id && !context.folder ? 'active' : '')} disabled={disabled} aria-label={'Open collection: ' + collection.name} title={collection.name} onClick={() => onOpen(collection.id)}><span data-icon="collection"><Icon name="collection"/></span><span>{collection.name}</span></button>
      {folders(collection.id, null, 1)}
    </div>)}{!data.collections.length && !data.folders.length && <p className="sidebar-empty">Create folders and collections in All content.</p>}</>}
  </nav>;
}
