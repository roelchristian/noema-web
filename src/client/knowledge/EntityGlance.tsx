import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {Entity, EntityDetail, SourceReference} from '../../shared/domain';
import {sourcePreviewRank} from '../../shared/entity-evidence';
import type {EntityEvidence} from '../../shared/entity-evidence';
import type {EntityMentionReference} from '../../shared/entity-mentions';
import {citationLocation} from '../../shared/citations';
import {api} from '../api';
import {t as uiText} from '../i18n';
import {EntityConnections, type EntityConnection} from './EntityDetails';

export const previewText = (text: string, limit = 260) => text.length > limit ? Array.from(text).slice(0, limit).join('').trimEnd() + '…' : text;
/** The association's created_at is its original attachment time, never page.updated_at. */
export function glancePages(entity: EntityDetail) {
  const linked = [...new Map((entity.linkedPages ?? []).map(page => [page.id, page])).values()];
  return linked.sort((a,b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)).slice(0,3);
}
export function glanceConnections(items: EntityConnection[], entities: Entity[]) {
  const known = new Map(entities.map(entity => [entity.id, entity]));
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.target) || !known.has(item.target)) return false;
    seen.add(item.target); return true;
  }).slice(0,4).map(item=>({...item,label:item.label+(known.get(item.target)?.archived_at ? ' · Archived' : '')}));
}
export function EntityGlance({entity, entities, connections, onOpen, onOpenPage, onOpenMention, onTab}: {
  entity: EntityDetail; entities: Entity[]; connections: EntityConnection[]; onOpen: (id:string)=>void;
  onOpenPage:(id:string)=>void; onOpenMention?:(reference:EntityMentionReference)=>void; onTab:(tab:'connections'|'mentions')=>void;
}) {
  const linked = glancePages(entity);
  const mentions = [...new Map((entity.pageMentions ?? []).map(page=>[page.id,page])).values()].sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id)).slice(0,2);
  return <div className="eh-glance-context">
    <section className="eh-section eh-glance-connections"><h2>{uiText('Connected entities')}</h2>
      <EntityConnections items={glanceConnections(connections,entities)} entities={entities} onOpen={onOpen} empty={uiText('No accessible connected entities recorded yet.')}/>
      <button type="button" className="eh-text-action" onClick={()=>onTab('connections')}>{uiText('View all connections')}</button>
    </section>
    <section className="eh-section eh-glance-pages"><h2>{uiText('Pages to return to')}</h2>
      <p className="eh-writing-hint">{uiText('Pinned first, then most recently attached. Page mentions are shown separately below.')}</p>
      {linked.length ? <ul className="eh-glance-list">{linked.map(page=><li key={page.id}><button type="button" onClick={()=>onOpenPage(page.id)}><strong>{previewText(page.title || uiText('Untitled'),160)}</strong><small>{uiText(page.pinned ? 'Pinned · associated page' : 'Associated page')}{page.archived_at&&' · Archived'}{page.created_at && ' · ' + page.created_at.slice(0,10)}</small>{page.annotation && <span>{previewText(page.annotation)}</span>}</button></li>)}</ul> : <p className="entity-detail-empty">{uiText('No pages intentionally associated yet. Attach or pin a page in Mentions.')}</p>}
      {!!mentions.length && <><h3>{uiText('Recently edited pages mentioning this entity')}</h3><ul className="eh-glance-list">{mentions.map(page=>{
        const context=page.contexts?.[0], reference=context?.occurrences[0]?.reference;
        return <li key={page.id}><button type="button" onClick={()=>reference && onOpenMention ? onOpenMention(reference) : onOpenPage(page.id)}><strong>{previewText(page.title || uiText('Untitled'),160)}</strong><small>{uiText(reference ? 'Page mention · open occurrence' : 'Page mention · open page')}{page.archived_at&&' · Archived'}{!!context?.heading.length && ' · ' + context.heading.join(' › ')}</small>{(context?.excerpt || page.excerpt) && <span className="eh-glance-excerpt">{previewText(context?.excerpt || page.excerpt)}</span>}</button></li>;
      })}</ul></>}
      <button type="button" className="eh-text-action" onClick={()=>onTab('mentions')}>{uiText('View mentions and manage associated pages')}</button>
    </section>
  </div>;
}
const reasonLabels = {citation:'Cited alongside entity', 'source-mention':'Name appears in source', 'reading-note':'Reading note associated with entity', highlight:'Entity name appears in highlighted passage'};
export function EntityGlanceSources({vaultId, entityId, refreshKey, active, onReady, onTab, onOpenSourcePassage}: {
  vaultId:string; entityId:string; refreshKey:string; active:boolean; onReady?:()=>void; onTab:()=>void;
  onOpenSourcePassage?:(reference:SourceReference, trigger?:HTMLElement)=>void;
}) {
  const [evidence,setEvidence]=useState<EntityEvidence|null>(null), [error,setError]=useState(''), [attempt,setAttempt]=useState(0);
  const loadedKey=useRef('');
  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController(); let current=true;
    const key=vaultId+':'+entityId+':'+refreshKey;
    if(loadedKey.current!==key){setEvidence(null);loadedKey.current=key;}
    setError('');
    void api.entityOverviewEvidence(vaultId,entityId,controller.signal).then(value=>{if(current)setEvidence(value);}).catch(value=>{if(current&&!controller.signal.aborted)setError(String(value));});
    return ()=>{current=false;controller.abort();};
  },[vaultId,entityId,refreshKey,active,attempt]);
  useLayoutEffect(()=>{if(active&&(evidence||error))onReady?.();},[evidence,error,active,onReady]);
  const groups=(evidence?.groups ?? []).map(group=>({...group,passage:[...group.passages].sort((a,b)=>sourcePreviewRank(a)-sourcePreviewRank(b)||a.id.localeCompare(b.id))[0]})).filter(group=>group.passage).sort((a,b)=>sourcePreviewRank(a.passage!)-sourcePreviewRank(b.passage!)||a.sourceId.localeCompare(b.sourceId)).slice(0,2);
  return <section className="eh-section eh-glance-sources"><h2>{uiText('Source excerpts')}</h2>
    <p className="eh-writing-hint">{uiText('Connections to source material, not verification of the description. Open the original for context.')}</p>
    {error ? <div role="alert"><p>{uiText('Source preview unavailable.')}</p><button type="button" className="eh-text-action" onClick={()=>setAttempt(value=>value+1)}>{uiText('Retry source preview')}</button></div> : !evidence ? <p role="status">{uiText('Loading source preview…')}</p> : !groups.length ? <p className="entity-detail-empty">{uiText('No source excerpts in this preview. Explore Sources for more context.')}</p> : <ul className="eh-glance-list">{groups.map(group=>{
      const passage=group.passage!, reference=passage.reference;
      return <li key={group.sourceId}><h3>{previewText(group.sourceName,160)}</h3><p className="eh-evidence-reason">{(passage.reasons?.length ? passage.reasons : [passage.reason]).map(reason=>uiText(reasonLabels[reason])).join(' · ')}</p>{passage.heading && <p className="eh-context-heading">{previewText(passage.heading,160)}</p>}<blockquote>{previewText(reference.excerpt)}</blockquote>{passage.stale && <p className="eh-evidence-stale">{uiText('Saved excerpt · source location could not be verified')}</p>}<button type="button" disabled={!onOpenSourcePassage} onClick={event=>onOpenSourcePassage?.(reference,event.currentTarget)}>{uiText('Open source passage')}: {citationLocation(reference)}</button></li>;
    })}</ul>}
    <button type="button" className="eh-text-action" onClick={onTab}>{uiText('View all source passages')}</button>
    {evidence?.truncated && <p className="eh-writing-hint">{uiText('Preview search limited. More evidence may be available in Sources.')}</p>}
  </section>;
}
