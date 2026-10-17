import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { blockSegments, entityLabels, entityTypes, type Entity, type EntityType, type Page } from '../../shared/domain';
import { Icon } from '../components/Icon';

export type ConnectedSort = 'name-asc' | 'name-desc' | 'page-order' | 'mentions' | 'updated';
export function connectedEntityItems(page: Page, entities: Entity[], type: EntityType | 'all', sort: ConnectedSort) {
  const mentions = new Map<string, {count: number; position: number}>();
  for (const block of page.blocks) for (const segment of blockSegments(block)) {
    if (!segment.entityId) continue;
    const item = mentions.get(segment.entityId);
    if (item) item.count++;
    else mentions.set(segment.entityId, {count: 1, position: mentions.size});
  }
  const items = entities.filter(entity => entity.vault_id === page.vault_id && mentions.has(entity.id) && (type === 'all' || entity.type === type));
  const byName = (a: Entity, b: Entity) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base', numeric: true}) || a.id.localeCompare(b.id);
  return items.sort((a, b) => {
    if (sort === 'name-desc') return -byName(a, b);
    if (sort === 'page-order') return mentions.get(a.id)!.position - mentions.get(b.id)!.position;
    if (sort === 'mentions') return mentions.get(b.id)!.count - mentions.get(a.id)!.count || byName(a, b);
    if (sort === 'updated') return b.updated_at.localeCompare(a.updated_at) || byName(a, b);
    return byName(a, b);
  });
}

export function ConnectedEntities({page, entities, onOpenEntity}: {page: Page; entities: Entity[]; onOpenEntity: (id: string) => void}) {
  const [type, setType] = useState<EntityType | 'all'>('all');
  const [sort, setSort] = useState<'name-asc' | 'name-desc'>('name-asc');
  const id = useId();
  const connected = useMemo(() => connectedEntityItems(page, entities, 'all', sort), [page.blocks, page.vault_id, entities, sort]);
  const visible = connected.filter(entity => type === 'all' || entity.type === type);
  const tabs = ['all', ...entityTypes] as const;
  function navigate(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(type);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setType(tabs[next]!);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  return <section className="knowledge-connected" aria-labelledby={id + '-heading'}>
    <div className="knowledge-section-heading"><h2 id={id + '-heading'}>Connected entities</h2><span className="knowledge-count">{connected.length}</span></div>
    <div className="knowledge-entity-controls">
      <div className="knowledge-entity-tabs" role="tablist" aria-label="Connected entity types">
        {tabs.map(tab => {
          const label = tab === 'all' ? 'All' : entityLabels[tab];
          const count = tab === 'all' ? connected.length : connected.filter(entity => entity.type === tab).length;
          return <button key={tab} id={id + '-' + tab} type="button" role="tab" aria-label={`${label} (${count})`} title={`${label} (${count})`} aria-selected={type === tab} aria-controls={id + '-list'} tabIndex={type === tab ? 0 : -1} onKeyDown={navigate} onClick={() => setType(tab)}><Icon name={tab === 'all' ? 'knowledge' : tab}/></button>;
        })}
      </div>
      <button type="button" className="knowledge-entity-sort" aria-label="Sort connected entities in reverse alphabetical order" aria-pressed={sort === 'name-desc'} title={sort === 'name-asc' ? 'Sorted A–Z · Switch to Z–A' : 'Sorted Z–A · Switch to A–Z'} onClick={() => setSort(current => current === 'name-asc' ? 'name-desc' : 'name-asc')}>
        <span aria-hidden="true">{sort === 'name-asc' ? 'A' : 'Z'}<span>→</span>{sort === 'name-asc' ? 'Z' : 'A'}</span>
      </button>
    </div>
    <div id={id + '-list'} role="tabpanel" aria-labelledby={id + '-' + type}>
      {visible.length ? <ul className="knowledge-connected-list">{visible.map(entity => <li key={entity.id}><button type="button" onClick={() => onOpenEntity(entity.id)}><Icon name={entity.type}/><span>{entity.name}</span></button></li>)}</ul> : <p className="section-hint">{!connected.length ? 'Mention an entity with @ to connect it here.' : 'No connected entities of this type.'}</p>}
    </div>
  </section>;
}
