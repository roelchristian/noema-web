import { PageIcon } from '../components/PageIcon';
import { Select } from '../components/Select';
import { useState } from 'react';
import type { Entity, Folder, ItemKind, Organization, OrganizationContext, PageSummary } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';

interface Item { kind: ItemKind; id: string; name: string; label: string; icon?: string | null }
interface EditContainer { type: 'collections' | 'folders'; id?: string; name: string; parent: string }
export function OrganizationLibrary({data, vaultId, pages, entities, favouritesOnly, context, onContextChange, onChanged, onOpenPage, onOpenEntity, onError}: {
  data: Organization; vaultId: string; pages: PageSummary[]; entities: Entity[]; favouritesOnly: boolean;
  context: OrganizationContext; onContextChange: (patch: Partial<OrganizationContext>) => void; onChanged: (data: Organization) => void;
  onOpenPage: (id: string) => void; onOpenEntity: (id: string) => void; onError: (error: unknown) => void;
}) {
  const [pending, setPending] = useState(false);
  const {collection, folder} = context;
  const setCollection = (collection: string) => onContextChange({collection, folder: ''});
  const setFolder = (folder: string) => onContextChange({folder});
  const [search, setSearch] = useState(''), [edit, setEdit] = useState<EditContainer | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  async function mutate(route: string, body?: unknown, method = 'PUT') {
    if (pending) return;
    setPending(true);
    try { const updated = await api.organize(vaultId, route, body, method); onChanged(updated); }
    finally { setPending(false); }
  }
  const run = (work: () => Promise<unknown>) => { void work().catch(onError); };
  const items: Item[] = [...pages.map(p => ({kind: 'page' as const, id: p.id, name: p.title || 'Untitled', label: 'Page', icon: p.icon})), ...entities.map(e => ({kind: 'entity' as const, id: e.id, name: e.name, label: e.type === 'creativework' ? 'Creative work' : e.type}))];
  const currentCollection = data.collections.find(c => c.id === collection), currentFolder = data.folders.find(f => f.id === folder);
  const isFavourite = (item: Item) => data.favourites.some(f => f.kind === item.kind && f.item_id === item.id);
  const location = (item: Item, context: string) => data.locations.find(l => l.kind === item.kind && l.item_id === item.id && l.collection_id === context);
  const visible = items.filter(item => {
    if (!item.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (favouritesOnly) return isFavourite(item);
    if (collection || folder) { const loc = location(item, collection); return !!loc && (loc.folder_id || '') === folder; }
    return true;
  });
  const folderPath = (id: string): string => {
    const names: string[] = []; let f = data.folders.find(value => value.id === id);
    while (f) { names.unshift(f.name); f = data.folders.find(value => value.id === f!.parent_id); }
    return names.join(' / ');
  };
  const descendants = (f: Folder, id: string): boolean => f.id === id || !!f.parent_id && descendants(data.folders.find(p => p.id === f.parent_id)!, id);
  const folderOptions = (context: string) => data.folders.filter(f => (f.collection_id || '') === context).map(f => <option key={f.id} value={f.id}>{folderPath(f.id)}</option>);
  function move(item: Item, context: string, target: string | null, remove = false) {
    run(() => mutate('locations', {kind: item.kind, item_id: item.id, collection_id: context || null, folder_id: target || null, remove}));
  }
  function deleteContainer(type: 'collections' | 'folders', id: string) {
    if (!confirm('Delete this container and its nested folders? Content and favourites will be kept.')) return;
    run(async () => { await mutate(type + '/' + id, undefined, 'DELETE'); setFolder(''); if (type === 'collections') setCollection(''); });
  }
  return <section className="organization-library">
    <div className="organization-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>{favouritesOnly ? 'Favourites' : 'Collections & folders'}</h1><p>{favouritesOnly ? 'Your frequently used pages and knowledge, in one place.' : 'Give related ideas a context. Keep one connected copy.'}</p></div>{!favouritesOnly && <button className="button primary" disabled={pending} onClick={() => setEdit({type: 'collections', name: '', parent: ''})}>+ New collection</button>}</div>
    <div className="organization-layout">
      {!favouritesOnly && <nav className="organization-tree" aria-label="Organization"><button className={!collection && !folder ? 'selected' : ''} onClick={() => { setCollection(''); setFolder(''); }}>All content <span>{items.length}</span></button>
        <p className="eyebrow">COLLECTIONS</p>{data.collections.length === 0 && <small>No collections yet</small>}{data.collections.map(c => <button key={c.id} className={collection === c.id ? 'selected' : ''} onClick={() => { setCollection(c.id); setFolder(''); }}>{c.name}<span>{data.locations.filter(l => l.collection_id === c.id).length}</span></button>)}
        <p className="eyebrow">FOLDERS {collection && 'IN THIS COLLECTION'}</p>{data.folders.filter(f => (f.collection_id || '') === collection).map(f => <button key={f.id} className={folder === f.id ? 'selected' : ''} onClick={() => setFolder(f.id)}><Icon name="folder"/>{folderPath(f.id)}</button>)}
        <button disabled={pending} onClick={() => setEdit({type: 'folders', name: '', parent: folder})}>+ New folder</button>
      </nav>}
      <div className="organization-content" aria-busy={pending}>
        <div className="organization-toolbar"><div><button className="organization-crumb" onClick={() => setFolder('')}>{currentCollection?.name || (favouritesOnly ? 'Favourites' : 'All content')}</button>{currentFolder && <span> / {folderPath(currentFolder.id)}</span>}</div>
          {!favouritesOnly && (currentFolder || currentCollection) && <div><button className="button small" disabled={pending} onClick={() => setEdit(currentFolder ? {type: 'folders', id: currentFolder.id, name: currentFolder.name, parent: currentFolder.parent_id || ''} : {type: 'collections', id: collection, name: currentCollection!.name, parent: ''})}>Edit</button><button className="button small" disabled={pending} onClick={() => deleteContainer(currentFolder ? 'folders' : 'collections', currentFolder?.id || collection)}>Delete</button></div>}
        </div>
        <input className="organization-search" aria-label="Search content" placeholder="Find a page or entity…" value={search} onChange={e => setSearch(e.target.value)}/>
        {!favouritesOnly && (collection || folder) && <p className="organization-hint">Showing items directly in this context. Use All content → Organize to add existing items.</p>}
        <div className="organization-items">{visible.map(item => <article className="organization-item" key={item.kind + item.id}>
          <div className="organization-item-row"><button className={'favourite-button ' + (isFavourite(item) ? 'is-favourite' : '')} disabled={pending} aria-label={(isFavourite(item) ? 'Remove favourite: ' : 'Favourite: ') + item.name} aria-pressed={isFavourite(item)} onClick={() => run(() => mutate('favourites', {kind: item.kind, item_id: item.id, favourite: !isFavourite(item)}))}><Icon name="star"/></button>{item.kind === 'page' && <PageIcon icon={item.icon}/>}<button className="organization-item-name" onClick={() => item.kind === 'page' ? onOpenPage(item.id) : onOpenEntity(item.id)}>{item.name}<small>{item.label}</small></button><button className="button small" aria-expanded={selected === item.kind + item.id} onClick={() => setSelected(selected === item.kind + item.id ? null : item.kind + item.id)}>Organize</button></div>
          {selected === item.kind + item.id && <fieldset disabled={pending} className="item-organization"><legend>Folders & collection membership</legend><label>Vault folder<Select value={location(item, '')?.folder_id || ''} onChange={e => move(item, '', e.target.value)}><option value="">No folder</option>{folderOptions('')}</Select></label>{data.collections.map(c => {
            const membership = location(item, c.id);
            return <div className="membership-row" key={c.id}><label><input type="checkbox" checked={!!membership} onChange={e => move(item, c.id, null, !e.target.checked)}/>{c.name}</label>{membership && <Select aria-label={'Folder in ' + c.name} value={membership.folder_id || ''} onChange={e => move(item, c.id, e.target.value)}><option value="">Collection root</option>{folderOptions(c.id)}</Select>}</div>;
          })}{!data.collections.length && <small>Create a collection to group this item with related content.</small>}</fieldset>}
        </article>)}{!visible.length && <div className="organization-empty"><Icon name={favouritesOnly ? 'star' : 'folder'}/><h2>{search ? 'No matching content' : favouritesOnly ? 'Keep useful ideas close' : 'Room for related ideas'}</h2><p>{favouritesOnly ? 'Star any page or entity in Collections & folders to find it here.' : collection || folder ? 'Add existing pages and entities using Organize in All content.' : 'Create a page or knowledge entity to get started.'}</p></div>}</div>
      </div>
    </div>
    {edit && <Modal titleId="container-title" onClose={() => setEdit(null)}><form onSubmit={e => { e.preventDefault(); run(async () => { await mutate(edit.type + (edit.id ? '/' + edit.id : ''), {name: edit.name, ...(edit.type === 'folders' ? {collection_id: collection || null, parent_id: edit.parent || null} : {})}, edit.id ? 'PUT' : 'POST'); setEdit(null); }); }}><h2 id="container-title">{edit.id ? 'Edit' : 'New'} {edit.type === 'collections' ? 'collection' : 'folder'}</h2><label>Name<input autoFocus required maxLength={200} value={edit.name} onChange={e => setEdit({...edit, name: e.target.value})}/></label>{edit.type === 'folders' && <label>Parent folder<Select value={edit.parent} onChange={e => setEdit({...edit, parent: e.target.value})}><option value="">{currentCollection?.name || 'Vault'} root</option>{data.folders.filter(f => (f.collection_id || '') === collection && (!edit.id || !descendants(f, edit.id))).map(f => <option key={f.id} value={f.id}>{folderPath(f.id)}</option>)}</Select></label>}<div className="dialog-actions"><button type="button" className="button" onClick={() => setEdit(null)}>Cancel</button><button className="button primary" disabled={pending || !edit.name.trim()}>Save</button></div></form></Modal>}
  </section>;
}
