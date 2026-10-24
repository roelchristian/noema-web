import {FolderDialog} from './FolderDialog';
import {CollectionDialog} from './CollectionDialog';
import {SmartCollectionStatus,SmartMembershipDetails} from './SmartCollectionStatus';
import {InboxTriage} from './InboxTriage';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {TitleText} from '../components/TitleText';
import type {PageReference} from '../../shared/embeddings';
import {citationLocation} from '../../shared/citations';
import type {SourceReference} from '../../shared/domain';
import {pageAIProvenance} from '../../shared/page-ai-status';
import {useLibraryViewState} from '../state/library-view-state';
import {FolderCollectionDialog} from './FolderCollectionDialog';
import {useLibraryRangeSelection} from '../state/use-library-range-selection';
import {useLibraryQuickPreview} from '../components/LibraryQuickPreview';
import {LibraryToolbar} from '../components/LibraryToolbar';
import {useLibraryDensity} from '../components/LibraryDensitySwitch';
import { inboxPages } from './inbox';
import { combinedMatches } from '../search/matches';
import { HighlightedText } from '../search/HighlightedText';
import { useSearchSnippets } from '../search/useSearchSnippets';
import { makeSearchSnippet } from '../../shared/search-snippets';
import { startFolderDrag } from './folder-drag';
import { folderDropHandlers } from './folder-drop';
import { startPageDrag } from './page-drag';
import { useTextSearch } from '../search/useTextSearch';
import { useSemanticSearch } from '../search/useSemanticSearch';
import { PageIcon } from '../components/PageIcon';
import { ActionMenu } from '../components/ActionMenu';
import { ItemOrganization } from './ItemOrganization';
import { Select } from '../components/Select';
import { useEffect, useId, useRef, useState, type SetStateAction } from 'react';
import {entityLabels} from '../../shared/domain';
import type { Entity, Folder, FavouriteKind, Organization, OrganizationContext, PageSummary } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal, ModalHeader } from '../components/Modal';

