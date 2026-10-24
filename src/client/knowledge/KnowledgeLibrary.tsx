import {entityIconName} from '../../shared/entity-icons';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {useState} from 'react';
import {SourceLifecycleDialog} from './SourceLifecycleDialog';
import {useTextSearch} from '../search/useTextSearch';
import {useSemanticSearch} from '../search/useSemanticSearch';
import {combinedMatches} from '../search/matches';
import {citationLocation} from '../../shared/citations';
import type {SourceReference} from '../../shared/domain';
import {PageCover} from '../components/PageCover';
import {LibraryToolbar} from '../components/LibraryToolbar';
import {useViewMode} from '../components/ViewModeSwitch';
import { entityLabels, entityTypes, type Entity, type EntityType } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { HighlightedText } from '../search/HighlightedText';
import { useEntitySchema } from './useEntitySchema';
import { useLibraryViewState } from '../state/library-view-state';
import { captureLibraryView } from '../state/use-library-scroll';

function sourceFileSize(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = bytes > 0 ? Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1) : 0;
  return new Intl.NumberFormat(getLocale(), {maximumFractionDigits: index ? 1 : 0}).format(bytes / 1000 ** index) + ' ' + units[index];
}

export function KnowledgeLibrary({vaultId, entities, onOpen, onOpenPassage, onCreate, onCreatePageFromSource, onUpdated}: {onUpdated:()=>Promise<void>; vaultId: string; entities: Entity[]; onOpen: (id: string) => void; onOpenPassage:(reference:SourceReference,trigger?:HTMLElement)=>void; onCreate: () => void; onCreatePageFromSource:(source:Entity)=>void}) {
  const [browser, setBrowser] = useLibraryViewState(vaultId, 'knowledge');
  const view = browser.grouping === 'all' ? 'all' : 'folders';
  const type: EntityType | '' = entityTypes.includes(browser.entityType as EntityType) ? browser.entityType as EntityType : '';
  const sourcesOnly = type === 'source';
  const [archived,setArchived]=useState(false),[manageSource,setManageSource]=useState<Entity|null>(null);
  const destination = JSON.stringify(['knowledge', type]);
  const [viewState, setViewState] = useLibraryViewState(vaultId, destination);
  const [viewMode, setViewMode, libraryRef] = useViewMode(JSON.stringify([vaultId, destination]), 'knowledge');
  const {schema, error} = useEntitySchema(vaultId);
  const search = viewState.query, sort = viewState.sort;
  const setSearch = (query: string) => setViewState({query});
  const setSort = (sort: string) => setViewState({sort});
  const filterScope = type ? `${entityLabels[type]} entities` : 'All knowledge entities';
  const query = search.trim().toLowerCase();
  const scoped = entities.filter(entity => !!entity.archived_at===archived && (sourcesOnly ? entity.type === 'source' : entity.type !== 'source' && (!type || entity.type === type)));
  const textSearch=useTextSearch(vaultId,search,scoped.map(entity=>entity.id+':'+entity.updated_at+':'+entity.sourceStatus).join(','),{pageIds:[],entityIds:scoped.map(entity=>entity.id)},10000);
  const semantic=useSemanticSearch(vaultId,search,{enabled:viewState.searchMode==='related'&&!archived&&!!query&&!textSearch.loading});
  const textHits=new Map(textSearch.results.map(hit=>[hit.id,hit]));
  const semanticHits=new Map((viewState.searchMode==='related'&&!archived?semantic.results:[]).filter(hit=>hit.kind==='entity').map(hit=>[hit.id,hit]));
  const matches=combinedMatches(scoped.map(entity=>({...entity,kind:'entity' as const})),search,viewState.searchMode==='related'&&!archived?semantic.results:[],textSearch.results);
  const passageFor=(id:string)=>textHits.get(id)?.reference??semanticHits.get(id)?.reference;
  const openMatch=(id:string,trigger:HTMLElement)=>{const reference=query?passageFor(id):undefined;if(reference)onOpenPassage(reference,trigger);else onOpen(id);};
  const filtered = view === 'all' || !!query || !!type ? matches : [];
  const titleOrder = (a: string, b: string) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}) * (sort === 'title-desc' ? -1 : 1);
  filtered.sort((a, b) => {
    if (sort.startsWith('title-')) return titleOrder(a.name, b.name);
    const aDate = Date.parse(a.updated_at), bDate = Date.parse(b.updated_at);
    const aValid = Number.isFinite(aDate), bValid = Number.isFinite(bDate);
    if (!aValid || !bValid) return Number(bValid) - Number(aValid) || titleOrder(a.name, b.name);
    return (sort === 'modified-asc' ? aDate - bDate : bDate - aDate) || titleOrder(a.name, b.name);
  });
  const countLabel = (count: number) => `${count} ${sourcesOnly ? count === 1 ? 'source' : 'sources' : count === 1 ? 'entity' : 'entities'}`;
  const folders = view === 'folders' && !query && !type
    ? entityTypes.filter(item => item !== 'source').map(item => ({id: item, name: entityLabels[item], count: scoped.filter(entity => entity.type === item).length, type: item})) : [];
  folders.sort((a, b) => titleOrder(a.name, b.name));
  function navigate(nextType: EntityType | '' = '') {
    captureLibraryView();
    setBrowser({entityType: nextType});
  }
  return <section ref={libraryRef} className="organization-library organization-browser knowledge-library" data-layout={viewMode} data-library-vault={vaultId} data-library-destination={destination}>
    <div className="organization-heading pages-home-heading"><div className="library-heading-row"><h1 className="page-heading">{sourcesOnly?uiText("Sources"):uiText("Knowledge entities")}</h1></div><div className="pages-home-actions library-heading-actions"><LibraryToolbar sort={sort} onSort={setSort} mode={viewMode} onMode={setViewMode} filter={<div className="library-view-filter"><div className="library-view-filter-input"><Icon name="search"/><input type="search" placeholder={uiText("Filter this view…")} aria-label={uiText("Filter {value0} by name, alias, or source text",{value0: filterScope})} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {if (event.key === 'Escape' && search) {event.preventDefault(); setSearch('');}}}/>{search && <button type="button" aria-label={uiText("Clear entity filter")} onClick={() => setSearch('')}><Icon name="close"/></button>}</div></div>}/><Select aria-label="Search matching" value={viewState.searchMode??'local'} onChange={event=>setViewState({searchMode:event.target.value})}><option value="local">Text in this scope</option>{!archived&&<option value="related">Text + related in this scope</option>}</Select>
      <Select aria-label={sourcesOnly?uiText("Source status"):uiText("Entity status")} value={archived?'archived':'active'} onChange={event=>setArchived(event.target.value==='archived')}><option value="active">{sourcesOnly?uiText("Active sources"):uiText("Active entities")}</option><option value="archived">{sourcesOnly?uiText("Archived sources"):uiText("Archived entities")}</option></Select>
      <button className="button primary" onClick={onCreate}><Icon name="plus"/>{sourcesOnly?uiText("New source"):uiText("New entity")}</button>
    </div></div>
    {error && <p role="alert">{error}</p>}{textSearch.error&&<p role="status">{uiText("Source text search unavailable. Name matches remain available.")}</p>}{(textSearch.loading||semantic.loading)&&<p role="status">{uiText("Searching source passages…")}</p>}
    <div className="organization-content">
      <div className="organization-section-title knowledge-browser-controls" hidden={sourcesOnly}>
        <Select aria-label={uiText("Entity grouping")} value={view} onChange={event => {captureLibraryView(); setBrowser({grouping: event.target.value, entityType: ''});}}><option value="folders">{uiText("Browse by type")}</option><option value="all">{uiText("Show all")}</option></Select>
      </div>
      <p className="organization-hint" role="status">{query ? uiText("{value0} found",{value0: countLabel(matches.length)}) : countLabel(scoped.length)}</p>
      {!!folders.length || !!filtered.length ? <div className="organization-items">
        <div className="organization-list-head knowledge-list-head" role="group" aria-label={uiText("Sort entities")}>
          <span aria-hidden="true"/>
          <button className={sort.startsWith('title-') ? 'is-sorted' : ''} onClick={() => setSort(sort === 'title-asc' ? 'title-desc' : 'title-asc')} aria-label={uiText("Sort by name, {value0}",{value0: sort === 'title-asc' ? 'Z to A' : 'A to Z'})}>{uiText("Name")}{sort.startsWith('title-') && <span className={'sort-direction ' + (sort === 'title-asc' ? 'ascending' : '')}><Icon name="chevron"/></span>}</button>
          <button className={sort.startsWith('modified-') ? 'is-sorted' : ''} onClick={() => setSort(sort === 'modified-desc' ? 'modified-asc' : 'modified-desc')} aria-label={uiText("Sort by last modified, {value0}",{value0: sort === 'modified-desc' ? 'oldest first' : 'newest first'})}>{uiText("Last modified")}{sort.startsWith('modified-') && <span className={'sort-direction ' + (sort === 'modified-asc' ? 'ascending' : '')}><Icon name="chevron"/></span>}</button>
          <span aria-hidden="true"/>
        </div>
        {folders.map(folder => <article className="organization-item" key={folder.id} data-library-row={'entity-type:' + folder.type}><div className="organization-item-row organization-page-row knowledge-entity-row">
          {viewMode==='grid' && <PageCover vaultId={vaultId} icon="folder"/>}
          <span className="organization-item-icon"><Icon name="folder"/></span>
          <button className="organization-item-name" data-library-focus onClick={() => navigate(folder.type)} aria-label={uiText("Open {value0}: {value1}",{value0: folder.name,value1: countLabel(folder.count)})}><span className="organization-page-title">{folder.name}<span className="knowledge-row-detail">{countLabel(folder.count)}</span></span><small aria-hidden="true">—</small></button>
          <Icon name="chevron"/>
        </div></article>)}
        {filtered.map(entity => <article className="organization-item" key={entity.id} data-library-row={'entity:' + entity.id}><div className="organization-item-row organization-page-row knowledge-entity-row">
          {viewMode==='grid' && <PageCover vaultId={vaultId} icon={entityIconName(entity)}/>}
          <span className="organization-item-icon"><Icon name={entity.type} entity={entity}/></span>
          <button className="organization-item-name" data-library-focus title={entity.name} onClick={event => openMatch(entity.id,event.currentTarget)}>
            <span className="organization-page-title"><HighlightedText text={entity.name} query={search}/><span className="knowledge-row-detail">{[entityLabels[entity.type], ...(entity.type==='source'?(entity.archived_at?['Archived']:entity.sourceStatus==='queued'||entity.sourceStatus==='processing'?['Processing']:entity.inactive?['Inactive']:entity.sourceEnrichmentStatus==='pending'||entity.sourceEnrichmentStatus==='running'?['Processed · Enriching with AI']:entity.sourceEnrichmentStatus==='failed'?['Processed · AI enrichment failed']:['Processed']):[]), ...entity.subtypes.map(id => schema.subtypes.find(item => item.id === id)?.name).filter(Boolean)].join(' / ')}{viewMode!=='grid'&&entity.type==='source'&&typeof entity.sourceSize==='number'&&Number.isFinite(entity.sourceSize)&&entity.sourceSize>=0&&<> · {sourceFileSize(entity.sourceSize)}</>}</span></span>
            <small>{Number.isFinite(Date.parse(entity.updated_at)) ? <time dateTime={entity.updated_at} title={new Date(entity.updated_at).toLocaleString(getLocale())}>{new Date(entity.updated_at).toLocaleDateString(getLocale(), {month: 'short', day: 'numeric', year: 'numeric'})}</time> : uiText("Date unavailable")}{!!query && <span className="search-match-badge">{entity.name.toLowerCase().includes(query) ? uiText("Name") : passageFor(entity.id)?uiText("Source passage"):(entity.aliases??[]).some(alias=>alias.toLowerCase().includes(query))?uiText("Alias"):uiText("Related by meaning")}</span>}</small>
            {!!query&&passageFor(entity.id)&&<span className="search-result-snippet">{citationLocation(passageFor(entity.id)!)} · <HighlightedText text={textHits.get(entity.id)?.snippet??semanticHits.get(entity.id)?.snippet??''} query={search}/></span>}
            {!!query && !passageFor(entity.id)&&!entity.name.toLowerCase().includes(query)&&(entity.aliases??[]).some(alias=>alias.toLowerCase().includes(query)) && <span className="search-result-snippet knowledge-alias-match">{uiText("Alias:") + " "}<HighlightedText text={(entity.aliases ?? []).find(alias => alias.toLowerCase().includes(query)) ?? ''} query={search}/></span>}
            {entity.description && <span className="search-result-snippet knowledge-entity-description">{entity.description}</span>}
          </button>
          <div className="knowledge-row-actions">
          {entity.type==='source'&&!entity.archived_at&&<button type="button" className="knowledge-source-page" aria-label={uiText("Create page from source: ")+entity.name} title={entity.sourceStatus==='ready'&&!entity.inactive?uiText("Create page from source"):uiText("Available when source processing finishes successfully")} disabled={entity.sourceStatus!=='ready'||entity.inactive} onClick={()=>onCreatePageFromSource(entity)}><Icon name="sparkles"/></button>}
          <button type="button" className="knowledge-manage" title={entity.type==='source'?uiText("Manage source"):uiText("Manage entity")} aria-label={(entity.type==='source'?uiText("Manage source: "):uiText("Manage entity: "))+entity.name} aria-haspopup="dialog" onClick={()=>setManageSource(entity)}><Icon name="more"/></button>
          <button className="knowledge-open-entity" aria-label={uiText("Open ") + entity.name} onClick={() => onOpen(entity.id)}><Icon name="chevron"/></button>
          </div>
        </div></article>)}
      </div> : <div className="organization-empty" role="status"><span className="destination-icon"><Icon name={query ? 'search' : 'folder'}/></span><h2>{query ? uiText("No matching entities") : sourcesOnly?(archived?uiText("No archived sources"):uiText("No sources here yet")):uiText("No entities here yet")}</h2><p>{query ? uiText("Try another name, phrase, or idea.") : sourcesOnly?(archived?uiText("Archived sources will appear here. Restore them whenever you need them."):uiText("Import a source to get started.")):uiText("Create an entity to get started.")}</p>{query ? <button className="button" onClick={() => setSearch('')}>{uiText("Clear filter")}</button> : <button className="button" onClick={onCreate}>{sourcesOnly?uiText("New source"):uiText("New entity")}</button>}</div>}
    </div>
    {manageSource&&<SourceLifecycleDialog key={manageSource.id} vaultId={vaultId} source={manageSource} onUpdated={onUpdated} onClose={()=>setManageSource(null)}/>}
  </section>;
}
