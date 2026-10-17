import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Organization, OrganizationContext, PageSummary } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageIcon } from '../components/PageIcon';
import { ActionMenu } from '../components/ActionMenu';
import { NameDialog } from '../components/NameDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { folderBreadcrumbs } from './breadcrumbs';
import { folderDropHandlers } from './folder-drop';
import { startFolderDrag } from './folder-drag';
import { isPageDrag, readPageDrop, startPageDrag } from './page-drag';

interface Container {type: 'collections' | 'folders'; id?: string; name: string; collection: string; parent: string}
export function SidebarOrganization({vaultId, data, pages, context, active, disabled, available, onOpen, onOpenPage, onMovePage, onChanged, onError}: {
  vaultId?: string; data: Organization; pages: PageSummary[]; context: OrganizationContext; active: boolean; disabled: boolean; available: boolean;
  onOpen: (collection?: string, folder?: string) => void; onOpenPage: (id: string) => void;
  onMovePage: (id: string, collection: string, folder: string | null) => Promise<void>;
  onChanged: (data: Organization) => void; onError: (error: unknown) => void;
}) {
  const [edit, setEdit] = useState<Container | null>(null), [remove, setRemove] = useState<Container | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null), [dropStatus, setDropStatus] = useState('');
  const dropping = useRef(false);
  useEffect(() => {
    if (!active || !context.folder) return;
    const path = folderBreadcrumbs(data.folders, context.folder);
    setExpanded(previous => new Set([...previous, ...path.map(crumb => crumb.target!.folder)]));
  }, [active, context.folder, data.folders]);
  const toggle = (id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const expand = (id: string) => setExpanded(previous => new Set(previous).add(id));
  const newFolder = (collection: string, parent = '') => setEdit({type: 'folders', name: '', collection, parent});
  const containedPages = (collection: string, folder: string | null) => pages.filter(page => collection ? data.memberships.some(item => item.kind === 'page' && item.item_id === page.id && item.collection_id === collection) : data.locations.some(item => item.kind === 'page' && item.item_id === page.id && item.folder_id === folder));
  async function drop(event: DragEvent, container: Container) {
    event.preventDefault(); setDropTarget(null);
    if (disabled || dropping.current || !vaultId) return;
    const id = readPageDrop(event, vaultId);
    if (!id || !pages.some(page => page.id === id)) return;
    dropping.current = true;
    setDropStatus(container.type === 'folders' ? 'Moving page…' : 'Adding to collection…');
    try {
      await onMovePage(id, container.collection, container.type === 'folders' ? container.id! : null);
      setExpanded(previous => { const next = new Set(previous); next.add(container.id!); return next; });
      setDropStatus(`Page added to ${container.name}`);
    } catch (error) { setDropStatus('Could not move page. Try again.'); onError(error); }
    finally { dropping.current = false; }
  }
  function item(container: Container, depth = 0) {
    const selected = active && (container.type === 'folders' ? context.folder === container.id : context.collection === container.id && !context.folder);
    const open = () => onOpen(container.collection, container.type === 'folders' ? container.id : '');
    const hasChildren = container.type === 'folders' && data.folders.some(folder => folder.parent_id === container.id) || containedPages(container.collection, container.type === 'folders' ? container.id! : null).length > 0;
    const icon = container.type === 'folders' ? 'folder' : 'collection';
    return <div className={'sidebar-item-row organization-branch ' + (selected ? 'is-selected ' : '') + (dropTarget === container.id ? 'is-drop-target' : '')} style={{paddingLeft: Math.min(depth, 5) * 12}}
      draggable={!disabled && container.type === 'folders'} onDragStart={event => { if (container.type === 'folders' && vaultId) startFolderDrag(event, vaultId, container.id!); }}
      onDragOver={event => { if (!disabled && !dropping.current && isPageDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = container.type === 'collections' ? 'copy' : 'move'; setDropTarget(container.id!); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current === container.id ? null : current); }}
      onDrop={event => void drop(event, container)}
      {...(container.type === 'folders' ? folderDropHandlers({
        folder: data.folders.find(folder => folder.id === container.id)!, vaultId: vaultId || '', pages, data, pending: disabled, moving: dropping,
        onHover: setDropTarget, onStatus: setDropStatus, onError,
        onMove: async (pageId, folderId) => { await onMovePage(pageId, '', folderId); expand(folderId); },
        onMoveFolder: async (source, parentId) => {
          onChanged(await api.organize(vaultId!, 'folders/' + source.id, {name: source.name, parent_id: parentId}));
          expand(parentId);
        },
      }) : {})}>

      {hasChildren ? <button className="branch-toggle" disabled={disabled} aria-label={(expanded.has(container.id!) ? 'Collapse ' : 'Expand ') + container.name} aria-expanded={expanded.has(container.id!)} onClick={() => toggle(container.id!)}><span className="branch-container-icon"><Icon name={icon}/></span><span className="branch-chevron"><Icon name="chevron"/></span></button> : <button className="branch-leaf-icon" disabled={disabled} aria-label={'Open ' + container.name} onClick={open}><Icon name={icon}/></button>}
      <button className={'nav container-link ' + (selected ? 'active' : '')} disabled={disabled} aria-label={'Open ' + (container.type === 'folders' ? 'folder: ' : 'collection: ') + container.name} title={container.name} onClick={open}><span>{container.name}</span></button>
      <ActionMenu label={'Options for ' + container.name} disabled={disabled} actions={[
        {label: 'Open', icon, onSelect: open},
        {label: 'Rename', icon: 'edit', onSelect: () => setEdit(container)},
        ...(container.type === 'folders' ? [{label: data.favourites.some(item => item.kind === 'folder' && item.item_id === container.id) ? 'Remove from favourites' : 'Add to favourites', icon: 'star', onSelect: () => { void api.organize(vaultId!, 'favourites', {kind: 'folder', item_id: container.id, favourite: !data.favourites.some(item => item.kind === 'folder' && item.item_id === container.id)}).then(onChanged).catch(onError); }}] : []),
        ...(container.type === 'folders' ? [{label: 'New subfolder', icon: 'plus', onSelect: () => newFolder('', container.id)}] : []),
        {label: 'Remove ' + (container.type === 'folders' ? 'folder' : 'collection'), icon: 'trash', danger: true, onSelect: () => setRemove(container)},
      ]}/>
    </div>;
  }
  function pageLinks(collection: string, folder: string | null, depth: number) {
    return containedPages(collection, folder).map(page => <button className="page-link organization-page-link" key={page.id} style={{paddingLeft: 8 + Math.min(depth, 5) * 12}} disabled={disabled} draggable={!disabled} onDragStart={event => startPageDrag(event, vaultId!, page.id)} onClick={() => onOpenPage(page.id)} title={page.title || 'Untitled'}><PageIcon icon={page.icon}/><span className="page-link-title">{page.title || 'Untitled'}</span></button>);
  }
  function folders(collection: string, parent: string | null, depth: number) {
    return data.folders.filter(folder => folder.parent_id === parent).map(folder => <div key={folder.id}>
      {item({type: 'folders', id: folder.id, name: folder.name, collection, parent: folder.parent_id || ''}, depth)}
      {expanded.has(folder.id) && <>{folders(collection, folder.id, depth + 1)}{pageLinks(collection, folder.id, depth + 1)}</>}
    </div>);
  }
  return <nav className="sidebar-group organization-sidebar" aria-label="Folders and collections" onDragEnd={() => setDropTarget(null)}>
    {available && <><div className="organization-sidebar-label">Folders<ActionMenu icon="plus" label="Folder actions" disabled={disabled} actions={[{label: 'New folder', icon: 'folder', onSelect: () => newFolder('')}]}/></div>{folders('', null, 0)}{!data.folders.length && <button className="sidebar-create" disabled={disabled} onClick={() => newFolder('')}><Icon name="plus"/>Create a folder</button>}<div className="organization-sidebar-label">Collections<ActionMenu icon="plus" label="Collection actions" disabled={disabled} actions={[
      {label: 'New collection', icon: 'collection', onSelect: () => setEdit({type: 'collections', name: '', collection: '', parent: ''})},
    ]}/></div>{data.collections.map(collection => <div key={collection.id}>
      {item({type: 'collections', id: collection.id, name: collection.name, collection: collection.id, parent: ''})}
      {expanded.has(collection.id) && <>{pageLinks(collection.id, null, 1)}</>}
    </div>)}{!data.collections.length && <button className="sidebar-create" disabled={disabled} onClick={() => setEdit({type: 'collections', name: '', collection: '', parent: ''})}><Icon name="plus"/>Create a collection</button>}</>}
    <span className="sr-only" role="status">{dropStatus}</span>
    {edit && <NameDialog title={(edit.id ? 'Rename ' : 'New ') + (edit.type === 'collections' ? 'collection' : 'folder')} value={edit.name} onClose={() => setEdit(null)} onSave={async name => {
      const updated = await api.organize(vaultId!, edit.type + (edit.id ? '/' + edit.id : ''), {name, ...(edit.type === 'folders' ? {parent_id: edit.parent || null} : {})}, edit.id ? 'PUT' : 'POST');
      onChanged(updated);
    }}/>}
    {remove && <ConfirmDialog title={'Remove ' + (remove.type === 'folders' ? 'folder?' : 'collection?')} description={remove.type === 'folders' ? `Remove “${remove.name}” and its subfolders? Their contents return to Inbox. Collection memberships and note favourites are kept.` : `Remove “${remove.name}”? Only its memberships are removed. Notes keep their folder locations.`} action="Remove" onClose={() => setRemove(null)} onConfirm={async () => {
      onChanged(await api.organize(vaultId!, remove.type + '/' + remove.id, undefined, 'DELETE'));
    }}/>}
  </nav>;
}
