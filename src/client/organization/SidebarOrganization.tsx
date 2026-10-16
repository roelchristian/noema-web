import { useState } from 'react';
import type { Organization, OrganizationContext } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ActionMenu } from '../components/ActionMenu';
import { NameDialog } from '../components/NameDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface Container {type: 'collections' | 'folders'; id?: string; name: string; collection: string; parent: string}
export function SidebarOrganization({vaultId, data, context, active, disabled, onOpen, onChanged}: {
  vaultId?: string; data: Organization; context: OrganizationContext; active: boolean; disabled: boolean;
  onOpen: (collection?: string, folder?: string) => void; onChanged: (data: Organization) => void;
}) {
  const [edit, setEdit] = useState<Container | null>(null), [remove, setRemove] = useState<Container | null>(null);
  const newFolder = (collection = '', parent = '') => setEdit({type: 'folders', name: '', collection, parent});
  function item(container: Container, depth = 0) {
    const selected = active && (container.type === 'folders' ? context.folder === container.id : context.collection === container.id && !context.folder);
    const open = () => onOpen(container.collection,container.type === 'folders' ? container.id : '');
    return <div className={'sidebar-item-row ' + (selected ? 'is-selected' : '')}>
      <button className={'nav container-link ' + (selected ? 'active' : '')} style={{paddingLeft: 8 + Math.min(depth,5) * 12}} disabled={disabled} aria-label={'Open ' + (container.type === 'folders' ? 'folder: ' : 'collection: ') + container.name} title={container.name} onClick={open}><span data-icon={container.type === 'folders' ? 'folder' : 'collection'}><Icon name={container.type === 'folders' ? 'folder' : 'collection'}/></span><span>{container.name}</span></button>
      <ActionMenu label={'Options for ' + container.name} disabled={disabled} actions={[
        {label: 'Open', icon: 'folder', onSelect: open},
        {label: 'Rename', icon: 'edit', onSelect: () => setEdit(container)},
        {label: container.type === 'folders' ? 'New subfolder' : 'New folder', icon: 'plus', onSelect: () => newFolder(container.collection,container.type === 'folders' ? container.id : '')},
        {label: 'Remove ' + (container.type === 'folders' ? 'folder' : 'collection'), icon: 'trash', danger: true, onSelect: () => setRemove(container)},
      ]}/>
    </div>;
  }
  function folders(collection: string, parent: string | null, depth: number) {
    return data.folders.filter(folder => (folder.collection_id || '') === collection && folder.parent_id === parent).map(folder => <div key={folder.id}>
      {item({type: 'folders',id: folder.id,name: folder.name,collection,parent: folder.parent_id || ''},depth)}
      {folders(collection,folder.id,depth + 1)}
    </div>);
  }
  return <nav className="sidebar-group organization-sidebar" aria-label="Folders and collections">
    <div className="sidebar-section-heading"><div className="workspace-label">Collections</div><ActionMenu label="Collection actions" disabled={disabled} actions={[
      {label: 'New collection', icon: 'collection', onSelect: () => setEdit({type: 'collections',name: '',collection: '',parent: ''})},
      {label: 'New folder', icon: 'folder', onSelect: () => newFolder()},
    ]}/></div>
    <button className={'nav ' + (active && !context.collection && !context.folder ? 'active' : '')} disabled={disabled} aria-label="Browse all content" title="All content" onClick={() => onOpen()}><span data-icon="folder"><Icon name="folder"/></span><span>All content</span></button>
    {!disabled && <>{folders('',null,0)}{data.collections.map(collection => <div key={collection.id}>
      {item({type: 'collections',id: collection.id,name: collection.name,collection: collection.id,parent: ''})}
      {folders(collection.id,null,1)}
    </div>)}</>}
    {edit && <NameDialog title={(edit.id ? 'Rename ' : 'New ') + (edit.type === 'collections' ? 'collection' : 'folder')} value={edit.name} onClose={() => setEdit(null)} onSave={async name => {
      const updated = await api.organize(vaultId!,edit.type + (edit.id ? '/' + edit.id : ''),{name,...(edit.type === 'folders' ? {collection_id: edit.collection || null,parent_id: edit.parent || null} : {})},edit.id ? 'PUT' : 'POST');
      onChanged(updated);
    }}/>}
    {remove && <ConfirmDialog title={'Remove ' + (remove.type === 'folders' ? 'folder?' : 'collection?')} description={`Remove “${remove.name}” and its nested folders? Notes, entities, and favourites will be kept.`} action="Remove" onClose={() => setRemove(null)} onConfirm={async () => {
      onChanged(await api.organize(vaultId!,remove.type + '/' + remove.id,undefined,'DELETE'));
    }}/>}
  </nav>;
}
