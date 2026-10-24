import {entityIconName} from '../../shared/entity-icons';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {TitleText} from '../components/TitleText';
import {PageIcon} from '../components/PageIcon';
import {useLibraryQuickPreview} from '../components/LibraryQuickPreview';
import {LibraryToolbar} from '../components/LibraryToolbar';
import {useLibraryViewState} from '../state/library-view-state';
import {useLibraryDensity} from '../components/LibraryDensitySwitch';
import {entityLabels, type Entity, type PageSummary, type RecentItem, type Organization} from '../../shared/domain';
import {Icon} from '../components/Icon';
export function RecentLibrary({vaultId, recent, pages, entities, organization, onOpenPage, onOpenEntity}: {
  organization?:Organization; vaultId: string; recent: RecentItem[]; pages: PageSummary[]; entities: Entity[];
  onOpenPage: (id: string) => void; onOpenEntity: (id: string) => void;
}) {
  const [density, setDensity, libraryRef] = useLibraryDensity(JSON.stringify([vaultId,'recent']), 'recent');
  const [viewState,setViewState] = useLibraryViewState(vaultId,'recent');
  const items = recent.flatMap(item => {
    const record = item.kind === 'page' ? pages.find(page => page.id === item.item_id) : entities.find(entity => entity.id === item.item_id);
    return record ? [{...item, icon: 'title' in record ? record.icon : null, entityIcon:'type' in record?entityIconName(record):undefined, featuredImageId:'title' in record?record.featuredImageId:null, name: 'title' in record ? record.title || 'Untitled' : record.name, type: 'type' in record ? record.type : null, description: 'description' in record ? record.description : '', updatedAt: record.updated_at}] : [];
  });
  const visible = items.filter(item=>item.name.toLowerCase().includes(viewState.query.toLowerCase())).sort((a,b)=>viewState.sort.startsWith('title-')?a.name.localeCompare(b.name)*(viewState.sort==='title-desc'?-1:1):(Date.parse(a.opened_at)-Date.parse(b.opened_at))*(viewState.sort==='modified-asc'?1:-1));
  const {quickPreview}=useLibraryQuickPreview(libraryRef,{vaultId,pages,entities,organization,items:visible.map(item=>({kind:item.kind,id:item.item_id,name:item.name,updatedAt:item.updatedAt})),onOpen:item=>item.kind==='page'?onOpenPage(item.id):onOpenEntity(item.id)});
  return <section ref={libraryRef} className="organization-library recent-library" data-layout="list" data-density={density} data-library-vault={vaultId} data-library-destination="recent">
    <div className="organization-heading"><div className="library-heading-row"><h1 className="page-heading">{uiText("Recent items")}</h1></div><div className="library-heading-actions"><LibraryToolbar dateLabel="Last opened" sort={viewState.sort} onSort={sort=>setViewState({sort})} density={density} onDensity={setDensity} filter={<input type="search" aria-label="Filter Recent items" placeholder="Filter Recent items…" value={viewState.query} onChange={event=>setViewState({query:event.target.value})}/>}/></div></div>
    <div className="organization-items">{visible.map(item => <article key={item.kind + item.item_id} className="organization-item" data-library-row={item.kind+':'+item.item_id}><div className="organization-item-row">
      <span className="organization-item-icon">{item.kind === 'page' ? <PageIcon icon={item.icon}/> : <Icon name={item.entityIcon ?? 'knowledge'}/>}</span>
      <button data-library-focus className="organization-item-name" title={item.name} onClick={() => item.kind === 'page' ? onOpenPage(item.item_id) : onOpenEntity(item.item_id)}><span className="organization-page-title">{item.kind==='page'?<TitleText text={item.name}/>:item.name}</span><small>{item.type ? uiText(entityLabels[item.type]) : uiText("Page")}</small></button>
      <time className="recent-time" dateTime={item.opened_at}>{new Date(item.opened_at).toLocaleDateString(getLocale(), {month: 'short', day: 'numeric'})}</time>
    </div></article>)}{!items.length && <div className="organization-empty"><Icon name="recent"/><h2>{uiText("Your next starting point")}</h2><p>{uiText("Pages and entities you open will appear here.")}</p></div>}</div>
    {quickPreview}
  </section>;
}
