import {SourceMetadata} from '../sources/SourceMetadata';
import {ConnectPicker, type ConnectTarget, type ConnectOptions} from './ConnectPicker';
import {canonicalRelationshipLabel,relationshipDisplayLabel} from '../../shared/relationship-predicates';
import {aggregateEntityConnections} from './connection-read-model';
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
import {referentStatusLabels, entityLabels, type Entity, type EntityDetail, type PageSummary, type SourceReference} from '../../shared/domain';
import {inheritedPropertyNames} from '../../shared/entity-schema';
import {domainBreadcrumb} from './DomainPicker';
import {hasEntityDraft} from './entity-drafts';
import {useEntitySchema} from './useEntitySchema';
import {EntityOverview} from './EntityOverview';
import {EntityPages} from './EntityPages';
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
const tabs = ['overview', 'metadata', 'connections', 'evidence'] as const;
type HomeTab = typeof tabs[number];
function revealTab(value: HomeTab) {
  const button=document.getElementById('entity-home-tab-'+value), strip=button?.parentElement;
  if(!button||!strip)return;
  const bounds=button.getBoundingClientRect(),viewport=strip.getBoundingClientRect();
  if(bounds.left<viewport.left)strip.scrollLeft+=bounds.left-viewport.left;
  else if(bounds.right>viewport.right)strip.scrollLeft+=bounds.right-viewport.right;
}
const tabLabels = {overview:'Overview', metadata:'Metadata', connections:'Connections', evidence:'Evidence'};

