import { PageIcon } from '../components/PageIcon';
import type { Entity, PageSummary, RecentItem } from '../../shared/domain';
import { Icon } from '../components/Icon';

export function RecentLibrary({recent, pages, entities, onOpenPage, onOpenEntity}: {
  recent: RecentItem[]; pages: PageSummary[]; entities: Entity[];
  onOpenPage: (id: string) => void; onOpenEntity: (id: string) => void;
}) {
  const items = recent.flatMap(item => {
    const record = item.kind === 'page' ? pages.find(page => page.id === item.item_id) : entities.find(entity => entity.id === item.item_id);
    return record ? [{...item, icon: 'title' in record ? record.icon : null, name: 'title' in record ? record.title || 'Untitled' : record.name}] : [];
  });
  return <section className="organization-library"><div className="organization-heading"><div><p className="eyebrow">QUICK ACCESS</p><h1>Recent items</h1><p>Pick up where you left off.</p></div></div>
    <div className="organization-items">{items.map(item => <article key={item.kind + item.item_id} className="organization-item"><div className="organization-item-row">{item.kind === 'page' ? <PageIcon icon={item.icon}/> : <Icon name="knowledge"/>}<button className="organization-item-name" onClick={() => item.kind === 'page' ? onOpenPage(item.item_id) : onOpenEntity(item.item_id)}>{item.name}<small>{item.kind === 'page' ? 'Page' : 'Knowledge entity'}</small></button><time className="recent-time" dateTime={item.opened_at}>{new Date(item.opened_at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</time></div></article>)}{!items.length && <div className="organization-empty"><Icon name="recent"/><h2>Your next starting point</h2><p>Pages and entities you open will appear here.</p></div>}</div>
  </section>;
}
