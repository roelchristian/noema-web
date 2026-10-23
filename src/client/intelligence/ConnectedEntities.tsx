import {t as uiText} from '../i18n';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { blockSegments, entityLabels, entityTypes, type Entity, type EntityType, type Page } from '../../shared/domain';
import { Icon } from '../components/Icon';
import {noteDateItems, noteDateRanges} from '../../shared/note-dates';
import { ActionMenu } from '../components/ActionMenu';

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
    if (sort === 'mentions') return mentions.get(b.id)!.count - mentions.get(a.id)!.count || mentions.get(a.id)!.position - mentions.get(b.id)!.position;
    if (sort === 'updated') return b.updated_at.localeCompare(a.updated_at) || byName(a, b);
    return byName(a, b);
  });
}

export type ConnectedNoteType=EntityType|'date'|'all';
export function connectedNoteItems(page:Page,entities:Entity[],sort:ConnectedSort) {
  const items=[...connectedEntityItems(page,entities,'all','page-order').map(entity=>({...entity,count:0,position:0})),
    ...noteDateItems(page.blocks).map(item=>({...item,count:0,type:'date' as const,updated_at:''}))];
  const byId=new Map(items.map(item=>[item.id,item]));
  let position=0;
  for(const block of page.blocks) {
    const cells=block.type==='table'||block.type==='columns'?(block.rows??[]).flat():[block.content];
    for(const cell of cells) {
      let offset=0;
      const occurrences:{id:string;offset:number}[]=[];
      for(const segment of cell){if(segment.entityId)occurrences.push({id:segment.entityId,offset});offset+=(segment.text?.length??1);}
      if(!['code','math','divider','image'].includes(block.type)) {
        // Entity segments occupy no text in noteDateRanges, so compare by segment order below.
        let textOffset=0,entityOffset=0;
        const ranges=noteDateRanges(cell);
        for(const segment of cell) {
          for(const range of ranges.filter(range=>range.start>=textOffset&&range.start<textOffset+(segment.text?.length??0)))occurrences.push({id:range.date.id,offset:range.start+entityOffset});
          textOffset+=segment.text?.length??0;if(segment.entityId)entityOffset++;
        }
      }
      for(const occurrence of occurrences.sort((a,b)=>a.offset-b.offset)) {
        const item=byId.get(occurrence.id);if(!item)continue;
        if(!item.count)item.position=position;item.count++;
        position++;
      }
    }
  }
  const byName=(a:typeof items[number],b:typeof items[number])=>a.name.localeCompare(b.name,undefined,{sensitivity:'base',numeric:true})||a.id.localeCompare(b.id);
  return items.sort((a,b)=>sort==='name-desc'?-byName(a,b):sort==='name-asc'?byName(a,b):sort==='mentions'?b.count-a.count||a.position-b.position:sort==='updated'?b.updated_at.localeCompare(a.updated_at)||byName(a,b):a.position-b.position);
}

