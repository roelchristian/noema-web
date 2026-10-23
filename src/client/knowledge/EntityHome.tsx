import {PropertyProposalReview} from './PropertyProposalReview';
import {EntityPropertyList} from './EntityPropertyList';
import {propertyLabel,resolvePropertyDefinition} from '../../shared/property-definitions';
import {EntityGlance, EntityGlanceSources, previewText} from './EntityGlance';
import {TemporalPropertyValue} from './TemporalPropertyValue';
import {useContext, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ReviewDestination} from '../review/review-destination';
import {entityHomeTemplate} from './entity-home-template';
import {EntityNeighborhood} from './EntityNeighborhood';
import {EntityDiscovery} from './EntityDiscovery';
import {api} from '../api';
import {t as uiText} from '../i18n';
import {Icon} from '../components/Icon';
import {Mention} from '../components/Mention';
import {entityLabels, type Entity, type EntityDetail, type PageSummary, type SourceReference} from '../../shared/domain';
import {inheritedPropertyNames} from '../../shared/entity-schema';
import {domainBreadcrumb} from './DomainPicker';
import {hasEntityDraft} from './entity-drafts';
import {useEntitySchema} from './useEntitySchema';
import {EntityOverview} from './EntityOverview';
import {EntityPages} from './EntityPages';
import {EntityMentions} from './EntityMentions';
import {EntitySourceEvidence} from './EntitySourceEvidence';
import type {EntityMentionReference} from '../../shared/entity-mentions';
import {SourceLifecycleDialog} from './SourceLifecycleDialog';
import {EntityConnections, EntityDetails, EntityReference, PropertyEditor, RelationshipEditor, type EntityConnection} from './EntityDetails';

export interface EntityHomeProps {
  vaultId: string;
  id: string;
  entities: Entity[];
  refreshKey: string;
  onOpen: (id: string) => void;
  onInspect?: (id: string) => void;
  onOpenPage: (id: string) => void;
  onOpenMention?: (reference: EntityMentionReference) => void;
  onOpenSourcePassage?: (reference: SourceReference, trigger?: HTMLElement) => void;
  onUpdated: () => Promise<void>;
  onError: (error: unknown) => void;
  onClose?: () => void;
  pages?: PageSummary[];
  onCreatePage?: () => Promise<PageSummary>;
  onCreatePageFromSource?: (source: Entity) => void;
}
const tabs = ['overview', 'connections', 'mentions', 'sources', 'discovery', 'edit'] as const;
type HomeTab = typeof tabs[number];
function revealTab(value: HomeTab) {
  const button=document.getElementById('entity-home-tab-'+value), strip=button?.parentElement;
  if(!button||!strip)return;
  const bounds=button.getBoundingClientRect(),viewport=strip.getBoundingClientRect();
  if(bounds.left<viewport.left)strip.scrollLeft+=bounds.left-viewport.left;
  else if(bounds.right>viewport.right)strip.scrollLeft+=bounds.right-viewport.right;
}
const tabLabels = {overview:'Overview', connections:'Connections', mentions:'Mentions', sources:'Sources', discovery:'Discovery', edit:'Edit'};