interface Item { aliases?: string[]; featuredImageId?:string|null; kind: FavouriteKind; id: string; name: string; label: string; icon?: string | null; description?: string; updatedAt?: string; entityType?: string }
interface EditContainer { type: 'collections' | 'folders'; id?: string; name: string; parent: string }
export function OrganizationLibrary({data, vaultId, pages, entities, favouritesOnly, inboxOnly = false, context, onContextChange, onChanged, onOpenPage, onOpenEntity, onOpenPassage, onOpenFolder, onRenamePage, onArchivePages, onDeletePage, onNewNote, onError, disabled = false, onRefresh}: {
  disabled?: boolean; onRefresh?:()=>Promise<void>;
  data: Organization; vaultId: string; pages: PageSummary[]; entities: Entity[]; favouritesOnly: boolean; inboxOnly?: boolean;
  context: OrganizationContext; onContextChange: (patch: Partial<OrganizationContext>) => void; onChanged: (data: Organization) => void;
  onNewNote: () => void; onOpenFolder: (id: string) => void;
  onArchivePages?:(ids:string[])=>Promise<void>;
  onRenamePage: (page: PageSummary) => void; onDeletePage: (page: PageSummary) => void;
  onOpenPassage:(reference:SourceReference,trigger?:HTMLElement)=>void; onOpenPage: (id: string,reference?:PageReference) => void; onOpenEntity: (id: string) => void; onError: (error: unknown) => void;
}) {
  const activeVault=useRef(vaultId);activeVault.current=vaultId;
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const {collection, folder} = favouritesOnly || inboxOnly ? {collection: '', folder: ''} : context;
  const destination = favouritesOnly ? 'favourites' : inboxOnly ? 'inbox' : JSON.stringify(['organization', collection, folder]);
  const [viewState, setViewState] = useLibraryViewState(vaultId, destination);
  const [density, setDensity, libraryRef] = useLibraryDensity(JSON.stringify([vaultId, destination]), favouritesOnly ? 'favourites' : inboxOnly ? 'inbox' : 'library', data.collections.find(item => item.id === collection)?.name === 'Reading Notes' ? 'comfortable' : 'standard');
  const allPages = viewState.scope === 'all' && !collection && !folder && !favouritesOnly && !inboxOnly;
  const related = viewState.searchMode === 'related';
  const [triaging, setTriaging] = useState(inboxOnly);
  const [addFolder,setAddFolder]=useState<{folderId?:string;collectionId?:string}|null>(null);
  const [localPending, setPending] = useState(false);
  const pending=localPending||disabled;
  const [dropTarget, setDropTarget] = useState<string | null>(null), [dropStatus, setDropStatus] = useState('');
  const moving = useRef(false);
  const setCollection = (collection: string) => onContextChange({collection, folder: ''});
  const setFolder = onOpenFolder;
  const search = viewState.query;
  const searchKey = JSON.stringify([vaultId, destination, search,allPages,related]);
  const [suppressedSearch, setSuppressedSearch] = useState<string | null>(null);
  const setSearch = (query: string) => {
    semantic.cancel();
    setSuppressedSearch(null);
    setViewState(previous => ({...previous, query, selectedIds: [], focusedRow: null}));
  };
  const [edit, setEdit] = useState<EditContainer | null>(null);
  const sort = ['modified-desc','modified-asc','title-asc','title-desc','type-asc','type-desc'].includes(viewState.sort) ? viewState.sort : 'modified-desc';
  const setSort = (sort: string) => setViewState(previous => ({...previous, sort}));
  const collectionsOpen = viewState.expanded.collections ?? true, contentsOpen = viewState.expanded.contents ?? true;
  const setExpanded = (section: string, action: SetStateAction<boolean>) => setViewState(previous => ({...previous, expanded: {...previous.expanded, [section]: typeof action === 'function' ? action(previous.expanded[section] ?? true) : action}}));
  const setCollectionsOpen = (action: SetStateAction<boolean>) => setExpanded('collections', action);
  const setContentsOpen = (action: SetStateAction<boolean>) => setExpanded('contents', action);
  const sectionId = useId();
  const collectionsId = sectionId + '-collections', contentsId = sectionId + '-contents';
  const checkedPages = new Set(viewState.selectedIds);
  const setCheckedPages = (action: SetStateAction<Set<string>>) => {
    suppressSemantic();
    setViewState(previous => ({...previous, selectedIds: [...(typeof action === 'function' ? action(new Set(previous.selectedIds)) : action)]}));
  };
  const [bulkOrganize, setBulkOrganize] = useState(false);
  const [bulkMode, setBulkMode] = useState<'folder' | 'collection'>('folder');
  const [bulkRemove, setBulkRemove] = useState(false);
  const [bulkCollection, setBulkCollection] = useState(''), [bulkFolder, setBulkFolder] = useState('');
  useEffect(() => {setBulkOrganize(false); setSelected(null);}, [vaultId, destination, search]);
  useEffect(()=>{setEdit(null);setPending(false);},[vaultId]);
  const query = search.trim().toLowerCase();
  const nameMatches = (item: Item) => item.name.toLowerCase().includes(query);
  const aliasMatches = (item: Item) => item.aliases?.some(alias => alias.toLowerCase().includes(query));
  const [remove, setRemove] = useState<{type: 'collections' | 'folders'; id: string; name: string} | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  async function mutate(route: string, body?: unknown, method = 'PUT') {
    if (pending) return;
    setPending(true);
    try { const updated = await api.organize(vaultId, route, body, method); if(mounted.current&&activeVault.current===vaultId)onChanged(updated); }
    finally { if(mounted.current&&activeVault.current===vaultId)setPending(false); }
  }
  const run = (work: () => Promise<unknown>) => { void work().catch(onError); };
  const items: Item[] = [
    ...(inboxOnly ? inboxPages(pages, data) : pages).map(p => ({kind: 'page' as const, id: p.id, name: p.title || 'Untitled', get label(){return uiText("Page")}, icon: p.icon, featuredImageId:p.featuredImageId, updatedAt: p.updated_at})),
    ...(favouritesOnly ? entities.filter(entity=>!entity.archived_at) : []).map(e => ({kind: 'entity' as const, id: e.id, name: e.name, aliases: e.aliases, label: entityLabels[e.type], description: e.description, updatedAt: e.updated_at, entityType: e.type})),
    ...(!inboxOnly ? data.folders : []).filter(f => favouritesOnly || (collection ? (data.folderLinks ?? []).some(link=>link.collection_id===collection && link.folder_id===f.id) : (f.parent_id || '') === folder)).map(f => ({kind: 'folder' as const, id: f.id, name: f.name, description:f.description, label: collection ? uiText("Linked folder") : uiText("Folder")})),
  ];
  const pagesById = new Map(pages.map(page => [page.id, page]));
  const linkedFolderCount = (id:string) => (data.folderLinks ?? []).filter(link=>link.collection_id===id).length;
  const collectionPreview = (id: string) => [...(data.folderLinks ?? []).filter(link=>link.collection_id===id).map(link=>data.folders.find(folder=>folder.id===link.folder_id)?.name ?? ''), ...data.memberships.filter(member => member.kind === 'page' && member.collection_id === id && pagesById.has(member.item_id)).slice(0, 3).map(member => pagesById.get(member.item_id)!.title || 'Untitled')].filter(Boolean).slice(0,3).join(' · ');
  const openItem = (item: Item) => {
    suppressSemantic();
    setViewState(previous => ({...previous, focusedRow: item.kind + ':' + item.id}));
    if (item.kind === 'folder') onOpenFolder(item.id); else if (item.kind === 'page') onOpenPage(item.id,textHits.get('page:'+item.id)?.pageReference??semanticNotes.get(item.id)?.pageReference); else {const reference=textHits.get('entity:'+item.id)?.reference??semanticNotes.get(item.id)?.reference;if(query&&reference)onOpenPassage(reference,document.activeElement instanceof HTMLElement?document.activeElement:undefined);else onOpenEntity(item.id);}
  };
  const folderDescription = (id: string) => {
    const notes = data.locations.filter(location => location.kind === 'page' && location.folder_id === id && pagesById.has(location.item_id)).length;
    const children = data.folders.filter(child => child.parent_id === id).length;
    return `${notes} ${notes === 1 ? 'page' : 'pages'} · ${children} ${children === 1 ? 'subfolder' : 'subfolders'}`;
  };
  const currentCollection = data.collections.find(c => c.id === collection), currentFolder = data.folders.find(f => f.id === folder);
  const currentDescription=currentFolder?currentFolder.description:currentCollection?.description;
  const isFavourite = (item: Item) => data.favourites.some(f => f.kind === item.kind && f.item_id === item.id);
  const location = (item: Item) => data.locations.find(l => l.kind === item.kind && l.item_id === item.id);
  const scopedItems = items.filter(item => {
    if (favouritesOnly) return isFavourite(item);
    if (allPages) return item.kind === 'page';
    if (item.kind === 'folder') return true;
    if (collection) return data.memberships.some(m => m.kind === item.kind && m.item_id === item.id && m.collection_id === collection);
    if (folder) return location(item)?.folder_id === folder;
    return !location(item)?.folder_id;
  });
  const scopedPageIds = scopedItems.filter(item => item.kind === 'page').map(item => item.id).sort();
  const scopedPageKey = JSON.stringify(scopedPageIds);
  useEffect(() => {
    const valid = new Set<string>(JSON.parse(scopedPageKey));
    setViewState(previous => {
      const selectedIds = previous.selectedIds.filter(id => valid.has(id));
      return selectedIds.length === previous.selectedIds.length ? previous : {...previous, selectedIds};
    });
  }, [vaultId, destination, scopedPageKey, setViewState]);
  const textSearch = useTextSearch(vaultId, search, pages.map(page => page.id + ':' + page.updated_at).join(',') + entities.map(entity => entity.id + ':' + entity.updated_at).join(','), {pageIds: scopedItems.filter(item => item.kind === 'page').map(item => item.id), entityIds: scopedItems.filter(item => item.kind === 'entity').map(item => item.id)}, 10000);
  const semantic = useSemanticSearch(vaultId, search, {enabled: related && !!query && !textSearch.loading && suppressedSearch !== searchKey && !checkedPages.size && !viewState.focusedRow, delayMs: 600});
  function suppressSemantic() {
    if (suppressedSearch === searchKey) return;
    semantic.cancel();
    setSuppressedSearch(searchKey);
  }
  const scopedKeys = new Set(scopedItems.map(item => item.kind + ':' + item.id));
  const textResults = textSearch.results.filter(hit => scopedKeys.has(hit.kind + ':' + hit.id));
  const textHits = new Map(textResults.map(hit => [hit.kind + ':' + hit.id, hit]));
  const matchLabel = (item: Item) => nameMatches(item) ? item.kind === 'page' ? 'Title' : 'Name' : aliasMatches(item) ? 'Alias' : textHits.get(item.kind + ':' + item.id)?.matchedIn === 'page' ? 'Page text' : textHits.has(item.kind + ':' + item.id) ? 'Text match' : 'Related by meaning';
  const localMatch = (item: Item) => nameMatches(item) || aliasMatches(item) || textHits.has(item.kind + ':' + item.id);
  const visible = combinedMatches(scopedItems, search, related ? semantic.results : [], textResults).sort((a, b) => {
    if (query && !!localMatch(a) !== !!localMatch(b)) return localMatch(a) ? -1 : 1;
    if (viewState.groupFolders !== false && (a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
    const titleOrder = a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'});
    if (sort.startsWith('type-')) return a.label.localeCompare(b.label)*(sort==='type-desc'?-1:1)||titleOrder;
    if (sort === 'title-asc') return titleOrder;
    if (sort === 'title-desc') return -titleOrder;
    const aDate = Date.parse(a.updatedAt || ''), bDate = Date.parse(b.updatedAt || '');
    if (!Number.isFinite(aDate) || !Number.isFinite(bDate)) return Number(Number.isFinite(bDate)) - Number(Number.isFinite(aDate)) || titleOrder;
    return (sort === 'modified-asc' ? aDate - bDate : bDate - aDate) || titleOrder;
  });
  const checked = visible.filter(item => item.kind === 'page' && checkedPages.has(item.id));
  const {showPreview,quickPreview}=useLibraryQuickPreview(libraryRef,{vaultId,items:visible,pages,entities,organization:data,onOpen:value=>{const item=visible.find(item=>item.kind===value.kind&&item.id===value.id);if(item)openItem(item);}});
  const automaticMembership = (kind: string, id: string, collectionId: string) => data.memberships.some(member => member.kind === kind && member.item_id === id && member.collection_id === collectionId && member.automatic && data.collections.find(c=>c.id===collectionId)?.kind!=='smart');
  const bulkRemovalProtected = checked.some(item => automaticMembership(item.kind,item.id,bulkCollection));
  const bulkRemoving = bulkRemove && !bulkRemovalProtected;
  const visiblePages = visible.filter(item => item.kind === 'page');
  const togglePage=useLibraryRangeSelection(visiblePages.map(item=>item.id),checkedPages,setCheckedPages,JSON.stringify([vaultId,destination,search,allPages]));
  const allChecked = visiblePages.length > 0 && checked.length === visiblePages.length;
  async function bulkUpdate(route: 'favourites' | 'locations' | 'memberships', body: Record<string, unknown>) {
    if (pending || !checked.length) return;
    setPending(true);
    try {
      for (const item of checked) {
        const updated = await api.organize(vaultId, route, {kind: 'page', item_id: item.id, ...body});
        if(!mounted.current||activeVault.current!==vaultId)return;
        onChanged(updated);
        setCheckedPages(previous => { const next = new Set(previous); next.delete(item.id); return next; });
      }
      setBulkOrganize(false);
    } finally { setPending(false); }
  }
  const semanticNotes = new Map((related ? semantic.results : []).map(result => [result.id, result]));
  const previewPages = (query ? visible : []).filter(item => item.kind === 'page' && !textHits.get('page:' + item.id)?.snippet && !semanticNotes.get(item.id)?.snippet);
  const previews = useSearchSnippets(vaultId, search, previewPages.map(item => item.id), false, previewPages.map(item => item.id + ':' + (item.updatedAt ?? '')).sort().join(','),libraryRef);
  const passageFor=(item:Item)=>item.kind==='entity'?(textHits.get('entity:'+item.id)?.reference??semanticNotes.get(item.id)?.reference):undefined;
  const snippetFor = (item: Item) => (passageFor(item)?citationLocation(passageFor(item)!)+': ':'')+(textHits.get(item.kind + ':' + item.id)?.snippet || semanticNotes.get(item.id)?.snippet || (item.kind === 'page' ? previews.snippets[item.id] ?? semanticNotes.get(item.id)?.snippet ?? '' : makeSearchSnippet(item.description ?? '', search)));
  const folderPath = (id: string): string => {
    const names: string[] = []; let f = data.folders.find(value => value.id === id);
    while (f) { names.unshift(f.name); f = data.folders.find(value => value.id === f!.parent_id); }
    return names.join(' / ');
  };
  function move(item: Item, context: string, target: string | null, remove = false) {
    if (item.kind === 'folder') return;
    run(() => mutate(context ? 'memberships' : 'locations', {kind: item.kind, item_id: item.id, ...(context ? {collection_id: context, remove} : {folder_id: target || null, remove})}));
  }
  function deleteContainer(type: 'collections' | 'folders', id: string) {
    const name = (type === 'folders' ? data.folders : data.collections).find(item => item.id === id)?.name || '';
    setRemove({type, id, name});
  }
  const collectionCards = !collection && !folder ? data.collections.filter(c => c.name.toLowerCase().includes(query)) : [];
  const countLabel = (count: number) => `${count} ${count === 1 ? 'page' : 'pages'}`;
  const filterScope = allPages ? 'All pages' : favouritesOnly ? 'Favourites' : inboxOnly ? 'Inbox' : currentFolder ? `Folder: ${currentFolder.name}` : currentCollection ? `Collection: ${currentCollection.name}` : 'Pages root';
  const filterControl = <div className="library-view-filter"><div className="library-view-filter-input"><Icon name="search"/><input type="search" disabled={pending} placeholder={uiText("Filter this view…")} aria-label={uiText("Filter {value0}",{value0: filterScope})} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {if (event.key === 'Escape' && search) {event.preventDefault(); setSearch('');}}}/>{search && <button type="button" aria-label={uiText("Clear view filter")} onClick={() => setSearch('')}><Icon name="close"/></button>}</div></div>;
  const toolbar = <LibraryToolbar filter={filterControl} typeSort sort={sort} onSort={setSort} group={viewState.groupFolders !== false} onGroup={groupFolders=>setViewState({groupFolders})} density={density} onDensity={setDensity} disabled={pending}>
    <label>{uiText("Columns")}<Select aria-label="List columns" value={viewState.columns ?? 'basic'} onChange={event=>setViewState({columns:event.target.value})}><option value="basic">Name and modified</option><option value="location">Include location</option><option value="collections">Include collections</option></Select></label>
    {!collection&&!folder&&!favouritesOnly&&!inboxOnly&&<label>{uiText("Scope")}<Select aria-label="Pages browsing scope" value={allPages?'all':'level'} onChange={event=>setViewState({scope:event.target.value,selectedIds:[],focusedRow:null})}><option value="level">Current level</option><option value="all">All pages</option></Select></label>}
    <label>{uiText("Search matching")}<Select aria-label="Search matching" value={related?'related':'local'} onChange={event=>{semantic.cancel();setSuppressedSearch(null);setViewState({searchMode:event.target.value,selectedIds:[],focusedRow:null});}}><option value="local">Text in this scope</option><option value="related">Text + related in this scope</option></Select></label>
  </LibraryToolbar>;
  const isHomepage = !favouritesOnly && !inboxOnly && !collection && !folder;
  return <section ref={libraryRef} data-library-vault={vaultId} data-library-destination={destination} className="organization-library organization-browser" data-density={density} data-columns={viewState.columns ?? 'basic'} data-layout={inboxOnly && triaging ? 'triage' : 'list'}
    onFocusCapture={event => {if (event.target.closest('[data-library-row]')) suppressSemantic();}}
    onPointerDownCapture={event => {if ((event.target as Element).closest('[data-library-row]')) suppressSemantic();}}
    onPointerMoveCapture={event => {if ((event.target as Element).closest('[data-library-row]')) suppressSemantic();}}
    onDragEnd={() => setDropTarget(null)}>
    <span className="sr-only" role="status">{dropStatus}</span>
    {(favouritesOnly || !collection && !folder) && <div className={'organization-heading' + (isHomepage ? ' pages-home-heading' : '')}><div className="library-heading-row"><h1 className="page-heading">{favouritesOnly ? uiText("Favourites") : inboxOnly ? uiText("To organise") : uiText("Pages")}</h1></div><div className="pages-home-actions library-heading-actions">{inboxOnly && <button type="button" className="button" disabled={pending} onClick={() => setTriaging(value => !value)}><Icon name={triaging ? 'view-list' : 'inbox'}/>{triaging ? 'Browse pages' : 'Start triage'}</button>}{isHomepage && <><button type="button" className="button library-create-icon" aria-label={uiText("New folder")} title={uiText("New folder")} disabled={pending} onClick={() => setEdit({type: 'folders', name: '', parent: ''})}><Icon name="folder-plus"/></button><button type="button" className="button library-create-icon" aria-label={uiText("New collection")} title={uiText("New collection")} disabled={pending} onClick={() => setEdit({type: 'collections', name: '', parent: ''})}><Icon name="collection-plus"/></button><button className="button primary" disabled={pending} onClick={onNewNote}><Icon name="compose"/>{uiText("New Note")}</button></>}</div></div>}
    <div className="organization-content" aria-busy={pending}>
      {!isHomepage && !favouritesOnly && !inboxOnly && !collection && <div className="organization-browser-toolbar">
        <div className="organization-create-actions"><button className="button" disabled={pending} onClick={() => setEdit({type: 'folders', name: '', parent: folder})}><Icon name="folder"/>{uiText("New folder")}</button><button className="button primary" disabled={pending} onClick={() => setEdit({type: 'collections', name: '', parent: ''})}><Icon name="plus"/>{uiText("New collection")}</button></div>
      </div>}
      {!!query && <div className="search-feedback" aria-live="polite">
        {textSearch.loading && <p className="search-status" role="status">{uiText("Filtering page text…")}</p>}
        {textSearch.hasMore && <p className="search-status" role="status">{uiText("More text matches are available. Narrow this filter to see them.")}</p>}
        {textSearch.error && <p className="search-error" role="alert">{textSearch.error}{" " + uiText("Name and alias matches are still shown.")}</p>}
        {semantic.loading && <p className="search-status" role="status">{uiText("Finding related notes… Text matches are available now.")}</p>}
        {semantic.error && <p className="search-error" role="alert">{semantic.error}{" " + uiText("Text matches are still shown.")}</p>}
        {previews.error && <p className="search-error">{uiText("Some note previews are unavailable. You can still open the results.")}</p>}
      </div>}
      {!favouritesOnly && (currentFolder || currentCollection) && <div className="organization-context-heading"><span className="destination-icon"><Icon name={currentFolder ? 'folder' : 'collection'}/></span><div className="organization-context-title"><div className="library-heading-row"><h1 className="page-heading">{currentFolder?.name || currentCollection?.name}</h1></div>{currentDescription&&<p className="organization-description">{currentDescription}</p>}</div><div className="library-heading-actions"><ActionMenu lazy label={uiText("Folder and collection options")} disabled={pending} actions={[
        {label:currentFolder?uiText("Add to collection…"):uiText("Add folder…"),icon:'collection',onSelect:()=>setAddFolder(currentFolder?{folderId:currentFolder.id}:{collectionId:collection})},
        {label: currentCollection ? 'Edit collection' : 'Edit folder', icon: 'edit', onSelect: () => setEdit(currentFolder ? {type: 'folders', id: currentFolder.id, name: currentFolder.name, parent: currentFolder.parent_id || ''} : {type: 'collections', id: collection, name: currentCollection!.name, parent: ''})},
        {get label(){return uiText("Delete")}, icon: 'trash', danger: true, onSelect: () => deleteContainer(currentFolder ? 'folders' : 'collections', currentFolder?.id || collection)},
      ]}/></div></div>}
      {(!inboxOnly || !triaging) && <>{toolbar}<div className="library-scope" role="status"><span>{visible.length} {visible.length===1?'item':'items'} · {filterScope}</span></div></>}
      {currentCollection?.kind==='smart' && <SmartCollectionStatus key={vaultId+collection} vaultId={vaultId} collection={currentCollection} data={data} itemNames={new Map([...pages.map(p=>['page:'+p.id,p.title||'Untitled'] as const),...entities.map(e=>['entity:'+e.id,e.name] as const)])} onChanged={onChanged} onError={onError}/>}
      {!favouritesOnly && !inboxOnly && <>
        {!collection && !folder && !allPages && <div className="organization-container-section"><div className="organization-section-title"><h2><button type="button" className="organization-section-toggle" aria-expanded={collectionsOpen} aria-controls={collectionsId} onClick={() => setCollectionsOpen(open => !open)}><Icon name="chevron"/>{uiText("Collections") + " "}<span>{collectionCards.length}</span></button></h2></div><div id={collectionsId} hidden={!collectionsOpen} className="organization-container-grid">{collectionCards.map(c => <button className="organization-container-card" key={c.id} data-library-row={'collection:' + c.id} data-library-focus onClick={() => {setViewState(previous => ({...previous, focusedRow: 'collection:' + c.id})); setCollection(c.id);}}><span className="destination-icon"><Icon name="collection"/></span><Icon name="chevron"/><strong>{c.name}</strong><small>{c.kind==='smart'?(c.matching==='hybrid'?'Smart · Rules + semantic · ':c.matching==='examples'?'Smart · Examples · ':c.matching==='semantic'?'Smart · Semantic · ':'Smart · Rules · '):''}{countLabel(data.memberships.filter(l => l.kind === 'page' && l.collection_id === c.id).length) + (linkedFolderCount(c.id) ? uiText(" · {value0} linked {value1}",{value0: linkedFolderCount(c.id),value1: linkedFolderCount(c.id)===1?'folder':'folders'}) : '')}</small><span className="collection-preview">{[c.description,collectionPreview(c.id)].filter(Boolean).join(' · ')}</span></button>)}{!query && <button className="organization-container-card organization-new-card" disabled={pending} onClick={() => setEdit({type: 'collections', name: '', parent: ''})}><Icon name="plus"/><strong>{uiText("New collection")}</strong></button>}</div></div>}
      </>}
      {visible.length > 0 || inboxOnly && triaging ? <>
      {(!folder && !collection) && <div className="organization-section-title organization-content-title"><h2>{isHomepage ? <button type="button" className="organization-section-toggle" aria-expanded={contentsOpen} aria-controls={contentsId} onClick={() => setContentsOpen(open => !open)}><Icon name="chevron"/>{uiText("Contents")}</button> : <>{favouritesOnly ? uiText("Saved favourites") : inboxOnly ? uiText("Unfiled pages") : uiText("Contents")}</>}</h2></div>}
      <div id={contentsId} hidden={isHomepage && !contentsOpen}>
      {!favouritesOnly && checked.length > 0 && <div className="organization-bulk-actions" role="toolbar" aria-label={uiText("Selected page actions")}>{onArchivePages&&<button disabled={pending} onClick={()=>run(async()=>{await onArchivePages?.(checked.map(page=>page.id));setCheckedPages(new Set());})}>Archive</button>}<span role="status">{checked.length}{" " + uiText("selected")}</span><button disabled={pending} onClick={() => run(() => bulkUpdate('favourites', {favourite: true}))}><Icon name="star"/>{uiText("Favourite")}</button><button disabled={pending} onClick={() => run(() => bulkUpdate('favourites', {favourite: false}))}>{uiText("Unfavourite")}</button><button disabled={pending} onClick={() => { setBulkMode('folder'); setBulkRemove(false); setBulkCollection(collection || data.collections[0]?.id || ''); setBulkFolder(folder); setBulkOrganize(true); }}><Icon name="folder"/>{uiText("Organize")}</button><button disabled={pending} onClick={() => setCheckedPages(new Set())}>{uiText("Clear")}</button></div>}
      {inboxOnly && triaging ? <InboxTriage onRefresh={onRefresh} vaultId={vaultId} pages={visiblePages.map(item=>pagesById.get(item.id)!)} allPages={pages} entities={entities} data={data} checked={checkedPages} onToggle={togglePage} onSelectAll={ids=>setCheckedPages(ids.every(id=>checkedPages.has(id)) ? new Set() : new Set(ids))} onBusyChange={setPending} onChanged={onChanged} onOpenPage={onOpenPage} onOpenEntity={onOpenEntity} onArchive={id=>onArchivePages?.([id])??Promise.resolve()} onTrash={onDeletePage} disabled={pending}/> : <div className={'organization-items'  + (checked.length ? ' has-selection' : '')}>
      {!favouritesOnly && density === 'compact' && <label className="library-select-all"><input type="checkbox" aria-label={uiText("Select all visible pages")} checked={allChecked} ref={input => { if (input) input.indeterminate = checked.length > 0 && !allChecked; }} disabled={pending || !visiblePages.length} onChange={() => setCheckedPages(allChecked ? new Set() : new Set(visiblePages.map(item => item.id)))}/>{uiText("Select all")}</label>}
      {!favouritesOnly && density !== 'compact' && <div className="organization-list-head" aria-label={uiText("Page columns")}>
        <label className="page-selection page-selection-header"><input type="checkbox" aria-label={uiText("Select all visible pages")} checked={allChecked} ref={input => { if (input) input.indeterminate = checked.length > 0 && !allChecked; }} disabled={pending || !visiblePages.length} onChange={() => setCheckedPages(allChecked ? new Set() : new Set(visiblePages.map(item => item.id)))}/><span className="page-selection-check"><Icon name="check"/></span></label>
        <span>{uiText("Name")}</span>
        {(viewState.columns === 'location' || viewState.columns === 'collections') && <span className="library-extra-heading">{viewState.columns === 'collections' ? uiText("Collections") : uiText("Location")}</span>}
        <span>{uiText("Modified")}</span>
        <span aria-hidden="true"/><span className="sr-only">{uiText("Page actions")}</span>
      </div>}
      {visible.map(item => <article data-library-row={item.kind + ':' + item.id} className={'organization-item' + (item.kind === 'page' && checkedPages.has(item.id) ? ' is-checked' : '') + (dropTarget === item.id && item.kind === 'folder' ? ' is-drop-target' : '')} key={item.kind + item.id}
        {...(item.kind === 'folder' ? folderDropHandlers({folder: data.folders.find(folder => folder.id === item.id)!, vaultId, pages, data, pending, moving, onHover: setDropTarget, onStatus: setDropStatus, onMove: (pageId, folderId) => mutate('locations', {kind: 'page', item_id: pageId, folder_id: folderId}), onMoveFolder: (source, parentId) => mutate('folders/' + source.id, {name: source.name, parent_id: parentId}), onError}) : {})}>
        <div className={'organization-item-row' + (favouritesOnly ? '' : ' organization-page-row')} draggable={(item.kind === 'page' || item.kind === 'folder') && !pending && !checked.length} onDragStart={event => { if (item.kind === 'page') startPageDrag(event, vaultId, item.id); else if (item.kind === 'folder') startFolderDrag(event, vaultId, item.id); }}>{!favouritesOnly && item.kind === 'page' ? <label className="organization-item-icon page-selection" draggable={false}><span className="page-selection-icon"><PageIcon icon={item.icon}/></span><input type="checkbox" aria-label={uiText("Select ") + item.name} checked={checkedPages.has(item.id)} disabled={pending} onChange={event=>togglePage(item.id,(event.nativeEvent as MouseEvent).shiftKey)}/><span className="page-selection-check"><Icon name="check"/></span></label> : <span className="organization-item-icon">{item.kind === 'page' ? <PageIcon icon={item.icon}/> : <Icon name={item.kind === 'folder' ? collection ? 'folder-linked' : 'folder' : item.entityType ?? 'knowledge'}/>}</span>}<button data-library-focus className="organization-item-name" title={query ? item.name + ' · ' + matchLabel(item) : item.name} onClick={() => openItem(item)}><span className="organization-page-title">{item.kind==='page'?<TitleText text={item.name} query={search}/>:<HighlightedText text={item.name} query={search}/>}</span>{(viewState.columns === 'location') && <span className="library-item-extra">{location(item)?.folder_id ? folderPath(location(item)!.folder_id!) : item.kind === 'page' ? 'Unfiled' : folderDescription(item.id)}</span>}{viewState.columns === 'collections' && <span className="library-item-extra">{data.memberships.filter(member=>member.kind===item.kind&&member.item_id===item.id).map(member=>data.collections.find(value=>value.id===member.collection_id)?.name).filter(Boolean).join(', ') || '—'}</span>}<small>{favouritesOnly ? item.label : item.kind === 'folder' ? <><span className="sr-only">{folderDescription(item.id)}</span><span aria-hidden="true">{collection ? uiText("Linked folder") : '—'}</span></> : item.updatedAt && Number.isFinite(Date.parse(item.updatedAt)) ? <time dateTime={item.updatedAt} title={new Date(item.updatedAt).toLocaleString(getLocale())}>{new Date(item.updatedAt).toLocaleDateString(getLocale(), {month: 'short', day: 'numeric', year: 'numeric'})}</time> : uiText("Modified date unavailable")}{item.kind === 'page' && <PageAIHistoryLabel page={pagesById.get(item.id)}/>}{!!query && <span className="search-match-badge">{matchLabel(item)}</span>}</small>{!!query && !!(item.kind === 'folder' ? [item.description,folderDescription(item.id)].filter(Boolean).join(' · ') : snippetFor(item)) && <span className="search-result-snippet item-preview"><HighlightedText text={item.kind === 'folder' ? [item.description,folderDescription(item.id)].filter(Boolean).join(' · ') : snippetFor(item)} query={search}/></span>}</button><button className={'favourite-button ' + (isFavourite(item) ? 'is-favourite' : '')} disabled={pending} aria-label={(isFavourite(item) ? uiText("Remove favourite: ") : uiText("Favourite: ")) + item.name} aria-pressed={isFavourite(item)} onClick={() => run(() => mutate('favourites', {kind: item.kind, item_id: item.id, favourite: !isFavourite(item)}))}><Icon name="star"/></button><span className="page-row-actions"><ActionMenu lazy label={'Actions for ' + item.name} disabled={pending} actions={[
          {get label(){return uiText("Open")}, icon: item.kind === 'folder' ? collection ? 'folder-linked' : 'folder' : item.kind === 'page' ? 'page' : 'knowledge', onSelect: () => openItem(item)},
          ...(item.kind !== 'folder' ? [{label:'Quick preview',icon:'page',onSelect:()=>showPreview(item)}] : []),
          ...(item.kind === 'page' ? [{get label(){return uiText("Rename")}, icon: 'edit', onSelect: () => onRenamePage(pages.find(page => page.id === item.id)!)}] : []),
          ...(item.kind !== 'folder' && !favouritesOnly && !inboxOnly && (collection || folder) && !automaticMembership(item.kind,item.id,collection) ? [{label: currentCollection?.kind==='smart' ? 'Exclude from this collection' : collection ? uiText("Remove from collection") : uiText("Move to Inbox"), icon: collection ? 'collection' : 'folder', onSelect: () => move(item, collection, null, !!collection)}] : []),
          ...(item.kind !== 'folder' ? [{label: uiText("Organize…"), icon: 'folder', onSelect: () => setSelected(selected === item.kind + item.id ? null : item.kind + item.id)}] : [{label:uiText("Add to collection…"),icon:'collection',onSelect:()=>setAddFolder({folderId:item.id})}, ...(collection ? [{label:uiText("Unlink from collection"),icon:'close',onSelect:()=>run(()=>mutate('folder-memberships',{folder_id:item.id,collection_id:collection,remove:true}))}] : []), {label: 'Edit folder', icon: 'edit', onSelect: () => setEdit({type: 'folders', id: item.id, name: item.name, parent: data.folders.find(f => f.id === item.id)?.parent_id || ''})}, ...(!collection ? [{label: uiText("Remove folder"), icon: 'trash', danger: true, onSelect: () => deleteContainer('folders', item.id)}] : [])]),
          {label: isFavourite(item) ? uiText("Remove from favourites") : uiText("Add to favourites"), icon: 'star', onSelect: () => run(() => mutate('favourites', {kind: item.kind, item_id: item.id, favourite: !isFavourite(item)}))},
          ...(item.kind === 'page' ? [{label:'Archive',icon:'archive',onSelect:()=>void onArchivePages?.([item.id]).catch(onError)},{label: uiText("Move to Trash"), icon: 'trash', danger: true, onSelect: () => onDeletePage(pages.find(page => page.id === item.id)!)}] : []),
        ]}/></span></div>
        {currentCollection?.kind==='smart' && item.kind!=='folder' && data.memberships.filter(m=>m.collection_id===collection&&m.kind===item.kind&&m.item_id===item.id).map(member=><SmartMembershipDetails key={member.item_id} membership={member} semantic={!!currentCollection.matching&&currentCollection.matching!=='rules'} disabled={pending} onDecision={decision=>run(()=>mutate('memberships',{kind:item.kind,item_id:item.id,collection_id:collection,...(decision==='reset'?{reset:true}:{remove:decision==='exclude'})}))}/>)}
        {item.kind !== 'folder' && selected === item.kind + item.id && <ItemOrganization data={data} kind={item.kind} itemId={item.id} pending={pending} onMove={(context, target, remove) => move(item, context, target, remove)}/>}
      </article>)}</div>}</div></> : <div className="organization-empty" role="status"><span className="destination-icon"><Icon name={search ? 'search' : favouritesOnly ? 'star' : 'folder'}/></span><h2>{query ? semantic.loading || textSearch.loading ? uiText("Filtering this view…") : uiText("No matching content") : favouritesOnly ? uiText("Keep useful ideas close") : inboxOnly ? uiText("No unfiled pages") : currentFolder ? uiText("This folder is empty") : currentCollection ? uiText("This collection is empty") : uiText("Nothing here yet")}</h2><p>{query ? uiText("Try a title, page text, or an idea in this view. Use ⌘/Ctrl+K to search the whole vault.") : favouritesOnly ? uiText("Star any page, folder, or entity to find it here.") : currentFolder ? uiText("Move notes or folders into this folder from Pages or the sidebar.") : currentCollection ? uiText("Add notes or link a folder using collection options. Linked folders include future additions automatically.") : inboxOnly ? uiText("New notes appear here automatically. Move them to a folder when you’re ready. Collection membership does not change Inbox.") : uiText("Create a note or folder to get started. Filed notes live inside their folders.")}</p>{!!search && <button className="button" onClick={() => setSearch('')}>{uiText("Clear filter")}</button>}{!search && !favouritesOnly && (collection || folder) && <button className="button" onClick={() => onContextChange({collection: '', folder: ''})}>{uiText("Browse Pages")}<Icon name="chevron"/></button>}</div>}
    </div>
    {quickPreview}
    {addFolder && <FolderCollectionDialog vaultId={vaultId} data={data} {...addFolder} onChanged={onChanged} onClose={()=>setAddFolder(null)}/>}
    {bulkOrganize && <Modal titleId="bulk-organize-title" onClose={() => { if (!pending) setBulkOrganize(false); }}><form onSubmit={event => { event.preventDefault(); run(() => bulkUpdate(bulkMode === 'folder' ? 'locations' : 'memberships', bulkMode === 'folder' ? {folder_id: bulkFolder || null} : {collection_id: bulkCollection, remove: bulkRemoving})); }}><ModalHeader titleId="bulk-organize-title" closeDisabled={pending}>{uiText("Organize") + " "}{checked.length}{" " + uiText("pages")}</ModalHeader>
      <label>{uiText("Action")}<Select value={bulkMode} disabled={pending} onChange={event => setBulkMode(event.target.value as 'folder' | 'collection')}><option value="folder">{uiText("Move to folder")}</option><option value="collection">{uiText("Update collection membership")}</option></Select></label>
      {bulkMode === 'folder' ? <label>{uiText("Folder")}<Select value={bulkFolder} disabled={pending} onChange={event => setBulkFolder(event.target.value)}><option value="">{uiText("Inbox (unfiled)")}</option>{data.folders.map(item => <option key={item.id} value={item.id}>{folderPath(item.id)}</option>)}</Select></label> : <><label>{uiText("Collection")}<Select value={bulkCollection} disabled={pending} onChange={event => setBulkCollection(event.target.value)}><option value="" disabled>{uiText("Choose a collection")}</option>{data.collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label><label>{uiText("Membership")}<Select value={bulkRemoving ? 'remove' : 'add'} disabled={pending} onChange={event => setBulkRemove(event.target.value === 'remove')}><option value="add">{uiText("Add to collection")}</option>{!bulkRemovalProtected && <option value="remove">{uiText("Remove from collection")}</option>}</Select></label></>}
      <p>{bulkMode === 'folder' ? uiText("Changes location and keeps collection memberships.") : uiText("Changes membership and keeps folder locations.")}</p>
      <div className="dialog-actions"><button type="button" className="button" disabled={pending} onClick={() => setBulkOrganize(false)}>{uiText("Cancel")}</button><button className="button primary" disabled={pending || bulkMode === 'collection' && !bulkCollection || !checked.length}>{pending ? uiText("Saving…") : bulkMode === 'folder' ? uiText("Move pages") : bulkRemoving ? uiText("Remove membership") : uiText("Add to collection")}</button></div></form></Modal>}
    {edit?.type === 'collections' && <CollectionDialog key={vaultId+':'+(edit.id??'new')} vaultId={vaultId} data={data} pages={pages} collection={data.collections.find(c=>c.id===edit.id)} onChanged={onChanged} onClose={()=>setEdit(null)}/>}
    {edit?.type === 'folders' && <FolderDialog key={vaultId+':'+(edit.id??'new')} vaultId={vaultId} data={data} folder={data.folders.find(f=>f.id===edit.id)} parentId={edit.parent} onChanged={onChanged} onClose={()=>setEdit(null)}/>}
    {remove && <ConfirmDialog danger title={uiText("Remove ") + (remove.type === 'folders' ? uiText("folder?") : uiText("collection?"))} description={remove.type === 'folders' ? `Remove “${remove.name}” and its subfolders? Their contents return to Inbox. Collection memberships and note favourites are kept.` : `Remove “${remove.name}”? Only its memberships are removed. Notes keep their folder locations.`} action={uiText("Remove")} onClose={() => setRemove(null)} onConfirm={async () => {
      await mutate(remove.type + '/' + remove.id, undefined, 'DELETE');
      setFolder('');
      if (remove.type === 'collections') setCollection('');
    }}/>}
  </section>;
}

function PageAIHistoryLabel({page}: {page?: PageSummary}) {
  if (!page) return null;
  const provenance = pageAIProvenance(page);
  return provenance.assisted ? <span className="page-ai-library-status" title={provenance.description.split(' · ').map(label => uiText(label)).join(' · ')}>{uiText(provenance.label)}</span> : null;
}
