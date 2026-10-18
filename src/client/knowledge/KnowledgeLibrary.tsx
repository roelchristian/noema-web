import {useTextSearch} from '../search/useTextSearch';
import {useSemanticSearch} from '../search/useSemanticSearch';
import {combinedMatches} from '../search/matches';
import {citationLocation} from '../../shared/citations';
import type {SourceReference} from '../../shared/domain';
import {PageCover} from '../components/PageCover';
import {ViewModeSwitch, useViewMode} from '../components/ViewModeSwitch';
import { entityLabels, entityTypes, type Entity, type EntityType } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { HighlightedText } from '../search/HighlightedText';
import { useEntitySchema } from './useEntitySchema';
import { useLibraryViewState } from '../state/library-view-state';
import { captureLibraryView } from '../state/use-library-scroll';

export function KnowledgeLibrary({vaultId, entities, onOpen, onOpenPassage, onCreate, onCreatePageFromSource}: {vaultId: string; entities: Entity[]; onOpen: (id: string) => void; onOpenPassage:(reference:SourceReference,trigger?:HTMLElement)=>void; onCreate: () => void; onCreatePageFromSource:(source:Entity)=>void}) {
  const [browser, setBrowser] = useLibraryViewState(vaultId, 'knowledge');
  const view = browser.grouping === 'all' ? 'all' : 'folders';
  const type: EntityType | '' = entityTypes.includes(browser.entityType as EntityType) ? browser.entityType as EntityType : '';
  const sourcesOnly = type === 'source';
  const destination = JSON.stringify(['knowledge', type]);
  const [viewState, setViewState] = useLibraryViewState(vaultId, destination);
  const [viewMode, setViewMode, libraryRef] = useViewMode(JSON.stringify([vaultId, destination]), 'knowledge');
  const {schema, error} = useEntitySchema(vaultId);
  const search = viewState.query, sort = viewState.sort;
  const setSearch = (query: string) => setViewState({query});
  const setSort = (sort: string) => setViewState({sort});
  const filterScope = type ? `${entityLabels[type]} entities` : 'All knowledge entities';
  const query = search.trim().toLowerCase();
  const scoped = entities.filter(entity => sourcesOnly ? entity.type === 'source' : entity.type !== 'source' && (!type || entity.type === type));
  const textSearch=useTextSearch(vaultId,search,scoped.map(entity=>entity.id+':'+entity.updated_at+':'+entity.sourceStatus).join(','),{pageIds:[],entityIds:scoped.map(entity=>entity.id)},10000);
  const semantic=useSemanticSearch(vaultId,search,{enabled:!!query&&!textSearch.loading});
  const textHits=new Map(textSearch.results.map(hit=>[hit.id,hit]));
  const semanticHits=new Map(semantic.results.filter(hit=>hit.kind==='entity').map(hit=>[hit.id,hit]));
  const matches=combinedMatches(scoped.map(entity=>({...entity,kind:'entity' as const})),search,semantic.results,textSearch.results);
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
    <div className="organization-heading pages-home-heading"><div className="library-heading-row"><h1 className="page-heading">{sourcesOnly?'Sources':'Knowledge entities'}</h1></div><div className="pages-home-actions library-heading-actions"><div className="library-view-filter"><div className="library-view-filter-input"><Icon name="search"/><input type="search" placeholder="Filter this view…" aria-label={`Filter ${filterScope} by name, alias, or source text`} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {if (event.key === 'Escape' && search) {event.preventDefault(); setSearch('');}}}/>{search && <button type="button" aria-label="Clear entity filter" onClick={() => setSearch('')}><Icon name="close"/></button>}</div></div><ViewModeSwitch value={viewMode} onChange={setViewMode}/>
      <button className="button primary" onClick={onCreate}><Icon name="plus"/>{sourcesOnly?'New source':'New entity'}</button>
    </div></div>
    {error && <p role="alert">{error}</p>}{textSearch.error&&<p role="status">Source text search unavailable. Name matches remain available.</p>}{(textSearch.loading||semantic.loading)&&<p role="status">Searching source passages…</p>}
    <div className="organization-content">
      <div className="organization-section-title knowledge-browser-controls" hidden={sourcesOnly}>
        <Select aria-label="Entity grouping" value={view} onChange={event => {captureLibraryView(); setBrowser({grouping: event.target.value, entityType: ''});}}><option value="folders">Browse by type</option><option value="all">Show all</option></Select>
      </div>
      <p className="organization-hint" role="status">{query ? `${countLabel(matches.length)} found` : countLabel(scoped.length)}</p>
      {!!folders.length || !!filtered.length ? <div className="organization-items">
        <div className="organization-list-head knowledge-list-head" role="group" aria-label="Sort entities">
          <span aria-hidden="true"/>
          <button className={sort.startsWith('title-') ? 'is-sorted' : ''} onClick={() => setSort(sort === 'title-asc' ? 'title-desc' : 'title-asc')} aria-label={`Sort by name, ${sort === 'title-asc' ? 'Z to A' : 'A to Z'}`}>Name{sort.startsWith('title-') && <span className={'sort-direction ' + (sort === 'title-asc' ? 'ascending' : '')}><Icon name="chevron"/></span>}</button>
          <button className={sort.startsWith('modified-') ? 'is-sorted' : ''} onClick={() => setSort(sort === 'modified-desc' ? 'modified-asc' : 'modified-desc')} aria-label={`Sort by last modified, ${sort === 'modified-desc' ? 'oldest first' : 'newest first'}`}>Last modified{sort.startsWith('modified-') && <span className={'sort-direction ' + (sort === 'modified-asc' ? 'ascending' : '')}><Icon name="chevron"/></span>}</button>
          <span aria-hidden="true"/>
        </div>
        {folders.map(folder => <article className="organization-item" key={folder.id} data-library-row={'entity-type:' + folder.type}><div className="organization-item-row organization-page-row knowledge-entity-row">
          {viewMode==='grid' && <PageCover vaultId={vaultId} icon="folder"/>}
          <span className="organization-item-icon"><Icon name="folder"/></span>
          <button className="organization-item-name" data-library-focus onClick={() => navigate(folder.type)} aria-label={`Open ${folder.name}: ${countLabel(folder.count)}`}><span className="organization-page-title">{folder.name}<span className="knowledge-row-detail">{countLabel(folder.count)}</span></span><small aria-hidden="true">—</small></button>
          <Icon name="chevron"/>
        </div></article>)}
        {filtered.map(entity => <article className="organization-item" key={entity.id} data-library-row={'entity:' + entity.id}><div className="organization-item-row organization-page-row knowledge-entity-row">
          {viewMode==='grid' && <PageCover vaultId={vaultId} icon={entity.type}/>}
          <span className="organization-item-icon"><Icon name={entity.type}/></span>
          <button className="organization-item-name" data-library-focus title={entity.name} onClick={event => openMatch(entity.id,event.currentTarget)}>
            <span className="organization-page-title"><HighlightedText text={entity.name} query={search}/><span className="knowledge-row-detail">{[entityLabels[entity.type], ...(entity.type==='source'?(entity.sourceStatus==='queued'||entity.sourceStatus==='processing'?['Processing']:entity.inactive?['Inactive']:entity.sourceEnrichmentStatus==='pending'||entity.sourceEnrichmentStatus==='running'?['Processed · Enriching with AI']:entity.sourceEnrichmentStatus==='failed'?['Processed · AI enrichment failed']:['Processed']):[]), ...entity.subtypes.map(id => schema.subtypes.find(item => item.id === id)?.name).filter(Boolean)].join(' / ')}</span></span>
            <small>{Number.isFinite(Date.parse(entity.updated_at)) ? <time dateTime={entity.updated_at} title={new Date(entity.updated_at).toLocaleString()}>{new Date(entity.updated_at).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}</time> : 'Date unavailable'}{!!query && <span className="search-match-badge">{entity.name.toLowerCase().includes(query) ? 'Name' : passageFor(entity.id)?'Source passage':(entity.aliases??[]).some(alias=>alias.toLowerCase().includes(query))?'Alias':'Related by meaning'}</span>}</small>
            {!!query&&passageFor(entity.id)&&<span className="search-result-snippet">{citationLocation(passageFor(entity.id)!)} · <HighlightedText text={textHits.get(entity.id)?.snippet??semanticHits.get(entity.id)?.snippet??''} query={search}/></span>}
            {!!query && !passageFor(entity.id)&&!entity.name.toLowerCase().includes(query)&&(entity.aliases??[]).some(alias=>alias.toLowerCase().includes(query)) && <span className="search-result-snippet knowledge-alias-match">Alias: <HighlightedText text={(entity.aliases ?? []).find(alias => alias.toLowerCase().includes(query)) ?? ''} query={search}/></span>}
            {entity.description && <span className="search-result-snippet knowledge-entity-description">{entity.description}</span>}
          </button>
          {entity.type==='source'&&<button type="button" className="knowledge-source-page" aria-label={'Create page from source: '+entity.name} title={entity.sourceStatus==='ready'&&!entity.inactive?'Create page from source':'Available when source processing finishes successfully'} disabled={entity.sourceStatus!=='ready'||entity.inactive} onClick={()=>onCreatePageFromSource(entity)}><Icon name="sparkles"/></button>}
          <button className="knowledge-open-entity" aria-label={'Open ' + entity.name} onClick={() => onOpen(entity.id)}><Icon name="chevron"/></button>
        </div></article>)}
      </div> : <div className="organization-empty" role="status"><span className="destination-icon"><Icon name={query ? 'search' : 'folder'}/></span><h2>{query ? 'No matching entities' : sourcesOnly?'No sources here yet':'No entities here yet'}</h2><p>{query ? 'Try another name, phrase, or idea.' : sourcesOnly?'Import a source to get started.':'Create an entity to get started.'}</p>{query ? <button className="button" onClick={() => setSearch('')}>Clear filter</button> : <button className="button" onClick={onCreate}>{sourcesOnly?'New source':'New entity'}</button>}</div>}
    </div>
  </section>;
}