/** A destination for a knowledge subject, backed by the same record and drafts as its inspector. */
export function EntityHome({vaultId, id, entities, refreshKey, onOpen, onInspect, onOpenPage, onOpenMention, onOpenSourcePassage, onUpdated, onError, onClose, pages = [], onCreatePage}: EntityHomeProps) {
  const reviewDestination=useContext(ReviewDestination);
  const reviewTab=reviewDestination?.category==='discovery'&&reviewDestination.originId===id?'discovery':reviewDestination?.category==='property'&&reviewDestination.originId===id?'overview':null;
  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [error, setError] = useState('');
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [entityAttempt, setEntityAttempt] = useState(0);
  const navigationKey = vaultId + ':' + id;
  const savedNavigation = () => window.history.state?.entityHome?.key === navigationKey ? window.history.state.entityHome : null;
  const initialTab = (): HomeTab => reviewTab ?? (hasEntityDraft(vaultId,id) ? 'edit' : tabs.includes(savedNavigation()?.tab) ? savedNavigation().tab : 'overview');
  const [tab, setTab] = useState<HomeTab>(initialTab);
  const activeTab = useRef(tab); activeTab.current=tab;
  const article = useRef<HTMLElement>(null);
  const scrolls = useRef<Partial<Record<HomeTab,number>>>(savedNavigation()?.scrolls ?? {});
  const restoring = useRef(true);
  const restoreScroll = () => {if (!restoring.current)return;const host=document.scrollingElement;if(host)host.scrollTop=scrolls.current[tab] ?? 0;restoring.current=false;};
  useEffect(()=>{
    const host=document.scrollingElement;
    const save=()=>{if(restoring.current)return;scrolls.current[tab]=host?.scrollTop ?? 0; window.history.replaceState({...window.history.state,entityHome:{key:navigationKey,tab,scrolls:scrolls.current}},'');};
    window.addEventListener('scroll',save);
    return ()=>{window.removeEventListener('scroll',save);};
  },[navigationKey,tab]);
  useLayoutEffect(()=>{if(!entity || entity.id!==id)return;revealTab(tab);const host=document.scrollingElement;if(host)host.scrollTop=scrolls.current[tab] ?? 0;if(!['overview','sources'].includes(tab)&&(!entity.previewLimited || tab==='discovery'))restoring.current=false;},[tab,entity]);
  const [manage, setManage] = useState(false);
  const [exploring, setExploring] = useState(false);
  const current = useRef({vaultId, id}); current.current = {vaultId, id};
  const {schema, error: schemaError} = useEntitySchema(vaultId);
  // A Review Centre destination selects Discovery without clearing this entity or its drafts.
  useEffect(() => {if(reviewTab){restoring.current=true;setTab(reviewTab);}}, [reviewTab]);
  useEffect(() => {setEntity(null); setPageError(''); setManage(false); setExploring(false); setTab(initialTab());}, [vaultId, id]);
  useEffect(() => {
    let active = true; setError('');
    // Refresh an open editor with full details so transient previews cannot unmount its forms.
    void api.entity(vaultId, id, !['connections','mentions','edit'].includes(activeTab.current)).then(async value => {
      if (!active)return;
      if(value.previewLimited && ['connections','mentions','edit'].includes(activeTab.current))value=await api.entity(vaultId,id);
      if(active)setEntity(value);
    }).catch(value => {if (active) setError(String(value));});
    return () => {active = false;};
  }, [vaultId, id, refreshKey, entityAttempt]);
  useEffect(() => {
    if (!entity?.previewLimited || !['overview','connections','mentions','edit'].includes(tab)) return;
    let active = true;
    void api.entity(vaultId,id).then(value=>{if(active)setEntity(value);}).catch(value=>{if(active)setError(String(value));});
    return ()=>{active=false;};
  }, [vaultId,id,tab,entity?.previewLimited,detailAttempt]);
  const sameEntity = () => current.current.vaultId === vaultId && current.current.id === id;
  async function mutate(work: () => Promise<EntityDetail>) {
    try {const result = await work(); if (sameEntity()) setEntity(result); void onUpdated().catch(onError); return result;}
    catch (value) {onError(value); throw value;}
  }
  function switchTab(value: HomeTab) {
    const host=document.scrollingElement;
    scrolls.current[tab]=host?.scrollTop ?? 0;
    window.history.replaceState({...window.history.state,entityHome:{key:navigationKey,tab:value,scrolls:scrolls.current}},'');
    restoring.current=true;
    setTab(value);
    document.getElementById('entity-home-tab-' + value)?.focus({preventScroll:true});
    revealTab(value);
  }
  const relationships: EntityConnection[] = entity?.relationships.map(relation => ({key:relation.id, target:relation.source_id === id ? relation.target_id : relation.source_id, label:(relation.source_id === id ? 'Outgoing · ' : 'Incoming · ') + relation.label})) ?? [];
  const propertyDisplayLabel=(property:import('../../shared/domain').Property)=>{const owner=property.entity_id===id?entity:entities.find(item=>item.id===property.entity_id);return owner?resolvePropertyDefinition(schema.propertyDefinitions,owner.type,owner.subtypes,property.name,property.metadata?.definition_id)?.label??propertyLabel(property.name):propertyLabel(property.name);};
  const references: EntityConnection[] = entity?.properties.filter(property => property.target_id).map(property => ({key:property.id, target:property.target_id!, label:'Property · ' + propertyDisplayLabel(property)})) ?? [];
  const incoming: EntityConnection[] = entity?.incomingProperties.map(property => ({key:property.id, target:property.entity_id, label:'Referenced via ' + propertyDisplayLabel(property)})) ?? [];
  const connectionCount = relationships.length + references.length + incoming.length;
  const propertyNames = entity ? [...new Map([...entity.propertyNames, ...inheritedPropertyNames(schema, entity.type, entity.subtypes)].map(name => [name.toLowerCase(), name])).values()] : [];
  const template = entityHomeTemplate(entity?.type ?? 'concept');
  const subtypes = schema.subtypes.filter(subtype => entity?.subtypes.includes(subtype.id)).map(subtype => subtype.name);
  const mention = (entityId: string) => <Mention id={entityId} entities={entities} onOpen={onOpen}/>;
  const pageMentions = [...new Map((entity?.pageMentions ?? []).map(page => [page.id, page])).values()];
  const linkedPages = entity?.linkedPages ?? [];
  const pageCount = new Set([...pageMentions.map(page => page.id), ...linkedPages.map(page => page.id)]).size;
  const [pageError, setPageError] = useState('');
  const [pinning, setPinning] = useState(false);
  async function pinMention(pageId: string) {
    setPinning(true); setPageError('');
    try {await mutate(() => api.associateEntityPage(vaultId, id, pageId, {pinned: true}));}
    catch (value) {setPageError(String(value));} finally {setPinning(false);}
  }
  return <article ref={article} className="entity-home" aria-label={uiText('Entity homepage')}><div className="eh-document">
    {!entity ? <p role={error ? 'alert' : 'status'}>{error || uiText('Loading entity…')}{error && <button type="button" className="eh-text-action" onClick={()=>setEntityAttempt(value=>value+1)}>{uiText('Retry')}</button>}</p> : <>
      <header className="eh-header">
        {onClose && <button type="button" className="eh-breadcrumb" onClick={onClose}>{uiText('Knowledge entities')}</button>}
        <div className="eh-classification"><Icon name={entity.type}/><span>{uiText(entityLabels[entity.type])}{subtypes.length ? ' · ' + subtypes.join(' · ') : ''}</span></div>
        <h1>{entity.name}</h1>
        {!!entity.domainIds?.length && <p className="eh-domains">{entity.domainIds.map(domainBreadcrumb).join(' · ')}</p>}
        <div className="eh-counts"><button type="button" onClick={() => switchTab('mentions')}>{entity.previewLimited ? uiText('Pages & mentions') : <>{pageCount} {uiText(pageCount === 1 ? 'page' : 'pages')}</>}</button><button type="button" onClick={() => switchTab('connections')}>{entity.previewLimited ? uiText('Connections') : <>{connectionCount} {uiText(connectionCount === 1 ? 'connection' : 'connections')}</>}</button></div>
        <div className="eh-lifecycle">{entity.archived_at && <span role="status"><Icon name="archive"/>{uiText('Archived')}</span>}<button type="button" aria-haspopup="dialog" onClick={() => setManage(true)}>{uiText(entity.archived_at ? 'Restore…' : 'Archive…')}</button></div>
      </header>
      {error && <p role="alert">{error} <button type="button" onClick={()=>{setError('');setDetailAttempt(value=>value+1);}}>{uiText('Retry details')}</button></p>}
      {entity.previewLimited && ['connections','mentions','edit'].includes(tab) && !error && <p role="status">{uiText('Loading complete details…')}</p>}
      <div className="eh-tabs" role="tablist" aria-label={uiText('Entity homepage sections')}>{tabs.map((value,index) => <button key={value} type="button" id={'entity-home-tab-' + value} role="tab" aria-selected={tab === value} aria-controls={'entity-home-panel-' + value} tabIndex={tab === value ? 0 : -1} onClick={() => switchTab(value)} onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        switchTab(tabs[next]!);
      }}>{uiText(tabLabels[value])}</button>)}</div>
      <div className="eh-tabpanel" id="entity-home-panel-overview" role="tabpanel" aria-labelledby="entity-home-tab-overview" hidden={tab !== 'overview'} tabIndex={0}>
        {entity.description ? <p className="eh-description eh-short-description">{previewText(entity.description,360)}</p> : <p className="entity-detail-empty">{uiText('No description recorded yet.')} <button type="button" className="eh-text-action" onClick={()=>switchTab('edit')}>{uiText('Add a description')}</button></p>}
        <section className="eh-section eh-glance-properties"><h2>{uiText(template.detailsTitle)}</h2>{entity.previewLimited?<p role="status">{uiText('Loading complete properties…')}</p>:<EntityPropertyList active={tab==='overview'} definitions={schema.propertyDefinitions} limit={4} key={vaultId + ':' + id} vaultId={vaultId} entity={{...entity,propertyNames}} entities={entities} mention={mention} priority={template.prominentProperties} onSave={(input,propertyId)=>mutate(()=>api.saveProperty(vaultId,id,input,propertyId))} onRemove={propertyId=>mutate(()=>api.removeConnection(vaultId,id,'properties',propertyId))} onRefresh={()=>mutate(()=>api.entity(vaultId,id))}/>}</section>
        {(!!entity.propertyProposalCount||reviewDestination?.category==='property')&&<PropertyProposalReview proposalId={reviewDestination?.category==='property'?reviewDestination.proposalId:undefined} key={vaultId+':'+id+':review'} vaultId={vaultId} entityId={id} entities={entities} onUpdated={async()=>{await mutate(()=>api.entity(vaultId,id));}}/>}
        <EntityGlance entity={entity} entities={entities} connections={[...relationships,...references,...incoming]} onOpen={onOpen} onOpenPage={onOpenPage} onOpenMention={onOpenMention} onTab={switchTab}/>
        <EntityGlanceSources vaultId={vaultId} entityId={id} refreshKey={refreshKey} active={tab==='overview'} onReady={restoreScroll} onTab={()=>switchTab('sources')} onOpenSourcePassage={onOpenSourcePassage}/>
        <EntityOverview guidance={template.overviewGuidance} key={vaultId + ':' + id} vaultId={vaultId} entity={entity} onSave={input => mutate(() => api.saveEntityOverview(vaultId, id, input))} onRefresh={() => mutate(() => api.entity(vaultId, id))}/>
        {!!entity.aliases?.length && <section className="eh-section"><h2>{uiText('Also known as')}</h2><ul className="entity-overview-aliases">{entity.aliases.slice(0,5).map(alias=><li key={alias}>{previewText(alias,100)}</li>)}</ul><button type="button" className="eh-text-action" onClick={()=>switchTab('edit')}>{uiText('View all aliases in Edit')}</button></section>}
        <p className="eh-writing-hint">{uiText('Discovery suggestions are separate from recorded connections and evidence.')} <button type="button" className="eh-text-action" onClick={()=>switchTab('discovery')}>{uiText('Open Discovery')}</button></p>
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-connections" role="tabpanel" aria-labelledby="entity-home-tab-connections" hidden={tab !== 'connections'} tabIndex={0}>
        {!entity.previewLimited && <>
        <div className="eh-overview-links"><button type="button" aria-expanded={exploring} onClick={()=>setExploring(value=>!value)}>{uiText(exploring?'Show grouped connections':'Explore neighborhood')}</button></div>
        {exploring && <EntityNeighborhood vaultId={vaultId} id={id} refreshKey={refreshKey} onOpen={onOpen} onInspect={onInspect}/>}
        <div hidden={exploring}>
        <section className="eh-section"><h2>{uiText('Relationships')} <span>{relationships.length}</span></h2><EntityConnections items={relationships} entities={entities} onOpen={onOpen} empty={uiText('No relationships yet.')}/></section>
        <section className="eh-section"><h2>{uiText('Referenced entities')} <span>{references.length}</span></h2><EntityConnections items={references} entities={entities} onOpen={onOpen} empty={uiText('No entity references in properties.')}/></section>
        <section className="eh-section"><h2>{uiText('Referenced by')} <span>{incoming.length}</span></h2><EntityConnections items={incoming} entities={entities} onOpen={onOpen} empty={uiText('No other entities reference this one yet.')}/></section>
        <button type="button" className="button" onClick={() => switchTab('edit')}>{uiText('Edit connections')}</button>
        </div>
        </>}
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-mentions" role="tabpanel" aria-labelledby="entity-home-tab-mentions" hidden={tab !== 'mentions'} tabIndex={0}>
        {!entity.previewLimited && <>
        <EntityPages key={'pages:' + vaultId + ':' + id} entity={entity} pages={pages} onOpenPage={onOpenPage} onAssociate={(pageId, input) => mutate(() => api.associateEntityPage(vaultId, id, pageId, input))} onRemove={pageId => mutate(() => api.removeEntityPage(vaultId, id, pageId))} onCreatePage={onCreatePage}/>
        <EntityMentions pages={pageMentions} linkedPages={linkedPages} onOpenPage={onOpenPage} onOpenMention={onOpenMention} onPin={pageId => void pinMention(pageId)} pinning={pinning} error={pageError}/>
        </>}
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-sources" role="tabpanel" aria-labelledby="entity-home-tab-sources" hidden={tab !== 'sources'} tabIndex={0}>
        {tab === 'sources' && <EntitySourceEvidence key={vaultId + ':' + id} vaultId={vaultId} entityId={id} refreshKey={refreshKey} pages={pages} onReady={restoreScroll} onOpenPage={onOpenPage} onOpenSourcePassage={onOpenSourcePassage}/>}
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-discovery" role="tabpanel" aria-labelledby="entity-home-tab-discovery" hidden={tab !== 'discovery'} tabIndex={0}>
        {tab==='discovery' && <EntityDiscovery key={vaultId+':'+id} vaultId={vaultId} id={id} refreshKey={refreshKey} onUpdated={onUpdated} onOpenEntity={onOpen} onOpenPage={onOpenPage} onOpenMention={onOpenMention} onOpenSourcePassage={onOpenSourcePassage}/>}
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-edit" role="tabpanel" aria-labelledby="entity-home-tab-edit" hidden={tab !== 'edit'} tabIndex={0}>
        {!entity.previewLimited && <>
        {schemaError && <p role="alert">{schemaError}</p>}
        <section className="eh-section"><h2>{uiText('Entity details')}</h2><EntityDetails idPrefix="entity-home" key={entity.id} vaultId={vaultId} entity={entity} schema={schema} onSave={input => mutate(() => api.updateEntity(vaultId, id, input))}/></section>
        <section className="eh-section"><h2>{uiText('Properties')}</h2><PropertyEditor definitions={schema.propertyDefinitions} key={entity.type + JSON.stringify(entity.subtypes)} entity={{...entity, propertyNames}} entities={entities} mention={mention} onSave={(input, propertyId) => mutate(() => api.saveProperty(vaultId, id, input, propertyId))} onRemove={propertyId => mutate(() => api.removeConnection(vaultId, id, 'properties', propertyId))}/></section>
        <section className="eh-section"><h2>{uiText('Relationships')}</h2><RelationshipEditor entity={entity} entities={entities} mention={mention} onSave={(input, relationId) => mutate(() => api.saveRelationship(vaultId, id, input, relationId))} onRemove={relationId => mutate(() => api.removeConnection(vaultId, id, 'relationships', relationId))}/></section>
        </>}
      </div>
      {manage && <SourceLifecycleDialog vaultId={vaultId} source={entity} onClose={() => setManage(false)} onUpdated={async () => {await onUpdated(); const value = await api.entity(vaultId, id); if (sameEntity()) setEntity(value);}}/>}
    </>}
  </div></article>;
}