/** A destination for a knowledge subject, backed by the same record and drafts as its inspector. */
export function EntityHome({vaultId, id, entities, refreshKey, onOpen, onInspect, onOpenPage, onOpenMention, onOpenSourcePassage, onUpdated, onError, onClose, pages = [], onCreatePage}: EntityHomeProps) {
  const reviewDestination=useContext(ReviewDestination);
  const reviewTab=reviewDestination?.category==='discovery'&&reviewDestination.originId===id?'connections':reviewDestination?.category==='property'&&reviewDestination.originId===id?(entities.find(item=>item.id===id)?.type==='source'?'metadata':'overview'):null;
  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [error, setError] = useState('');
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [entityAttempt, setEntityAttempt] = useState(0);
  const navigationKey = vaultId + ':' + id;
  const savedNavigation = () => window.history.state?.entityHome?.key === navigationKey ? window.history.state.entityHome : null;
  const initialTab = (): HomeTab => reviewTab ?? (hasEntityDraft(vaultId,id) ? 'overview' : tabs.includes(savedNavigation()?.tab) ? savedNavigation().tab : savedNavigation()?.tab === 'sources' ? 'evidence' : savedNavigation()?.tab === 'mentions' || savedNavigation()?.tab === 'discovery' ? 'connections' : 'overview');
  const [tab, setTab] = useState<HomeTab>(initialTab);
  const [metadataRun,setMetadataRun]=useState<string|undefined>(reviewDestination?.metadataRunId);
  useEffect(()=>{if(reviewDestination?.category==='property'&&reviewDestination.originId===id)setMetadataRun(reviewDestination.metadataRunId);},[reviewDestination?.proposalId,reviewDestination?.metadataRunId,id]);
  useEffect(()=>{const open=(event:Event)=>{const detail=(event as CustomEvent<{vaultId?:string;sourceId?:string;runId?:string}>).detail;if(detail?.vaultId===vaultId&&detail.sourceId===id){setMetadataRun(detail.runId);setTab('metadata');}};window.addEventListener('noema:open-source-metadata',open);return()=>window.removeEventListener('noema:open-source-metadata',open);},[vaultId,id]);
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
  useLayoutEffect(()=>{if(!entity || entity.id!==id)return;revealTab(tab);const host=document.scrollingElement;if(host)host.scrollTop=scrolls.current[tab] ?? 0;if(!['overview','evidence'].includes(tab)&&!entity.previewLimited)restoring.current=false;},[tab,entity]);
  const [manage, setManage] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(!!reviewTab && reviewDestination?.category==='discovery');
  const [discoveryLoaded,setDiscoveryLoaded]=useState(!!reviewTab && reviewDestination?.category==='discovery');
  const [detailsOpen, setDetailsOpen] = useState(hasEntityDraft(vaultId,id));
  const [connecting,setConnecting]=useState(false);
  const [connectingBusy,setConnectingBusy]=useState(false);
  const [connectionUndo,setConnectionUndo]=useState<{kind:'page'|'relationship';id:string}|null>(null);
  const [connectionError,setConnectionError]=useState('');
  const [undoing,setUndoing]=useState(false);
  const connectionLock=useRef<object|null>(null);
  const mutationVersion=useRef(0);
  const current = useRef({vaultId,id});
  if(current.current.vaultId!==vaultId||current.current.id!==id)current.current={vaultId,id};
  const owner=current.current;
  const {schema, error: schemaError} = useEntitySchema(vaultId);
  // A Review Centre destination selects Discovery without clearing this entity or its drafts.
  useEffect(() => {if(reviewTab){restoring.current=true;setTab(reviewTab);if(reviewDestination?.category==='discovery'){setDiscoveryOpen(true);setDiscoveryLoaded(true);}}}, [reviewTab]);
  useEffect(() => {setEntity(null); setManage(false); setConnecting(false);setConnectingBusy(false);setConnectionUndo(null);setConnectionError('');setUndoing(false); setExploring(false); setDiscoveryOpen(reviewDestination?.category==='discovery'&&reviewDestination.originId===id);setDiscoveryLoaded(reviewDestination?.category==='discovery'&&reviewDestination.originId===id); setDetailsOpen(hasEntityDraft(vaultId,id)); setTab(initialTab());}, [vaultId, id]);
  useEffect(() => {
    let active = true; const version=mutationVersion.current; setError('');
    // Refresh an open editor with full details so transient previews cannot unmount its forms.
    void api.entity(vaultId, id, !hasEntityDraft(vaultId,id) && !entity && activeTab.current!=='connections').then(async value => {
      if (!active||version!==mutationVersion.current)return;
      if(value.previewLimited && ['connections','overview'].includes(activeTab.current))value=await api.entity(vaultId,id);
      if(active&&version===mutationVersion.current)setEntity(value);
    }).catch(value => {if (active&&version===mutationVersion.current) setError(String(value));});
    return () => {active = false;};
  }, [vaultId, id, refreshKey, entityAttempt]);
  useEffect(() => {
    if (!entity?.previewLimited || !['overview','connections'].includes(tab)) return;
    let active = true;const version=mutationVersion.current;
    void api.entity(vaultId,id).then(value=>{if(active&&version===mutationVersion.current)setEntity(value);}).catch(value=>{if(active&&version===mutationVersion.current)setError(String(value));});
    return ()=>{active=false;};
  }, [vaultId,id,tab,entity?.previewLimited,detailAttempt]);
  const sameEntity = () => current.current===owner;
  async function mutate(work: () => Promise<EntityDetail>) {
    const version=++mutationVersion.current;
    try {const result = await work(); if(sameEntity()){if(version===mutationVersion.current){mutationVersion.current++;setEntity(result);}else {const refreshVersion=mutationVersion.current;void api.entity(vaultId,id).then(value=>{if(sameEntity()&&refreshVersion===mutationVersion.current)setEntity(value);}).catch(onError);}} void onUpdated().catch(onError); return result;}
    catch (value) {if(sameEntity()&&version===mutationVersion.current)mutationVersion.current++;onError(value); throw value;}
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
  const relationships: EntityConnection[] = entity?.relationships.map(relation => ({key:relation.id, target:relation.source_id === id ? relation.target_id : relation.source_id, label:relationshipDisplayLabel(relation,id)})) ?? [];
  const propertyDisplayLabel=(property:import('../../shared/domain').Property)=>{const owner=property.entity_id===id?entity:entities.find(item=>item.id===property.entity_id);return owner?resolvePropertyDefinition(schema.propertyDefinitions,owner.type,owner.subtypes,property.name,property.metadata?.definition_id)?.label??propertyLabel(property.name):propertyLabel(property.name);};
  const references: EntityConnection[] = entity?.properties.filter(property => property.target_id).map(property => ({key:property.id, target:property.target_id!, label:'Property · ' + propertyDisplayLabel(property)})) ?? [];
  const incoming: EntityConnection[] = entity?.incomingProperties.map(property => ({key:property.id, target:property.entity_id, label:'Referenced via ' + propertyDisplayLabel(property)})) ?? [];
  const connectionRows = aggregateEntityConnections([...relationships,...references,...incoming]);
  const connectionCount = connectionRows.length;
  const [connectionQuery,setConnectionQuery] = useState('');
  const [connectionFilter,setConnectionFilter] = useState('all');
  const filteredEntities=connectionRows.filter(row=>((entities.find(item=>item.id===row.target)?.name??'')+' '+row.label).toLocaleLowerCase().includes(connectionQuery.toLocaleLowerCase()));
  const propertyNames = entity ? [...new Map([...entity.propertyNames, ...inheritedPropertyNames(schema, entity.type, entity.subtypes)].map(name => [name.toLowerCase(), name])).values()] : [];
  const template = entityHomeTemplate(entity?.type ?? 'concept');
  const subtypes = schema.subtypes.filter(subtype => entity?.subtypes.includes(subtype.id)).map(subtype => subtype.name);
  const mention = (entityId: string) => <Mention id={entityId} entities={entities} onOpen={onOpen}/>;
  const pageMentions = [...new Map((entity?.pageMentions ?? []).map(page => [page.id, page])).values()];
  const linkedPages = entity?.linkedPages ?? [];
  const pageCount = new Set([...pageMentions.map(page => page.id), ...linkedPages.map(page => page.id)]).size;
  async function connect(target:ConnectTarget,options:ConnectOptions) {
    if(!entity||connectionLock.current===owner)return;
    connectionLock.current=owner;setConnectingBusy(true);setConnectionError('');
    try {
      if(target.kind==='page') {
        await mutate(()=>api.associateEntityPage(vaultId,id,target.id,{pinned:options.pinned,annotation:options.annotation}));
        if(sameEntity())setConnectionUndo({kind:'page',id:target.id});
      } else {
        if(entity.relationships.some(relation=>relation.source_id===id&&relation.target_id===target.id&&canonicalRelationshipLabel(relation.label)===options.predicate))throw new Error(uiText('This relationship already exists.'));
        const before=new Set(entity.relationships.map(relation=>relation.id));
        const result=await mutate(()=>api.saveRelationship(vaultId,id,{target_id:target.id,label:options.predicate}));
        const added=result.relationships.find(relation=>!before.has(relation.id)&&relation.source_id===id&&relation.target_id===target.id&&relation.label===options.predicate);
        if(sameEntity()&&added)setConnectionUndo({kind:'relationship',id:added.id});
      }
      if(sameEntity())setConnecting(false);
    } finally {if(connectionLock.current===owner)connectionLock.current=null;if(sameEntity())setConnectingBusy(false);}
  }
  async function undoConnection() {
    if(!connectionUndo||connectionLock.current===owner)return;
    connectionLock.current=owner;setUndoing(true);setConnectionError('');
    try {await mutate(()=>connectionUndo.kind==='page'?api.removeEntityPage(vaultId,id,connectionUndo.id):api.removeConnection(vaultId,id,'relationships',connectionUndo.id));if(sameEntity())setConnectionUndo(null);}
    catch(value){if(sameEntity())setConnectionError(String(value));}
    finally{if(connectionLock.current===owner)connectionLock.current=null;if(sameEntity())setUndoing(false);}
  }
  return <article ref={article} className="entity-home" aria-label={uiText('Entity homepage')}><div className="eh-document">
    {!entity ? <p role={error ? 'alert' : 'status'}>{error || uiText('Loading entity…')}{error && <button type="button" className="eh-text-action" onClick={()=>setEntityAttempt(value=>value+1)}>{uiText('Retry')}</button>}</p> : <>
      <header className="eh-header">
        {onClose && <button type="button" className="eh-breadcrumb" onClick={onClose}>{uiText('Knowledge entities')}</button>}
        <div className="eh-classification"><Icon name={entity.type} entity={entity}/><span>{uiText(entityLabels[entity.type])} · {uiText(referentStatusLabels[entity.referentStatus??'unspecified'])}{subtypes.length ? ' · ' + subtypes.join(' · ') : ''}</span></div>
        <h1>{entity.name}</h1>
        {!!entity.domainIds?.length && <p className="eh-domains">{entity.domainIds.map(domainBreadcrumb).join(' · ')}</p>}
        <div className="eh-counts"><button type="button" onClick={() => switchTab('connections')}>{entity.previewLimited ? uiText('Pages & mentions') : <>{pageCount} {uiText(pageCount === 1 ? 'page' : 'pages')}</>}</button><button type="button" onClick={() => switchTab('connections')}>{entity.previewLimited ? uiText('Connections') : <>{connectionCount} {uiText(connectionCount === 1 ? 'connection' : 'connections')}</>}</button></div>
        <div className="eh-lifecycle">{entity.archived_at && <span role="status"><Icon name="archive"/>{uiText('Archived')}</span>}<button type="button" aria-haspopup="dialog" onClick={() => setManage(true)}>{uiText(entity.archived_at ? 'Restore…' : 'Archive…')}</button></div>
      </header>
      {error && <p role="alert">{error} <button type="button" onClick={()=>{setError('');setDetailAttempt(value=>value+1);}}>{uiText('Retry details')}</button></p>}
      {entity.previewLimited && ['connections','overview'].includes(tab) && !error && <p role="status">{uiText('Loading complete details…')}</p>}
      <div className="eh-tabs" role="tablist" aria-label={uiText('Entity homepage sections')}>{tabs.filter(value=>value!=='metadata'||entity.type==='source').map((value,index) => <button key={value} type="button" id={'entity-home-tab-' + value} role="tab" aria-selected={tab === value} aria-controls={'entity-home-panel-' + value} tabIndex={tab === value ? 0 : -1} onClick={() => switchTab(value)} onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const visibleTabs=tabs.filter(value=>value!=='metadata'||entity.type==='source');
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
        switchTab(visibleTabs[next]!);
      }}>{uiText(tabLabels[value])}</button>)}</div>
      <div className="eh-tabpanel" id="entity-home-panel-overview" role="tabpanel" aria-labelledby="entity-home-tab-overview" hidden={tab !== 'overview'} tabIndex={0}>
        {entity.description ? <p className="eh-description eh-short-description">{previewText(entity.description,360)}</p> : <p className="entity-detail-empty">{uiText('No description recorded yet.')} <button type="button" className="eh-text-action" onClick={()=>setDetailsOpen(true)}>{uiText('Add a description')}</button></p>}
        <section className="eh-section eh-glance-properties"><h2>{uiText(template.detailsTitle)}</h2>{entity.previewLimited?<p role="status">{uiText('Loading complete properties…')}</p>:<EntityPropertyList active={tab==='overview'} definitions={schema.propertyDefinitions} limit={4} key={vaultId + ':' + id} vaultId={vaultId} entity={{...entity,propertyNames}} entities={entities} mention={mention} priority={template.prominentProperties} onSave={(input,propertyId)=>mutate(()=>api.saveProperty(vaultId,id,input,propertyId))} onRemove={propertyId=>mutate(()=>api.removeConnection(vaultId,id,'properties',propertyId))} onRefresh={()=>mutate(()=>api.entity(vaultId,id))}/>}</section>
        {entity.type!=='source'&&(!!entity.propertyProposalCount||reviewDestination?.category==='property')&&<PropertyProposalReview proposalId={reviewDestination?.category==='property'?reviewDestination.proposalId:undefined} key={vaultId+':'+id+':review'} vaultId={vaultId} entityId={id} entities={entities} onUpdated={async()=>{await mutate(()=>api.entity(vaultId,id));}}/>}
        {entity.type==='source'&&<button type="button" className="button" onClick={()=>switchTab('metadata')}>Review metadata</button>}
        <EntityGlance entity={entity} entities={entities} connections={connectionRows} onOpen={onOpen} onOpenPage={onOpenPage} onOpenMention={onOpenMention} onTab={()=>switchTab('connections')}/>
        <EntityGlanceSources vaultId={vaultId} entityId={id} refreshKey={refreshKey} active={tab==='overview'} onReady={restoreScroll} onTab={()=>switchTab('evidence')} onOpenSourcePassage={onOpenSourcePassage}/>
        <EntityOverview guidance={template.overviewGuidance} key={vaultId + ':' + id} vaultId={vaultId} entity={entity} onSave={input => mutate(() => api.saveEntityOverview(vaultId, id, input))} onRefresh={() => mutate(() => api.entity(vaultId, id))}/>
        {!!entity.aliases?.length && <section className="eh-section"><h2>{uiText('Also known as')}</h2><ul className="entity-overview-aliases">{entity.aliases.slice(0,5).map(alias=><li key={alias}>{previewText(alias,100)}</li>)}</ul><button type="button" className="eh-text-action" onClick={()=>setDetailsOpen(true)}>{uiText('Edit identity and aliases')}</button></section>}
<details className="eh-section" open={detailsOpen} onToggle={event=>setDetailsOpen(event.currentTarget.open)}><summary>{uiText('Identity and property details')}</summary>{!entity.previewLimited && <>
        {schemaError && <p role="alert">{schemaError}</p>}
        <section className="eh-section"><h2>{uiText('Entity details')}</h2><EntityDetails idPrefix="entity-home" key={entity.id} vaultId={vaultId} entity={entity} schema={schema} onSave={input => mutate(() => api.updateEntity(vaultId, id, input))}/></section>
        <section className="eh-section"><h2>{uiText('Properties')}</h2><PropertyEditor definitions={schema.propertyDefinitions} key={entity.type + JSON.stringify(entity.subtypes)} entity={{...entity, propertyNames}} entities={entities} mention={mention} onSave={(input, propertyId) => mutate(() => api.saveProperty(vaultId, id, input, propertyId))} onRemove={propertyId => mutate(() => api.removeConnection(vaultId, id, 'properties', propertyId))}/></section>
        </>}</details>
        <p className="eh-writing-hint">{uiText('Discovery suggestions are separate from recorded connections and evidence.')} <button type="button" className="eh-text-action" onClick={()=>{setDiscoveryOpen(true);setDiscoveryLoaded(true);switchTab('connections');}}>{uiText('Find connections')}</button></p>
      </div>
      {entity.type==='source'&&<div className="eh-tabpanel" id="entity-home-panel-metadata" role="tabpanel" aria-labelledby="entity-home-tab-metadata" hidden={tab!=='metadata'} tabIndex={0}>{tab==='metadata'&&<SourceMetadata vaultId={vaultId} sourceId={id} runId={metadataRun} proposalId={reviewDestination?.category==='property'?reviewDestination.proposalId:undefined} onUpdated={async()=>{await mutate(()=>api.entity(vaultId,id));}}/>}</div>}
      <div className="eh-tabpanel" id="entity-home-panel-connections" role="tabpanel" aria-labelledby="entity-home-tab-connections" hidden={tab !== 'connections'} tabIndex={0}>
        {!entity.previewLimited && <>
        <div className="eh-overview-links"><button type="button" aria-expanded={connecting} disabled={connectingBusy} onClick={()=>setConnecting(value=>!value)}>{uiText('Connect')}</button><button type="button" aria-expanded={exploring} onClick={()=>setExploring(value=>!value)}>{uiText(exploring?'Show grouped connections':'Explore neighborhood')}</button></div>
        {connecting&&<ConnectPicker sourceLabel={entity.name} entities={entities} pages={pages} relationships excludeEntityIds={[id]} excludePageIds={linkedPages.map(page=>page.id)} onConnect={connect} onCancel={()=>setConnecting(false)}/>}
        {connectionUndo&&<p role="status">{uiText('Connection added.')} <button type="button" disabled={undoing} onClick={()=>void undoConnection()}>{uiText('Undo')}</button></p>}
        {connectionError&&<p role="alert">{connectionError}</p>}
        {exploring && <EntityNeighborhood vaultId={vaultId} id={id} refreshKey={refreshKey} onOpen={onOpen} onInspect={onInspect}/>}
        <div hidden={exploring}>
        <div className="eh-overview-links"><label>{uiText('Search connections')}<input type="search" value={connectionQuery} onChange={event=>setConnectionQuery(event.target.value)}/></label><label>{uiText('Show')}<select value={connectionFilter} onChange={event=>setConnectionFilter(event.target.value)}><option value="all">{uiText('All')}</option><option value="entities">{uiText('Entities')}</option><option value="pages">{uiText('Pages')}</option><option value="mentions">{uiText('Mentions')}</option></select></label></div>
        <section className="eh-section" hidden={connectionFilter==='pages'||connectionFilter==='mentions'}><h2>{uiText('Connected entities')} <span>{connectionRows.length}</span></h2><EntityConnections items={filteredEntities} entities={entities} onOpen={onOpen} empty={uiText('No matching connected entities.')}/></section>
        <details hidden={connectionFilter==='pages'||connectionFilter==='mentions'} className="eh-section"><summary>{uiText('Edit relationships')}</summary><RelationshipEditor entity={entity} entities={entities} mention={mention} onSave={(input, relationId) => mutate(() => api.saveRelationship(vaultId, id, input, relationId))} onRemove={relationId => mutate(() => api.removeConnection(vaultId, id, 'relationships', relationId))}/></details>
        </div>
        </>}
        {!entity.previewLimited && <>
        <div hidden={connectionFilter==='entities'}><EntityPages showConnect={false} queryFilter={connectionQuery} mentionsOnly={connectionFilter==='mentions'} onOpenMention={onOpenMention} key={'pages:' + vaultId + ':' + id} entity={entity} pages={pages} onOpenPage={onOpenPage} onAssociate={(pageId, input) => mutate(() => api.associateEntityPage(vaultId, id, pageId, input))} onRemove={pageId => mutate(() => api.removeEntityPage(vaultId, id, pageId))} onCreatePage={onCreatePage}/>
        </div>
        </>}
        <button type="button" className="eh-text-action" aria-expanded={discoveryOpen} onClick={()=>{setDiscoveryLoaded(true);setDiscoveryOpen(value=>!value);}}>{uiText('Find connections')}</button>
        <div hidden={!discoveryOpen}>{discoveryLoaded && <EntityDiscovery key={vaultId+':'+id} vaultId={vaultId} id={id} refreshKey={refreshKey} onUpdated={async()=>{await onUpdated();await mutate(()=>api.entity(vaultId,id));}} onOpenEntity={onOpen} onOpenPage={onOpenPage} onOpenMention={onOpenMention} onOpenSourcePassage={onOpenSourcePassage}/>}</div>
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-evidence" role="tabpanel" aria-labelledby="entity-home-tab-evidence" hidden={tab !== 'evidence'} tabIndex={0}>
        {tab === 'evidence' && <EntitySourceEvidence key={vaultId + ':' + id} vaultId={vaultId} entityId={id} refreshKey={refreshKey} pages={pages} onReady={restoreScroll} onOpenPage={onOpenPage} onOpenSourcePassage={onOpenSourcePassage}/>}
      </div>
      {manage && <SourceLifecycleDialog vaultId={vaultId} source={entity} onClose={() => setManage(false)} onUpdated={async () => {await onUpdated(); const value = await api.entity(vaultId, id); if (sameEntity()) setEntity(value);}}/>}
    </>}
  </div></article>;
}
