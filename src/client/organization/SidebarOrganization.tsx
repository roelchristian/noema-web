import { useRef, useState, type DragEvent } from 'react';
import type { Organization, OrganizationContext, PageSummary } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageIcon } from '../components/PageIcon';
import { ActionMenu } from '../components/ActionMenu';
import { NameDialog } from '../components/NameDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { isPageDrag, readPageDrop, startPageDrag } from './page-drag';

interface Container {type: 'collections' | 'folders'; id?: string; name: string; collection: string; parent: string}
export function SidebarOrganization({vaultId, data, pages, context, active, disabled, onOpen, onOpenPage, onMovePage, onChanged, onError}: {
  vaultId?: string; data: Organization; pages: PageSummary[]; context: OrganizationContext; active: boolean; disabled: boolean;
  onOpen: (collection?: string, folder?: string) => void; onOpenPage: (id: string) => void;
  onMovePage: (id: string, collection: string, folder: string | null) => Promise<void>;
  onChanged: (data: Organization) => void; onError: (error: unknown) => void;
}) {
  const [edit, setEdit] = useState<Container | null>(null), [remove, setRemove] = useState<Container | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null), [dropStatus, setDropStatus] = useState('');
  const dropping = useRef(false);
  const toggle = (id: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const newFolder = (collection: string, parent = '') => setEdit({type: 'folders', name: '', collection, parent});
  const containedPages = (collection: string, folder: string | null) => pages.filter(page => data.locations.some(location => location.kind === 'page' && location.item_id === page.id && location.collection_id === collection && location.folder_id === folder));
  async function drop(event: DragEvent, container: Container) {
    event.preventDefault(); setDropTarget(null);
    if (disabled || dropping.current || !vaultId) return;
    const id = readPageDrop(event, vaultId);
    if (!id || !pages.some(page => page.id === id)) return;
    dropping.current = true;
    setDropStatus('Saving page location…');
    try {
      await onMovePage(id, container.collection, container.type === 'folders' ? container.id! : null);
      setCollapsed(previous => { const next = new Set(previous); next.delete(container.id!); return next; });
      setDropStatus(`Page added to ${container.name}`);
    } catch (error) { setDropStatus('Could not move page. Try again.'); onError(error); }
    finally { dropping.current = false; }
  }
  function item(container: Container, depth = 0) {
    const selected = active && (container.type === 'folders' ? context.folder === container.id : context.collection === container.id && !context.folder);
    const open = () => onOpen(container.collection, container.type === 'folders' ? container.id : '');
    const hasChildren = data.folders.some(folder => folder.collection_id === container.collection && folder.parent_id === (container.type === 'folders' ? container.id : null)) || containedPages(container.collection, container.type === 'folders' ? container.id! : null).length > 0;
    const icon = container.type === 'folders' ? 'folder' : 'collection';
    return <div className={'sidebar-item-row organization-branch ' + (selected ? 'is-selected ' : '') + (dropTarget === container.id ? 'is-drop-target' : '')} style={{paddingLeft: Math.min(depth, 5) * 12}}
      onDragOver={event => { if (!disabled && !dropping.current && isPageDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(container.id!); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current === container.id ? null : current); }}
      onDrop={event => void drop(event, container)}>
      {hasChildren ? <button className="branch-toggle" disabled={disabled} aria-label={(collapsed.has(container.id!) ? 'Expand ' : 'Collapse ') + container.name} aria-expanded={!collapsed.has(container.id!)} onClick={() => toggle(container.id!)}><span className="branch-container-icon"><Icon name={icon}/></span><span className="branch-chevron"><Icon name="chevron"/></span></button> : <button className="branch-leaf-icon" disabled={disabled} aria-label={'Open ' + container.name} onClick={open}><Icon name={icon}/></button>}
      <button className={'nav container-link ' + (selected ? 'active' : '')} disabled={disabled} aria-label={'Open ' + (container.type === 'folders' ? 'folder: ' : 'collection: ') + container.name} title={container.name} onClick={open}><span>{container.name}</span></button>
      <ActionMenu label={'Options for ' + container.name} disabled={disabled} actions={[
        {label: 'Open', icon, onSelect: open},
        {label: 'Rename', icon: 'edit', onSelect: () => setEdit(container)},
        {label: container.type === 'folders' ? 'New subfolder' : 'New folder', icon: 'plus', onSelect: () => newFolder(container.collection, container.type === 'folders' ? container.id : '')},
        {label: 'Remove ' + (container.type === 'folders' ? 'folder' : 'collection'), icon: 'trash', danger: true, onSelect: () => setRemove(container)},
      ]}/>
    </div>;
  }
  function pageLinks(collection: string, folder: string | null, depth: number) {
    return containedPages(collection, folder).map(page => <button className="page-link organization-page-link" key={page.id} style={{paddingLeft: 8 + Math.min(depth, 5) * 12}} disabled={disabled} draggable={!disabled} onDragStart={event => startPageDrag(event, vaultId!, page.id)} onClick={() => onOpenPage(page.id)} title={page.title || 'Untitled'}><PageIcon icon={page.icon}/><span className="page-link-title">{page.title || 'Untitled'}</span></button>);
  }
  function folders(collection: string, parent: string | null, depth: number) {
    return data.folders.filter(folder => folder.collection_id === collection && folder.parent_id === parent).map(folder => <div key={folder.id}>
      {item({type: 'folders', id: folder.id, name: folder.name, collection, parent: folder.parent_id || ''}, depth)}
      {!collapsed.has(folder.id) && <>{folders(collection, folder.id, depth + 1)}{pageLinks(collection, folder.id, depth + 1)}</>}
    </div>);
  }
  return <nav className="sidebar-group organization-sidebar" aria-label="Folders and collections" onDragEnd={() => setDropTarget(null)}>
    <div className="sidebar-section-heading"><div className="workspace-label">Library</div><ActionMenu icon="plus" label="Collection actions" disabled={disabled} actions={[
      {label: 'New collection', icon: 'collection', onSelect: () => setEdit({type: 'collections', name: '', collection: '', parent: ''})},
    ]}/></div>
    <button className={'nav ' + (active && !context.collection && !context.folder ? 'active' : '')} disabled={disabled} aria-label="Browse all content" title="All content" onClick={() => onOpen()}><span data-icon="collection"><Icon name="collection"/></span><span>All content</span></button>
    {!disabled && <><div className="organization-sidebar-label">Collections<span>{data.collections.length}</span></div>{data.collections.map(collection => <div key={collection.id}>
      {item({type: 'collections', id: collection.id, name: collection.name, collection: collection.id, parent: ''})}
      {!collapsed.has(collection.id) && <>{folders(collection.id, null, 1)}{pageLinks(collection.id, null, 1)}</>}
    </div>)}{!data.collections.length && <button className="sidebar-create" onClick={() => setEdit({type: 'collections', name: '', collection: '', parent: ''})}><Icon name="plus"/>Create a collection</button>}</>}
    <span className="sr-only" role="status">{dropStatus}</span>
    {edit && <NameDialog title={(edit.id ? 'Rename ' : 'New ') + (edit.type === 'collections' ? 'collection' : 'folder')} value={edit.name} onClose={() => setEdit(null)} onSave={async name => {
      const updated = await api.organize(vaultId!, edit.type + (edit.id ? '/' + edit.id : ''), {name, ...(edit.type === 'folders' ? {collection_id: edit.collection, parent_id: edit.parent || null} : {})}, edit.id ? 'PUT' : 'POST');
      onChanged(updated);
    }}/>}
    {remove && <ConfirmDialog title={'Remove ' + (remove.type === 'folders' ? 'folder?' : 'collection?')} description={`Remove “${remove.name}” and its nested folders? Notes, entities, and favourites will be kept.`} action="Remove" onClose={() => setRemove(null)} onConfirm={async () => {
      onChanged(await api.organize(vaultId!, remove.type + '/' + remove.id, undefined, 'DELETE'));
    }}/>}
  </nav>;
}
