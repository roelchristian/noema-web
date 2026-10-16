import { combinedMatches } from '../search/matches';
import { HighlightedText } from '../search/HighlightedText';
import { useSearchSnippets } from '../search/useSearchSnippets';
import { makeSearchSnippet } from '../../shared/search-snippets';
import { startPageDrag } from './page-drag';
import { useSemanticSearch } from '../search/useSemanticSearch';
import { PageIcon } from '../components/PageIcon';
import { ActionMenu } from '../components/ActionMenu';
import { ItemOrganization } from './ItemOrganization';
import { Select } from '../components/Select';
import { useState } from 'react';
import type { Entity, Folder, ItemKind, Organization, OrganizationContext, PageSummary } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';

interface Item { kind: ItemKind; id: string; name: string; label: string; icon?: string | null; description?: string }
interface EditContainer { type: 'collections' | 'folders'; id?: string; name: string; parent: string }
export function OrganizationLibrary({data, vaultId, pages, entities, favouritesOnly, context, onContextChange, onChanged, onOpenPage, onOpenEntity, onError}: {
  data: Organization; vaultId: string; pages: PageSummary[]; entities: Entity[]; favouritesOnly: boolean;
  context: OrganizationContext; onContextChange: (patch: Partial<OrganizationContext>) => void; onChanged: (data: Organization) => void;
  onOpenPage: (id: string) => void; onOpenEntity: (id: string) => void; onError: (error: unknown) => void;
}) {
  const [pending, setPending] = useState(false);
  const {collection, folder} = favouritesOnly ? {collection: '', folder: ''} : context;
  const setCollection = (collection: string) => onContextChange({collection, folder: ''});
  const setFolder = (folder: string) => onContextChange({folder});
  const [search, setSearch] = useState(''), [edit, setEdit] = useState<EditContainer | null>(null);
  const semantic = useSemanticSearch(vaultId, search);
  const query = search.trim().toLowerCase();
  const semanticScores = new Map(semantic.results.map(result => [result.id, result.score]));
  const textMatches = (item: Item) => item.name.toLowerCase().includes(query);
  const semanticMatches = (item: Item) => !!query && item.kind === 'page' && semanticScores.has(item.id);
  const [remove, setRemove] = useState<{type: 'collections' | 'folders'; id: string; name: string} | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  async function mutate(route: string, body?: unknown, method = 'PUT') {
    if (pending) return;
    setPending(true);
    try { const updated = await api.organize(vaultId, route, body, method); onChanged(updated); }
    finally { setPending(false); }
  }
  const run = (work: () => Promise<unknown>) => { void work().catch(onError); };
  const items: Item[] = [...pages.map(p => ({kind: 'page' as const, id: p.id, name: p.title || 'Untitled', label: 'Page', icon: p.icon})), ...entities.map(e => ({kind: 'entity' as const, id: e.id, name: e.name, label: e.type === 'creativework' ? 'Creative work' : e.type, description: e.description}))];
  const currentCollection = data.collections.find(c => c.id === collection), currentFolder = data.folders.find(f => f.id === folder);
  const isFavourite = (item: Item) => data.favourites.some(f => f.kind === item.kind && f.item_id === item.id);
  const location = (item: Item, context: string) => data.locations.find(l => l.kind === item.kind && l.item_id === item.id && l.collection_id === context);
  const visible = combinedMatches(items.filter(item => {
    if (favouritesOnly) return isFavourite(item);
    if (collection || folder) { const loc = location(item, collection); return !!loc && (loc.folder_id || '') === folder; }
    return true;
  }),search,semantic.results);
  const semanticNotes = new Map(semantic.results.map(result => [result.id, result]));
  const previews = useSearchSnippets(vaultId, search, (query ? visible : []).filter(item => item.kind === 'page' && !semanticNotes.get(item.id)?.snippet).map(item => item.id));
  const snippetFor = (item: Item) => item.kind === 'page' ? previews.snippets[item.id] ?? semanticNotes.get(item.id)?.snippet ?? '' : makeSearchSnippet(item.description ?? '', search);
  const folderPath = (id: string): string => {
    const names: string[] = []; let f = data.folders.find(value => value.id === id);
    while (f) { names.unshift(f.name); f = data.folders.find(value => value.id === f!.parent_id); }
    return names.join(' / ');
  };
  const descendants = (f: Folder, id: string): boolean => f.id === id || !!f.parent_id && descendants(data.folders.find(p => p.id === f.parent_id)!, id);
  function move(item: Item, context: string, target: string | null, remove = false) {
    run(() => mutate('locations', {kind: item.kind, item_id: item.id, collection_id: context || null, folder_id: target || null, remove}));
  }
  function deleteContainer(type: 'collections' | 'folders', id: string) {
    const name = (type === 'folders' ? data.folders : data.collections).find(item => item.id === id)?.name || '';
    setRemove({type, id, name});
  }
  const childFolders = data.folders.filter(f => !!collection && (f.collection_id || '') === collection && (f.parent_id || '') === folder && f.name.toLowerCase().includes(query));
  const collectionCards = !collection && !folder ? data.collections.filter(c => c.name.toLowerCase().includes(query)) : [];
  const ancestors: Folder[] = [];
  let ancestor = currentFolder;
  while (ancestor) { ancestors.unshift(ancestor); ancestor = data.folders.find(f => f.id === ancestor!.parent_id); }
  const countLabel = (count: number) => `${count} ${count === 1 ? 'item' : 'items'}`;
  return <section className="organization-library organization-browser">
    <div className="organization-heading"><div><h1>{favouritesOnly ? 'Favourites' : 'Collections & folders'}</h1></div>{!favouritesOnly && <div className="organization-create-actions">{collection && <button className="button" disabled={pending} onClick={() => setEdit({type: 'folders', name: '', parent: folder})}><Icon name="folder"/>New folder</button>}<button className="button primary" disabled={pending} onClick={() => setEdit({type: 'collections', name: '', parent: ''})}><Icon name="plus"/>New collection</button></div>}</div>
    <div className="organization-content" aria-busy={pending}>
      <div className="organization-browser-toolbar">
        <nav className="organization-breadcrumbs" aria-label="Folder path"><button aria-current={!collection && !folder ? 'page' : undefined} onClick={() => onContextChange({collection: '', folder: ''})}><Icon name={favouritesOnly ? 'star' : 'collection'}/>{favouritesOnly ? 'Favourites' : 'All content'}</button>{currentCollection && <><Icon name="chevron"/><button aria-current={!folder ? 'page' : undefined} onClick={() => setFolder('')}>{currentCollection.name}</button></>}{ancestors.map(f => <span key={f.id}><Icon name="chevron"/><button aria-current={f.id === folder ? 'page' : undefined} onClick={() => setFolder(f.id)}>{f.name}</button></span>)}</nav>
        <label className="organization-search-box"><Icon name="search"/><input aria-label="Search content by name or meaning" maxLength={2000} placeholder="Search names or meaning…" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button aria-label="Clear search" onClick={() => setSearch('')}><Icon name="close"/></button>}</label>
      </div>
      {!!query && <div className="search-feedback" aria-live="polite">
        {semantic.loading && <p className="search-status" role="status">Searching note meaning… Name matches are available now.</p>}
        {semantic.error && <p className="search-error" role="alert">{semantic.error} Name matches are still shown.</p>}
        {previews.error && <p className="search-error">Some note previews are unavailable. You can still open the results.</p>}
      </div>}
      {!favouritesOnly && (currentFolder || currentCollection) && <div className="organization-context-heading"><span className="destination-icon"><Icon name={currentFolder ? 'folder' : 'collection'}/></span><div><h2>{currentFolder?.name || currentCollection?.name}</h2><p>{countLabel(visible.length)} · {childFolders.length} {childFolders.length === 1 ? 'folder' : 'folders'}</p></div><ActionMenu label="Folder and collection options" disabled={pending} actions={[
        {label: 'Rename', icon: 'edit', onSelect: () => setEdit(currentFolder ? {type: 'folders', id: currentFolder.id, name: currentFolder.name, parent: currentFolder.parent_id || ''} : {type: 'collections', id: collection, name: currentCollection!.name, parent: ''})},
        {label: 'Delete', icon: 'trash', danger: true, onSelect: () => deleteContainer(currentFolder ? 'folders' : 'collections', currentFolder?.id || collection)},
      ]}/></div>}
      {!favouritesOnly && <>
        {!collection && !folder && <div className="organization-container-section"><div className="organization-section-title"><h2>Collections <span>{collectionCards.length}</span></h2><span>Bring related ideas together</span></div><div className="organization-container-grid">{collectionCards.map(c => <button className="organization-container-card" key={c.id} onClick={() => setCollection(c.id)}><span className="destination-icon"><Icon name="collection"/></span><Icon name="chevron"/><strong>{c.name}</strong><small>{countLabel(data.locations.filter(l => l.collection_id === c.id).length)} · {data.folders.filter(f => f.collection_id === c.id).length} folders</small></button>)}{!query && <button className="organization-container-card organization-new-card" disabled={pending} onClick={() => setEdit({type: 'collections', name: '', parent: ''})}><Icon name="plus"/><strong>New collection</strong><small>A home for a shared theme</small></button>}</div></div>}
        {!!childFolders.length && <div className="organization-container-section"><div className="organization-section-title"><h2>Folders <span>{childFolders.length}</span></h2></div><div className="organization-folder-grid">{childFolders.map(f => <button className="organization-folder-card" key={f.id} onClick={() => setFolder(f.id)}><span className="destination-icon"><Icon name="folder"/></span><span><strong>{f.name}</strong><small>{countLabel(data.locations.filter(l => (l.collection_id || '') === collection && l.folder_id === f.id).length)}</small></span><Icon name="chevron"/></button>)}</div></div>}
      </>}
      <div className="organization-section-title organization-content-title"><h2>{favouritesOnly ? 'Saved favourites' : collection || folder ? 'In this space' : 'All content'} <span>{visible.length}</span></h2><span>{collection || folder ? 'Pages and knowledge in this location' : 'Your pages and knowledge'}</span></div>
      <div className="organization-items">{visible.map(item => <article className="organization-item" key={item.kind + item.id}>
        <div className="organization-item-row" draggable={item.kind === 'page' && !pending} onDragStart={event => { if (item.kind === 'page') startPageDrag(event, vaultId, item.id); }}><span className="organization-item-icon">{item.kind === 'page' ? <PageIcon icon={item.icon}/> : <Icon name={item.label}/>}</span><button className="organization-item-name" onClick={() => item.kind === 'page' ? onOpenPage(item.id) : onOpenEntity(item.id)}><HighlightedText text={item.name} query={search}/><small>{item.label}{!!query && <span className="search-match-badge">{textMatches(item) ? semanticMatches(item) ? 'Text + semantic' : 'Text match' : 'Related by meaning'}</span>}</small>{!!query && !!snippetFor(item) && <span className="search-result-snippet"><HighlightedText text={snippetFor(item)} query={search}/></span>}</button><button className={'favourite-button ' + (isFavourite(item) ? 'is-favourite' : '')} disabled={pending} aria-label={(isFavourite(item) ? 'Remove favourite: ' : 'Favourite: ') + item.name} aria-pressed={isFavourite(item)} onClick={() => run(() => mutate('favourites', {kind: item.kind, item_id: item.id, favourite: !isFavourite(item)}))}><Icon name="star"/></button><button className="organization-organize-button" aria-label={'Organize ' + item.name} aria-expanded={selected === item.kind + item.id} onClick={() => setSelected(selected === item.kind + item.id ? null : item.kind + item.id)}><Icon name="folder"/><span>Organize</span><Icon name="chevron"/></button></div>
        {selected === item.kind + item.id && <ItemOrganization data={data} kind={item.kind} itemId={item.id} pending={pending} onMove={(context, target, remove) => move(item, context, target, remove)}/>}
      </article>)}{!visible.length && <div className="organization-empty"><span className="destination-icon"><Icon name={search ? 'search' : favouritesOnly ? 'star' : 'folder'}/></span><h2>{query ? semantic.loading ? 'Searching note meaning…' : 'No matching content' : favouritesOnly ? 'Keep useful ideas close' : 'Room for related ideas'}</h2><p>{query ? 'Try another name or describe an idea. Semantic results include indexed notes in this space.' : favouritesOnly ? 'Star any page or entity to find it here.' : collection || folder ? 'Open All content and choose Organize on an item to add it here.' : 'Your pages and knowledge will appear here.'}</p>{!!search && <button className="button" onClick={() => setSearch('')}>Clear search</button>}{!search && !favouritesOnly && (collection || folder) && <button className="button" onClick={() => onContextChange({collection: '', folder: ''})}>Browse all content<Icon name="chevron"/></button>}</div>}</div>
    </div>
    {edit && <Modal titleId="container-title" onClose={() => setEdit(null)}><form onSubmit={e => { e.preventDefault(); run(async () => { await mutate(edit.type + (edit.id ? '/' + edit.id : ''), {name: edit.name, ...(edit.type === 'folders' ? {collection_id: collection || null, parent_id: edit.parent || null} : {})}, edit.id ? 'PUT' : 'POST'); setEdit(null); }); }}><h2 id="container-title">{edit.id ? 'Edit' : 'New'} {edit.type === 'collections' ? 'collection' : 'folder'}</h2><label>Name<input autoFocus required maxLength={200} value={edit.name} onChange={e => setEdit({...edit, name: e.target.value})}/></label>{edit.type === 'folders' && <label>Parent folder<Select value={edit.parent} onChange={e => setEdit({...edit, parent: e.target.value})}><option value="">{currentCollection?.name || 'Collection'} root</option>{data.folders.filter(f => (f.collection_id || '') === collection && (!edit.id || !descendants(f, edit.id))).map(f => <option key={f.id} value={f.id}>{folderPath(f.id)}</option>)}</Select></label>}<div className="dialog-actions"><button type="button" className="button" onClick={() => setEdit(null)}>Cancel</button><button className="button primary" disabled={pending || !edit.name.trim()}>Save</button></div></form></Modal>}
    {remove && <ConfirmDialog title={'Remove ' + (remove.type === 'folders' ? 'folder?' : 'collection?')} description={`Remove “${remove.name}” and its nested folders? Pages, knowledge, and favourites will be kept.`} action="Remove" onClose={() => setRemove(null)} onConfirm={async () => {
      await mutate(remove.type + '/' + remove.id, undefined, 'DELETE');
      setFolder('');
      if (remove.type === 'collections') setCollection('');
    }}/>}
  </section>;
}
