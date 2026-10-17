import {PageCover} from '../components/PageCover';
import {PageIcon} from '../components/PageIcon';
import {ViewModeSwitch, useViewMode} from '../components/ViewModeSwitch';
import {useSearchSnippets} from '../search/useSearchSnippets';
import {entityLabels, type Entity, type PageSummary, type RecentItem} from '../../shared/domain';
import {Icon} from '../components/Icon';

export function RecentLibrary({vaultId, recent, pages, entities, onOpenPage, onOpenEntity}: {
  vaultId: string; recent: RecentItem[]; pages: PageSummary[]; entities: Entity[];
  onOpenPage: (id: string) => void; onOpenEntity: (id: string) => void;
}) {
  const [viewMode, setViewMode] = useViewMode('recent');
  const items = recent.flatMap(item => {
    const record = item.kind === 'page' ? pages.find(page => page.id === item.item_id) : entities.find(entity => entity.id === item.item_id);
    return record ? [{...item, icon: 'title' in record ? record.icon : null, featuredImageId:'title' in record?record.featuredImageId:null, name: 'title' in record ? record.title || 'Untitled' : record.name, type: 'type' in record ? record.type : null, description: 'description' in record ? record.description : '', updatedAt: record.updated_at}] : [];
  });
  const previews = useSearchSnippets(vaultId, '', viewMode === 'grid' ? items.filter(item => item.kind === 'page').map(item => item.item_id) : [], viewMode === 'grid', items.map(item => item.item_id + ':' + item.updatedAt).sort().join(','));
  return <section className="organization-library recent-library" data-layout={viewMode}>
    <div className="organization-heading"><div className="library-heading-row"><h1 className="page-heading">Recent items</h1></div><div className="library-heading-actions"><ViewModeSwitch value={viewMode} onChange={setViewMode}/></div></div>
    <div className="organization-items">{items.map(item => <article key={item.kind + item.item_id} className="organization-item"><div className="organization-item-row">
      {viewMode==='grid' && <PageCover vaultId={vaultId} imageId={item.featuredImageId} icon={item.type ?? 'page'}/>}
      <span className="organization-item-icon">{item.kind === 'page' ? <PageIcon icon={item.icon}/> : <Icon name={item.type ?? 'knowledge'}/>}</span>
      <button className="organization-item-name" title={item.name} onClick={() => item.kind === 'page' ? onOpenPage(item.item_id) : onOpenEntity(item.item_id)}><span className="organization-page-title">{item.name}</span><small>{item.type ? entityLabels[item.type] : 'Page'}</small>{viewMode === 'grid' && (item.description || previews.snippets[item.item_id]) && <span className="search-result-snippet item-preview">{item.description || previews.snippets[item.item_id]}</span>}</button>
      <time className="recent-time" dateTime={item.opened_at}>{new Date(item.opened_at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</time>
    </div></article>)}{!items.length && <div className="organization-empty"><Icon name="recent"/><h2>Your next starting point</h2><p>Pages and entities you open will appear here.</p></div>}</div>
  </section>;
}
