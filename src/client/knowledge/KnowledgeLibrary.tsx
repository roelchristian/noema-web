import { useState } from 'react';
import { entityLabels, entityTypes, type Entity, type EntityType } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { HighlightedText } from '../search/HighlightedText';
import { useEntitySchema } from './useEntitySchema';

export function KnowledgeLibrary({vaultId, entities, onOpen, onCreate}: {vaultId: string; entities: Entity[]; onOpen: (id: string) => void; onCreate: () => void}) {
  const {schema, error} = useEntitySchema(vaultId);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('folders');
  const [type, setType] = useState<EntityType | ''>('');
  const [sort, setSort] = useState('modified-desc');
  const query = search.trim().toLowerCase();
  const scoped = entities.filter(entity => !type || entity.type === type);
  const matches = scoped.filter(entity => [entity.name, ...(entity.aliases ?? [])].some(name => name.toLowerCase().includes(query)));
  const filtered = view === 'all' || !!query || !!type ? matches : [];
  const titleOrder = (a: string, b: string) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}) * (sort === 'title-desc' ? -1 : 1);
  filtered.sort((a, b) => {
    if (sort.startsWith('title-')) return titleOrder(a.name, b.name);
    const aDate = Date.parse(a.updated_at), bDate = Date.parse(b.updated_at);
    const aValid = Number.isFinite(aDate), bValid = Number.isFinite(bDate);
    if (!aValid || !bValid) return Number(bValid) - Number(aValid) || titleOrder(a.name, b.name);
    return (sort === 'modified-asc' ? aDate - bDate : bDate - aDate) || titleOrder(a.name, b.name);
  });
  const countLabel = (count: number) => `${count} ${count === 1 ? 'entity' : 'entities'}`;
  const folders = view === 'folders' && !query && !type
    ? entityTypes.map(item => ({id: item, name: entityLabels[item], count: entities.filter(entity => entity.type === item).length, type: item})) : [];
  folders.sort((a, b) => titleOrder(a.name, b.name));
  function navigate(nextType: EntityType | '' = '') {
    setType(nextType);
    setSearch('');
  }
  return <section className="organization-library organization-browser knowledge-library">
    <div className="organization-heading pages-home-heading"><div><h1 className="page-heading">Knowledge entities</h1></div><div className="pages-home-actions">
      <label className="organization-search-box"><Icon name="search"/><input aria-label="Search entities" placeholder="Search entities…" value={search} onChange={event => setSearch(event.target.value)}/>{search && <button aria-label="Clear search" onClick={() => setSearch('')}><Icon name="close"/></button>}</label>
      <button className="button primary" onClick={onCreate}><Icon name="plus"/>New entity</button>
    </div></div>
    {error && <p role="alert">{error}</p>}
    <div className="organization-content">
      <div className="organization-section-title knowledge-browser-controls">
        <nav className="knowledge-breadcrumbs" aria-label="Entity groups">
          <button onClick={() => navigate()} aria-current={!type ? 'page' : undefined}>Knowledge entities</button>
          {type && <><Icon name="chevron"/><span aria-current="page">{entityLabels[type]}</span></>}
        </nav>
        <Select aria-label="Entity grouping" value={view} onChange={event => { setView(event.target.value); navigate(); }}><option value="folders">Browse by type</option><option value="all">Show all</option></Select>
      </div>
      <p className="organization-hint" role="status">{query ? `${countLabel(matches.length)} found` : countLabel(scoped.length)}</p>
      {!!folders.length || !!filtered.length ? <div className="organization-items">
        <div className="organization-list-head knowledge-list-head" role="group" aria-label="Sort entities">
          <span aria-hidden="true"/>
          <button className={sort.startsWith('title-') ? 'is-sorted' : ''} onClick={() => setSort(sort === 'title-asc' ? 'title-desc' : 'title-asc')} aria-label={`Sort by name, ${sort === 'title-asc' ? 'Z to A' : 'A to Z'}`}>Name{sort.startsWith('title-') && <span className={'sort-direction ' + (sort === 'title-asc' ? 'ascending' : '')}><Icon name="chevron"/></span>}</button>
          <button className={sort.startsWith('modified-') ? 'is-sorted' : ''} onClick={() => setSort(sort === 'modified-desc' ? 'modified-asc' : 'modified-desc')} aria-label={`Sort by last modified, ${sort === 'modified-desc' ? 'oldest first' : 'newest first'}`}>Last modified{sort.startsWith('modified-') && <span className={'sort-direction ' + (sort === 'modified-asc' ? 'ascending' : '')}><Icon name="chevron"/></span>}</button>
          <span aria-hidden="true"/>
        </div>
        {folders.map(folder => <article className="organization-item" key={folder.id}><div className="organization-item-row organization-page-row knowledge-entity-row">
          <span className="organization-item-icon"><Icon name="folder"/></span>
          <button className="organization-item-name" onClick={() => navigate(folder.type)} aria-label={`Open ${folder.name}: ${countLabel(folder.count)}`}><span className="organization-page-title">{folder.name}<span className="knowledge-row-detail">{countLabel(folder.count)}</span></span><small aria-hidden="true">—</small></button>
          <Icon name="chevron"/>
        </div></article>)}
        {filtered.map(entity => <article className="organization-item" key={entity.id}><div className="organization-item-row organization-page-row knowledge-entity-row">
          <span className="organization-item-icon"><Icon name={entity.type}/></span>
          <button className="organization-item-name" onClick={() => onOpen(entity.id)}>
            <span className="organization-page-title"><HighlightedText text={entity.name} query={search}/><span className="knowledge-row-detail">{[entityLabels[entity.type], ...entity.subtypes.map(id => schema.subtypes.find(item => item.id === id)?.name).filter(Boolean)].join(' / ')}</span></span>
            <small>{Number.isFinite(Date.parse(entity.updated_at)) ? <time dateTime={entity.updated_at} title={new Date(entity.updated_at).toLocaleString()}>{new Date(entity.updated_at).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}</time> : 'Date unavailable'}</small>
            {entity.description && <span className="search-result-snippet knowledge-entity-description">{entity.description}</span>}
          </button>
          <button className="knowledge-open-entity" aria-label={'Open ' + entity.name} onClick={() => onOpen(entity.id)}><Icon name="chevron"/></button>
        </div></article>)}
      </div> : <div className="organization-empty" role="status"><span className="destination-icon"><Icon name={query ? 'search' : 'folder'}/></span><h2>{query ? 'No matching entities' : 'No entities here yet'}</h2><p>{query ? 'Try another name or alias.' : 'Create an entity to get started.'}</p>{query ? <button className="button" onClick={() => setSearch('')}>Clear search</button> : <button className="button" onClick={onCreate}>New entity</button>}</div>}
    </div>
  </section>;
}