export function ConnectedEntities({page, entities, onOpenEntity, children}: {page: Page; entities: Entity[]; onOpenEntity: (id: string) => void; children?: ReactNode}) {
  const [type, setType] = useState<ConnectedNoteType>('all');
  const [sort, setSort] = useState<ConnectedSort>('mentions');
  const id = useId();
  const connected = useMemo(() => connectedNoteItems(page, entities, sort), [page.blocks, page.vault_id, entities, sort]);
  const visible = connected.filter(entity => type === 'all' || entity.type === type);
  const paginationKey = JSON.stringify([page.vault_id, page.id, type, sort]);
  const [pagination, setPagination] = useState({key: paginationKey, index: 0});
  const pageSize = 5;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const pageIndex = pagination.key === paginationKey ? Math.min(pagination.index, pageCount - 1) : 0;
  if (pagination.key !== paginationKey || pagination.index !== pageIndex) setPagination({key: paginationKey, index: pageIndex});
  const pageStart = pageIndex * pageSize;
  const paginated = visible.slice(pageStart, pageStart + pageSize);
  const tabs:readonly ConnectedNoteType[]=['all',...[...entityTypes,'date' as const].filter(item=>item===type||connected.some(entity=>entity.type===item))];
  function navigate(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(type);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setType(tabs[next]!);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
  return <section className="knowledge-connected" aria-labelledby={id + '-heading'}>
    <div className="knowledge-section-heading"><h2 id={id + '-heading'}><Icon name="knowledge"/>{uiText("Entities")}<span className="knowledge-count">{connected.length}</span></h2></div>
    {children}
    {!!connected.length&&<div className="knowledge-entity-controls">
      <div className="knowledge-entity-tabs" role="tablist" aria-label={uiText("Connected entity types")}>
        {tabs.map(tab => {
          const label = tab === 'all' ? uiText('All') : tab==='date'?uiText('Date'):uiText(entityLabels[tab]);
          const count = tab === 'all' ? connected.length : connected.filter(entity => entity.type === tab).length;
          return <button key={tab} id={id + '-' + tab} type="button" role="tab" aria-label={`${label} (${count})`} title={`${label} (${count})`} aria-selected={type === tab} aria-controls={id + '-list'} tabIndex={type === tab ? 0 : -1} onKeyDown={navigate} onClick={() => setType(tab)}><Icon name={tab === 'all' ? 'knowledge' : tab==='date'?'event':tab}/></button>;
        })}
      </div>
      <div className="knowledge-entity-sort"><ActionMenu icon="sort" label={uiText("Sort connected entities")+" · "+uiText(sort==='mentions'?'Most mentions':sort==='page-order'?'First appearance':'Name')} actions={[
        {label:uiText("Most mentions"),description:uiText("Most frequent in this page, then first appearance"),checked:sort==='mentions',onSelect:()=>setSort('mentions')},
        {label:uiText("First appearance"),description:uiText("Follow the order entities appear in this page"),checked:sort==='page-order',onSelect:()=>setSort('page-order')},
        {label:uiText("Name"),description:uiText("Sort by entity name"),checked:sort==='name-asc',onSelect:()=>setSort('name-asc')},
      ]}/></div>
    </div>}
    <div id={id + '-list'} role="tabpanel" aria-labelledby={id + '-' + type}>
      {visible.length ? <ul className="knowledge-connected-list">{paginated.map(entity => <li key={entity.id}><button type="button" data-entity={entity.type==='date'?undefined:entity.id} data-note-date={entity.type==='date'?entity.id:undefined} data-entity-preview="" onClick={() => {if(entity.type!=='date')onOpenEntity(entity.id);}}><Icon name={entity.type==='date'?'event':entity.type} entity={entity.type==='date'?undefined:entity}/><span>{entity.name}</span></button></li>)}</ul> : !!connected.length&&<p className="section-hint">{uiText("No entities of this type")}</p>}
      {pageCount > 1 && <nav className="knowledge-entity-pagination" aria-label={uiText("Connected entities pagination")}>
        <span role="status" aria-live="polite" aria-atomic="true">{pageStart + 1}–{Math.min(pageStart + pageSize, visible.length)}{" " + uiText("of") + " "}{visible.length}</span>
        <button type="button" className="pagination-previous" aria-label={uiText("Previous connected entities")} title={uiText("Previous page")} aria-controls={id + '-list'} disabled={pageIndex === 0} onClick={() => setPagination({key: paginationKey, index: pageIndex - 1})}><Icon name="chevron"/></button>
        <button type="button" aria-label={uiText("Next connected entities")} title={uiText("Next page")} aria-controls={id + '-list'} disabled={pageIndex === pageCount - 1} onClick={() => setPagination({key: paginationKey, index: pageIndex + 1})}><Icon name="chevron"/></button>
      </nav>}
    </div>
  </section>;
}
