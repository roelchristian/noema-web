import {FolderCollectionDialog} from './FolderCollectionDialog';
import {PageCover} from '../components/PageCover';
import {ViewModeSwitch, useViewMode} from '../components/ViewModeSwitch';
import { inboxPages } from './inbox';
import { combinedMatches } from '../search/matches';
import { HighlightedText } from '../search/HighlightedText';
import { useSearchSnippets } from '../search/useSearchSnippets';
import { makeSearchSnippet } from '../../shared/search-snippets';
import { startFolderDrag } from './folder-drag';
import { folderDropHandlers } from './folder-drop';
import { startPageDrag } from './page-drag';
import { useSemanticSearch } from '../search/useSemanticSearch';
import { PageIcon } from '../components/PageIcon';
import { ActionMenu } from '../components/ActionMenu';
import { ItemOrganization } from './ItemOrganization';
import { Select } from '../components/Select';
import { useEffect, useId, useRef, useState } from 'react';
import type { Entity, Folder, FavouriteKind, Organization, OrganizationContext, PageSummary } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';

interface Item { featuredImageId?:string|null; kind: FavouriteKind; id: string; name: string; label: string; icon?: string | null; description?: string; updatedAt?: string; entityType?: string }
interface EditContainer { type: 'collections' | 'folders'; id?: string; name: string; parent: string }
export function OrganizationLibrary({data, vaultId, pages, entities, favouritesOnly, inboxOnly = false, context, onContextChange, onChanged, onOpenPage, onOpenEntity, onOpenFolder, onRenamePage, onDeletePage, onNewNote, onError}: {
  data: Organization; vaultId: string; pages: PageSummary[]; entities: Entity[]; favouritesOnly: boolean; inboxOnly?: boolean;
  context: OrganizationContext; onContextChange: (patch: Partial<OrganizationContext>) => void; onChanged: (data: Organization) => void;
  onNewNote: () => void; onOpenFolder: (id: string) => void;
  onRenamePage: (page: PageSummary) => void; onDeletePage: (page: PageSummary) => void;
  onOpenPage: (id: string) => void; onOpenEntity: (id: string) => void; onError: (error: unknown) => void;
}) {
  const [viewMode, setViewMode, libraryRef] = useViewMode(favouritesOnly ? 'favourites' : inboxOnly ? 'inbox' : 'library');
  const [addFolder,setAddFolder]=useState<{folderId?:string;collectionId?:string}|null>(null);
  const [pending, setPending] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null), [dropStatus, setDropStatus] = useState('');
  const moving = useRef(false);
  const {collection, folder} = favouritesOnly || inboxOnly ? {collection: '', folder: ''} : context;
  const setCollection = (collection: string) => onContextChange({collection, folder: ''});
  const setFolder = onOpenFolder;
  const [search, setSearch] = useState(''), [edit, setEdit] = useState<EditContainer | null>(null);
  const [sort, setSort] = useState('modified-desc');
  const [collectionsOpen, setCollectionsOpen] = useState(true), [contentsOpen, setContentsOpen] = useState(true);
  const sectionId = useId();
  const collectionsId = sectionId + '-collections', contentsId = sectionId + '-contents';
  const [checkedPages, setCheckedPages] = useState<Set<string>>(new Set());
  const [bulkOrganize, setBulkOrganize] = useState(false);
  const [bulkMode, setBulkMode] = useState<'folder' | 'collection'>('folder');
  const [bulkRemove, setBulkRemove] = useState(false);
  const [bulkCollection, setBulkCollection] = useState(''), [bulkFolder, setBulkFolder] = useState('');
  useEffect(() => { setCheckedPages(new Set()); setBulkOrganize(false); }, [collection, folder, search]);
  function togglePage(id: string) {
    setCheckedPages(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
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
  const items: Item[] = [
    ...(inboxOnly ? inboxPages(pages, data) : pages).map(p => ({kind: 'page' as const, id: p.id, name: p.title || 'Untitled', label: 'Page', icon: p.icon, featuredImageId:p.featuredImageId, updatedAt: p.updated_at})),
    ...(favouritesOnly ? entities : []).map(e => ({kind: 'entity' as const, id: e.id, name: e.name, label: e.type === 'creativework' ? 'Creative work' : e.type, description: e.description, updatedAt: e.updated_at, entityType: e.type})),
    ...(!inboxOnly ? data.folders : []).filter(f => favouritesOnly || (collection ? (data.folderLinks ?? []).some(link=>link.collection_id===collection && link.folder_id===f.id) : (f.parent_id || '') === folder)).map(f => ({kind: 'folder' as const, id: f.id, name: f.name, label: collection ? 'Linked folder' : 'Folder'})),
  ];
  const pagesById = new Map(pages.map(page => [page.id, page]));
  const linkedFolderCount = (id:string) => (data.folderLinks ?? []).filter(link=>link.collection_id===id).length;
  const collectionPreview = (id: string) => [...(data.folderLinks ?? []).filter(link=>link.collection_id===id).map(link=>data.folders.find(folder=>folder.id===link.folder_id)?.name ?? ''), ...data.memberships.filter(member => member.kind === 'page' && member.collection_id === id && pagesById.has(member.item_id)).slice(0, 3).map(member => pagesById.get(member.item_id)!.title || 'Untitled')].filter(Boolean).slice(0,3).join(' · ');
  const openItem = (item: Item) => item.kind === 'folder' ? onOpenFolder(item.id) : item.kind === 'page' ? onOpenPage(item.id) : onOpenEntity(item.id);
  const folderDescription = (id: string) => {
    const notes = data.locations.filter(location => location.kind === 'page' && location.folder_id === id && pagesById.has(location.item_id)).length;
    const children = data.folders.filter(child => child.parent_id === id).length;
    return `${notes} ${notes === 1 ? 'page' : 'pages'} · ${children} ${children === 1 ? 'subfolder' : 'subfolders'}`;
  };
  const currentCollection = data.collections.find(c => c.id === collection), currentFolder = data.folders.find(f => f.id === folder);
  const isFavourite = (item: Item) => data.favourites.some(f => f.kind === item.kind && f.item_id === item.id);
  const location = (item: Item) => data.locations.find(l => l.kind === item.kind && l.item_id === item.id);
  const visible = combinedMatches(items.filter(item => {
    if (favouritesOnly) return isFavourite(item);
    if (item.kind === 'folder') return true;
    if (collection) return data.memberships.some(m => m.kind === item.kind && m.item_id === item.id && m.collection_id === collection);
    if (folder) return location(item)?.folder_id === folder;
    return !location(item)?.folder_id;
  }),search,semantic.results).sort((a, b) => {
    if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
    const titleOrder = a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});
    if (sort === 'title-asc') return titleOrder;
    if (sort === 'title-desc') return -titleOrder;
    const aDate = Date.parse(a.updatedAt || ''), bDate = Date.parse(b.updatedAt || '');
    if (!Number.isFinite(aDate) || !Number.isFinite(bDate)) return Number(Number.isFinite(bDate)) - Number(Number.isFinite(aDate)) || titleOrder;
    return (sort === 'modified-asc' ? aDate - bDate : bDate - aDate) || titleOrder;
  });
  const checked = visible.filter(item => item.kind === 'page' && checkedPages.has(item.id));
  const visiblePages = visible.filter(item => item.kind === 'page');
  const allChecked = visiblePages.length > 0 && checked.length === visiblePages.length;
  async function bulkUpdate(route: 'favourites' | 'locations' | 'memberships', body: Record<string, unknown>) {
    if (pending || !checked.length) return;
    setPending(true);
    try {
      for (const item of checked) {
        const updated = await api.organize(vaultId, route, {kind: 'page', item_id: item.id, ...body});
        onChanged(updated);
        setCheckedPages(previous => { const next = new Set(previous); next.delete(item.id); return next; });
      }
      setBulkOrganize(false);
    } finally { setPending(false); }
  }
  const semanticNotes = new Map(semantic.results.map(result => [result.id, result]));
  const previewPages = (query || viewMode === 'grid' ? visible : []).filter(item => item.kind === 'page' && !semanticNotes.get(item.id)?.snippet);
  const previews = useSearchSnippets(vaultId, search, previewPages.map(item => item.id), viewMode === 'grid', previewPages.map(item => item.id + ':' + (item.updatedAt ?? '')).sort().join(','));
  const snippetFor = (item: Item) => item.kind === 'page' ? previews.snippets[item.id] ?? semanticNotes.get(item.id)?.snippet ?? '' : makeSearchSnippet(item.description ?? '', search);
  const folderPath = (id: string): string => {
    const names: string[] = []; let f = data.folders.find(value => value.id === id);
    while (f) { names.unshift(f.name); f = data.folders.find(value => value.id === f!.parent_id); }
    return names.join(' / ');
  };
  const descendants = (f: Folder, id: string): boolean => f.id === id || !!f.parent_id && descendants(data.folders.find(p => p.id === f.parent_id)!, id);
  function move(item: Item, context: string, target: string | null, remove = false) {
    if (item.kind === 'folder') return;
    run(() => mutate(context ? 'memberships' : 'locations', {kind: item.kind, item_id: item.id, ...(context ? {collection_id: context, remove} : {folder_id: target || null, remove})}));
  }
  function deleteContainer(type: 'collections' | 'folders', id: string) {
    const name = (type === 'folders' ? data.folders : data.collections).find(item => item.id === id)?.name || '';
    setRemove({type, id, name});
  }
  const childFolders = data.folders.filter(f => !collection && (f.parent_id || '') === folder && f.name.toLowerCase().includes(query));
  const collectionCards = !collection && !folder ? data.collections.filter(c => c.name.toLowerCase().includes(query)) : [];
  const countLabel = (count: number) => `${count} ${count === 1 ? 'page' : 'pages'}`;
  const isHomepage = !favouritesOnly && !inboxOnly && !collection && !folder;
  return <section ref={libraryRef} className="organization-library organization-browser" data-layout={viewMode} onDragEnd={() => setDropTarget(null)}>
    <span className="sr-only" role="status">{dropStatus}</span>
    {(favouritesOnly || !collection && !folder) && <div className={'organization-heading' + (isHomepage ? ' pages-home-heading' : '')}><div className="library-heading-row"><h1 className="page-heading">{favouritesOnly ? 'Favourites' : inboxOnly ? 'Inbox' : 'Library'}</h1></div><div className="pages-home-actions library-heading-actions"><ViewModeSwitch value={viewMode} onChange={setViewMode}/>{isHomepage && <><button className="button" disabled={pending} onClick={() => setEdit({type: 'folders', name: '', parent: ''})}><Icon name="folder"/>New folder</button><button className="button primary" disabled={pending} onClick={onNewNote}><Icon name="compose"/>New Note</button></>}</div></div>}
    <div className="organization-content" aria-busy={pending}>
      {!isHomepage && !favouritesOnly && !inboxOnly && !collection && <div className="organization-browser-toolbar">
        <div className="organization-create-actions"><button className="button" disabled={pending} onClick={() => setEdit({type: 'folders', name: '', parent: folder})}><Icon name="folder"/>New folder</button><button className="button primary" disabled={pending} onClick={() => setEdit({type: 'collections', name: '', parent: ''})}><Icon name="plus"/>New collection</button></div>
      </div>}
      {!!query && <div className="search-feedback" aria-live="polite">
        {semantic.loading && <p className="search-status" role="status">Searching note meaning… Name matches are available now.</p>}
        {semantic.error && <p className="search-error" role="alert">{semantic.error} Name matches are still shown.</p>}
        {previews.error && <p className="search-error">Some note previews are unavailable. You can still open the results.</p>}
      </div>}
      {!favouritesOnly && (currentFolder || currentCollection) && <div className="organization-context-heading"><span className="destination-icon"><Icon name={currentFolder ? 'folder' : 'collection'}/></span><div className="organization-context-title"><div className="library-heading-row"><h1 className="page-heading">{currentFolder?.name || currentCollection?.name}</h1></div><p>{countLabel(visiblePages.length)}{currentFolder ? ` · ${childFolders.length} ${childFolders.length === 1 ? 'subfolder' : 'subfolders'}` : linkedFolderCount(collection) ? ` · ${linkedFolderCount(collection)} linked ${linkedFolderCount(collection)===1?'folder':'folders'}` : ''}</p></div><div className="library-heading-actions"><ViewModeSwitch value={viewMode} onChange={setViewMode}/><ActionMenu label="Folder and collection options" disabled={pending} actions={[
        {label:currentFolder?'Add to collection…':'Add folder…',icon:'collection',onSelect:()=>setAddFolder(currentFolder?{folderId:currentFolder.id}:{collectionId:collection})},
        {label: 'Rename', icon: 'edit', onSelect: () => setEdit(currentFolder ? {type: 'folders', id: currentFolder.id, name: currentFolder.name, parent: currentFolder.parent_id || ''} : {type: 'collections', id: collection, name: currentCollection!.name, parent: ''})},
        {label: 'Delete', icon: 'trash', danger: true, onSelect: () => deleteContainer(currentFolder ? 'folders' : 'collections', currentFolder?.id || collection)},
      ]}/></div></div>}
      {!favouritesOnly && !inboxOnly && <>
        {!collection && !folder && <div className="organization-container-section"><div className="organization-section-title"><h2><button type="button" className="organization-section-toggle" aria-expanded={collectionsOpen} aria-controls={collectionsId} onClick={() => setCollectionsOpen(open => !open)}><Icon name="chevron"/>Collections <span>{collectionCards.length}</span></button></h2></div><div id={collectionsId} hidden={!collectionsOpen} className="organization-container-grid">{collectionCards.map(c => <button className="organization-container-card" key={c.id} onClick={() => setCollection(c.id)}><span className="destination-icon"><Icon name="collection"/></span><Icon name="chevron"/><strong>{c.name}</strong><small>{countLabel(data.memberships.filter(l => l.kind === 'page' && l.collection_id === c.id).length) + (linkedFolderCount(c.id) ? ` · ${linkedFolderCount(c.id)} linked ${linkedFolderCount(c.id)===1?'folder':'folders'}` : '')}</small>{viewMode === 'grid' && <span className="collection-preview">{collectionPreview(c.id)}</span>}</button>)}{!query && <button className="organization-container-card organization-new-card" disabled={pending} onClick={() => setEdit({type: 'collections', name: '', parent: ''})}><Icon name="plus"/><strong>New collection</strong></button>}</div></div>}
      </>}
      {visible.length > 0 ? <>
      {(!folder && !collection) && <div className="organization-section-title organization-content-title"><h2>{isHomepage ? <button type="button" className="organization-section-toggle" aria-expanded={contentsOpen} aria-controls={contentsId} onClick={() => setContentsOpen(open => !open)}><Icon name="chevron"/>Contents <span>{visible.length}</span></button> : <>{favouritesOnly ? 'Saved favourites' : inboxOnly ? 'Inbox' : 'Contents'} <span>{visible.length}</span></>}</h2>{favouritesOnly && <Select aria-label="Sort favourites" value={sort} onChange={event => setSort(event.target.value)}><option value="modified-desc">Last modified · newest first</option><option value="modified-asc">Last modified · oldest first</option><option value="title-asc">Title · A–Z</option><option value="title-desc">Title · Z–A</option></Select>}</div>}
      <div id={contentsId} hidden={isHomepage && !contentsOpen}>
      {!favouritesOnly && checked.length > 0 && <div className="organization-bulk-actions" role="toolbar" aria-label="Selected page actions"><span role="status">{checked.length} selected</span><button disabled={pending} onClick={() => run(() => bulkUpdate('favourites', {favourite: true}))}><Icon name="star"/>Favourite</button><button disabled={pending} onClick={() => run(() => bulkUpdate('favourites', {favourite: false}))}>Unfavourite</button><button disabled={pending} onClick={() => { setBulkMode('folder'); setBulkRemove(false); setBulkCollection(collection || data.collections[0]?.id || ''); setBulkFolder(folder); setBulkOrganize(true); }}><Icon name="folder"/>Organize</button><button disabled={pending} onClick={() => setCheckedPages(new Set())}>Clear</button></div>}
      <div className={'organization-items' + (checked.length ? ' has-selection' : '')}>
      {!favouritesOnly && <div className="organization-list-head" role="group" aria-label="Sort library contents">
        <label className="page-selection page-selection-header"><input type="checkbox" aria-label="Select all visible pages" checked={allChecked} ref={input => { if (input) input.indeterminate = checked.length > 0 && !allChecked; }} disabled={pending || !visiblePages.length} onChange={() => setCheckedPages(allChecked ? new Set() : new Set(visiblePages.map(item => item.id)))}/><span className="page-selection-check"><Icon name="check"/></span></label>
        <button className={sort.startsWith('title-') ? 'is-sorted' : ''} onClick={() => setSort(sort === 'title-asc' ? 'title-desc' : 'title-asc')} aria-label={`Sort by name, ${sort === 'title-asc' ? 'Z to A' : 'A to Z'}`}>Name{sort.startsWith('title-') && <span className={'sort-direction ' + (sort === 'title-asc' ? 'ascending' : '')}><Icon name="chevron"/></span>}</button>
        <button className={sort.startsWith('modified-') ? 'is-sorted' : ''} onClick={() => setSort(sort === 'modified-desc' ? 'modified-asc' : 'modified-desc')} aria-label={`Sort by last modified, ${sort === 'modified-desc' ? 'oldest first' : 'newest first'}`}>Last modified{sort.startsWith('modified-') && <span className={'sort-direction ' + (sort === 'modified-asc' ? 'ascending' : '')}><Icon name="chevron"/></span>}</button>
        <span aria-hidden="true"/><span className="sr-only">Page actions</span>
      </div>}
      {visible.map(item => <article className={'organization-item' + (item.kind === 'page' && checkedPages.has(item.id) ? ' is-checked' : '') + (dropTarget === item.id && item.kind === 'folder' ? ' is-drop-target' : '')} key={item.kind + item.id}
        {...(item.kind === 'folder' ? folderDropHandlers({folder: data.folders.find(folder => folder.id === item.id)!, vaultId, pages, data, pending, moving, onHover: setDropTarget, onStatus: setDropStatus, onMove: (pageId, folderId) => mutate('locations', {kind: 'page', item_id: pageId, folder_id: folderId}), onMoveFolder: (source, parentId) => mutate('folders/' + source.id, {name: source.name, parent_id: parentId}), onError}) : {})}>
        <div className={'organization-item-row' + (favouritesOnly ? '' : ' organization-page-row')} draggable={(item.kind === 'page' || item.kind === 'folder') && !pending && !checked.length} onDragStart={event => { if (item.kind === 'page') startPageDrag(event, vaultId, item.id); else if (item.kind === 'folder') startFolderDrag(event, vaultId, item.id); }}>{viewMode==='grid' && <PageCover vaultId={vaultId} imageId={item.featuredImageId} icon={item.kind==='folder'?'folder':item.entityType ?? 'page'}/>}{!favouritesOnly && item.kind === 'page' ? <label className="organization-item-icon page-selection" draggable={false}><span className="page-selection-icon"><PageIcon icon={item.icon}/></span><input type="checkbox" aria-label={'Select ' + item.name} checked={checkedPages.has(item.id)} disabled={pending} onChange={() => togglePage(item.id)}/><span className="page-selection-check"><Icon name="check"/></span></label> : <span className="organization-item-icon">{item.kind === 'page' ? <PageIcon icon={item.icon}/> : <Icon name={item.kind === 'folder' ? 'folder' : item.entityType ?? 'knowledge'}/>}</span>}<button className="organization-item-name" title={item.name} onClick={() => openItem(item)}><span className="organization-page-title"><HighlightedText text={item.name} query={search}/></span><small>{favouritesOnly ? item.label : item.kind === 'folder' ? <><span className="sr-only">{folderDescription(item.id)}</span><span aria-hidden="true">{collection ? 'Linked folder' : '—'}</span></> : item.updatedAt && Number.isFinite(Date.parse(item.updatedAt)) ? <time dateTime={item.updatedAt} title={new Date(item.updatedAt).toLocaleString()}>{new Date(item.updatedAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}</time> : 'Modified date unavailable'}{!!query && <span className="search-match-badge">{textMatches(item) ? semanticMatches(item) ? 'Text + semantic' : 'Text match' : 'Related by meaning'}</span>}</small>{(!!query || viewMode === 'grid') && !!(item.kind === 'folder' ? folderDescription(item.id) : snippetFor(item)) && <span className="search-result-snippet item-preview"><HighlightedText text={item.kind === 'folder' ? folderDescription(item.id) : snippetFor(item)} query={search}/></span>}</button><button className={'favourite-button ' + (isFavourite(item) ? 'is-favourite' : '')} disabled={pending} aria-label={(isFavourite(item) ? 'Remove favourite: ' : 'Favourite: ') + item.name} aria-pressed={isFavourite(item)} onClick={() => run(() => mutate('favourites', {kind: item.kind, item_id: item.id, favourite: !isFavourite(item)}))}><Icon name="star"/></button><span className="page-row-actions"><ActionMenu label={'Actions for ' + item.name} disabled={pending} actions={[
          {label: 'Open', icon: item.kind === 'folder' ? 'folder' : item.kind === 'page' ? 'page' : 'knowledge', onSelect: () => openItem(item)},
          ...(item.kind === 'page' ? [{label: 'Rename', icon: 'edit', onSelect: () => onRenamePage(pages.find(page => page.id === item.id)!)}] : []),
          ...(item.kind !== 'folder' && !favouritesOnly && !inboxOnly && (collection || folder) ? [{label: collection ? 'Remove from collection' : 'Move to Inbox', icon: collection ? 'collection' : 'folder', onSelect: () => move(item, collection, null, !!collection)}] : []),
          ...(item.kind !== 'folder' ? [{label: 'Organize…', icon: 'folder', onSelect: () => setSelected(selected === item.kind + item.id ? null : item.kind + item.id)}] : [{label:'Add to collection…',icon:'collection',onSelect:()=>setAddFolder({folderId:item.id})}, ...(collection ? [{label:'Unlink from collection',icon:'close',onSelect:()=>run(()=>mutate('folder-memberships',{folder_id:item.id,collection_id:collection,remove:true}))}] : []), {label: 'Rename folder', icon: 'edit', onSelect: () => setEdit({type: 'folders', id: item.id, name: item.name, parent: data.folders.find(f => f.id === item.id)?.parent_id || ''})}, ...(!collection ? [{label: 'Remove folder', icon: 'trash', danger: true, onSelect: () => deleteContainer('folders', item.id)}] : [])]),
          {label: isFavourite(item) ? 'Remove from favourites' : 'Add to favourites', icon: 'star', onSelect: () => run(() => mutate('favourites', {kind: item.kind, item_id: item.id, favourite: !isFavourite(item)}))},
          ...(item.kind === 'page' ? [{label: 'Move to Trash', icon: 'trash', danger: true, onSelect: () => onDeletePage(pages.find(page => page.id === item.id)!)}] : []),
        ]}/></span></div>
        {item.kind !== 'folder' && selected === item.kind + item.id && <ItemOrganization data={data} kind={item.kind} itemId={item.id} pending={pending} onMove={(context, target, remove) => move(item, context, target, remove)}/>}
      </article>)}</div></div></> : <div className="organization-empty" role="status"><span className="destination-icon"><Icon name={search ? 'search' : favouritesOnly ? 'star' : 'folder'}/></span><h2>{query ? semantic.loading ? 'Searching note meaning…' : 'No matching content' : favouritesOnly ? 'Keep useful ideas close' : inboxOnly ? 'Your inbox is clear' : currentFolder ? 'This folder is empty' : currentCollection ? 'This collection is empty' : 'Nothing here yet'}</h2><p>{query ? 'Try another name or describe an idea. Semantic results include indexed notes in this space.' : favouritesOnly ? 'Star any page, folder, or entity to find it here.' : currentFolder ? 'Move notes or folders into this folder from Library or the sidebar.' : currentCollection ? 'Add notes or link a folder using collection options. Linked folders include future additions automatically.' : inboxOnly ? 'New notes appear here automatically. Move them to a folder when you’re ready. Collection membership does not change Inbox.' : 'Create a note or folder to get started. Filed notes live inside their folders.'}</p>{!!search && <button className="button" onClick={() => setSearch('')}>Clear search</button>}{!search && !favouritesOnly && (collection || folder) && <button className="button" onClick={() => onContextChange({collection: '', folder: ''})}>Browse Library<Icon name="chevron"/></button>}</div>}
    </div>
    {addFolder && <FolderCollectionDialog vaultId={vaultId} data={data} {...addFolder} onChanged={onChanged} onClose={()=>setAddFolder(null)}/>}
    {bulkOrganize && <Modal titleId="bulk-organize-title" onClose={() => { if (!pending) setBulkOrganize(false); }}><form onSubmit={event => { event.preventDefault(); run(() => bulkUpdate(bulkMode === 'folder' ? 'locations' : 'memberships', bulkMode === 'folder' ? {folder_id: bulkFolder || null} : {collection_id: bulkCollection, remove: bulkRemove})); }}><h2 id="bulk-organize-title">Organize {checked.length} pages</h2>
      <label>Action<Select value={bulkMode} disabled={pending} onChange={event => setBulkMode(event.target.value as 'folder' | 'collection')}><option value="folder">Move to folder</option><option value="collection">Update collection membership</option></Select></label>
      {bulkMode === 'folder' ? <label>Folder<Select value={bulkFolder} disabled={pending} onChange={event => setBulkFolder(event.target.value)}><option value="">Inbox (unfiled)</option>{data.folders.map(item => <option key={item.id} value={item.id}>{folderPath(item.id)}</option>)}</Select></label> : <><label>Collection<Select value={bulkCollection} disabled={pending} onChange={event => setBulkCollection(event.target.value)}><option value="" disabled>Choose a collection</option>{data.collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label><label>Membership<Select value={bulkRemove ? 'remove' : 'add'} disabled={pending} onChange={event => setBulkRemove(event.target.value === 'remove')}><option value="add">Add to collection</option><option value="remove">Remove from collection</option></Select></label></>}
      <p>{bulkMode === 'folder' ? 'Changes location and keeps collection memberships.' : 'Changes membership and keeps folder locations.'}</p>
      <div className="dialog-actions"><button type="button" className="button" disabled={pending} onClick={() => setBulkOrganize(false)}>Cancel</button><button className="button primary" disabled={pending || bulkMode === 'collection' && !bulkCollection || !checked.length}>{pending ? 'Saving…' : bulkMode === 'folder' ? 'Move pages' : bulkRemove ? 'Remove membership' : 'Add to collection'}</button></div></form></Modal>}
    {edit && <Modal titleId="container-title" onClose={() => setEdit(null)}><form onSubmit={e => { e.preventDefault(); run(async () => { await mutate(edit.type + (edit.id ? '/' + edit.id : ''), {name: edit.name, ...(edit.type === 'folders' ? {parent_id: edit.parent || null} : {})}, edit.id ? 'PUT' : 'POST'); setEdit(null); }); }}><h2 id="container-title">{edit.id ? 'Edit' : 'New'} {edit.type === 'collections' ? 'collection' : 'folder'}</h2><label>Name<input autoFocus required maxLength={200} value={edit.name} onChange={e => setEdit({...edit, name: e.target.value})}/></label>{edit.type === 'folders' && <label>Parent folder<Select value={edit.parent} onChange={e => setEdit({...edit, parent: e.target.value})}><option value="">Workspace root</option>{data.folders.filter(f => (!edit.id || !descendants(f, edit.id))).map(f => <option key={f.id} value={f.id}>{folderPath(f.id)}</option>)}</Select></label>}<div className="dialog-actions"><button type="button" className="button" onClick={() => setEdit(null)}>Cancel</button><button className="button primary" disabled={pending || !edit.name.trim()}>Save</button></div></form></Modal>}
    {remove && <ConfirmDialog title={'Remove ' + (remove.type === 'folders' ? 'folder?' : 'collection?')} description={remove.type === 'folders' ? `Remove “${remove.name}” and its subfolders? Their contents return to Inbox. Collection memberships and note favourites are kept.` : `Remove “${remove.name}”? Only its memberships are removed. Notes keep their folder locations.`} action="Remove" onClose={() => setRemove(null)} onConfirm={async () => {
      await mutate(remove.type + '/' + remove.id, undefined, 'DELETE');
      setFolder('');
      if (remove.type === 'collections') setCollection('');
    }}/>}
  </section>;
}
