import {Fragment, useEffect, useRef, useState, type ReactNode} from 'react';
import {entityHomeTemplate, type EntityHomeSection} from './entity-home-template';
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
const tabLabels = {overview:'Overview', connections:'Connections', mentions:'Mentions', sources:'Sources', discovery:'Discovery', edit:'Edit'};

/** A destination for a knowledge subject, backed by the same record and drafts as its inspector. */
export function EntityHome({vaultId, id, entities, refreshKey, onOpen, onInspect, onOpenPage, onOpenMention, onOpenSourcePassage, onUpdated, onError, onClose, pages = [], onCreatePage}: EntityHomeProps) {
  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<HomeTab>(() => hasEntityDraft(vaultId, id) ? 'edit' : 'overview');
  const [manage, setManage] = useState(false);
  const [exploring, setExploring] = useState(false);
  const current = useRef({vaultId, id}); current.current = {vaultId, id};
  const {schema, error: schemaError} = useEntitySchema(vaultId);
  useEffect(() => {setEntity(null); setPageError(''); setManage(false); setExploring(false); setTab(hasEntityDraft(vaultId, id) ? 'edit' : 'overview');}, [vaultId, id]);
  useEffect(() => {
    let active = true; setError('');
    void api.entity(vaultId, id).then(value => {if (active) setEntity(value);}).catch(value => {if (active) setError(String(value));});
    return () => {active = false;};
  }, [vaultId, id, refreshKey]);
  const sameEntity = () => current.current.vaultId === vaultId && current.current.id === id;
  async function mutate(work: () => Promise<EntityDetail>) {
    try {const result = await work(); if (sameEntity()) setEntity(result); void onUpdated().catch(onError); return result;}
    catch (value) {onError(value); throw value;}
  }
  function switchTab(value: HomeTab) {
    setTab(value);
    document.getElementById('entity-home-tab-' + value)?.focus({preventScroll:true});
  }
  const relationships: EntityConnection[] = entity?.relationships.map(relation => ({key:relation.id, target:relation.source_id === id ? relation.target_id : relation.source_id, label:(relation.source_id === id ? 'Outgoing · ' : 'Incoming · ') + relation.label})) ?? [];
  const references: EntityConnection[] = entity?.properties.filter(property => property.target_id).map(property => ({key:property.id, target:property.target_id!, label:property.name})) ?? [];
  const incoming: EntityConnection[] = entity?.incomingProperties.map(property => ({key:property.id, target:property.entity_id, label:'Referenced via ' + property.name})) ?? [];
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
  return <article className="entity-home" aria-label={uiText('Entity homepage')}><div className="eh-document">
    {!entity ? <p role={error ? 'alert' : 'status'}>{error || uiText('Loading entity…')}</p> : <>
      <header className="eh-header">
        {onClose && <button type="button" className="eh-breadcrumb" onClick={onClose}>{uiText('Knowledge entities')}</button>}
        <div className="eh-classification"><Icon name={entity.type}/><span>{uiText(entityLabels[entity.type])}{subtypes.length ? ' · ' + subtypes.join(' · ') : ''}</span></div>
        <h1>{entity.name}</h1>
        {!!entity.domainIds?.length && <p className="eh-domains">{entity.domainIds.map(domainBreadcrumb).join(' · ')}</p>}
        <div className="eh-counts"><button type="button" onClick={() => switchTab('mentions')}>{pageCount} {uiText(pageCount === 1 ? 'page' : 'pages')}</button><button type="button" onClick={() => switchTab('connections')}>{connectionCount} {uiText(connectionCount === 1 ? 'connection' : 'connections')}</button></div>
        <div className="eh-lifecycle">{entity.archived_at && <span role="status"><Icon name="archive"/>{uiText('Archived')}</span>}<button type="button" aria-haspopup="dialog" onClick={() => setManage(true)}>{uiText(entity.archived_at ? 'Restore…' : 'Archive…')}</button></div>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="eh-tabs" role="tablist" aria-label={uiText('Entity homepage sections')}>{tabs.map((value,index) => <button key={value} type="button" id={'entity-home-tab-' + value} role="tab" aria-selected={tab === value} aria-controls={'entity-home-panel-' + value} tabIndex={tab === value ? 0 : -1} onClick={() => switchTab(value)} onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        switchTab(tabs[next]!);
      }}>{uiText(tabLabels[value])}</button>)}</div>
      <div className="eh-tabpanel" id="entity-home-panel-overview" role="tabpanel" aria-labelledby="entity-home-tab-overview" hidden={tab !== 'overview'} tabIndex={0}>
        {entity.description && <p className="eh-description eh-short-description">{entity.description}</p>}
        {template.sections.map(section=><Fragment key={section}>{({
          overview: <EntityOverview guidance={template.overviewGuidance} key={vaultId + ':' + id} vaultId={vaultId} entity={entity} onSave={input => mutate(() => api.saveEntityOverview(vaultId, id, input))} onRefresh={() => mutate(() => api.entity(vaultId, id))}/>,
          pages: <EntityPages key={'pages:' + vaultId + ':' + id} entity={entity} pages={pages} onOpenPage={onOpenPage} onAssociate={(pageId, input) => mutate(() => api.associateEntityPage(vaultId, id, pageId, input))} onRemove={pageId => mutate(() => api.removeEntityPage(vaultId, id, pageId))} onCreatePage={onCreatePage}/>,
          properties: <section className="eh-section"><h2>{uiText(template.detailsTitle)}</h2>{entity.properties.length ? <dl className="entity-overview-properties">{[...entity.properties].sort((left,right)=>{const rank=(name:string)=>{const index=template.prominentProperties.indexOf(name.toLowerCase());return index<0?999:index;};return rank(left.name)-rank(right.name);}).map(property => <div key={property.id}><dt>{property.name}</dt><dd>{property.target_id ? <EntityReference id={property.target_id} entities={entities} onOpen={onOpen}/> : property.value}</dd></div>)}</dl> : <p className="entity-detail-empty">{uiText('No details recorded yet.')}</p>}<button type="button" className="eh-text-action" onClick={()=>switchTab('edit')}>{uiText('Edit details')}</button></section>,
          aliases: !!entity.aliases?.length && <section className="eh-section"><h2>{uiText('Also known as')}</h2><ul className="entity-overview-aliases">{entity.aliases.map(alias => <li key={alias}>{alias}</li>)}</ul></section>,
          connections: <Fragment><section className="eh-section"><h2>{uiText('Related knowledge')}</h2><EntityConnections items={relationships.slice(0, 5)} entities={entities} onOpen={onOpen} empty={uiText('No relationships yet.')}/>{!!connectionCount && <button type="button" className="entity-detail-more" onClick={() => switchTab('connections')}>{uiText('View all connections')}<Icon name="chevron"/></button>}</section>
        <div className="eh-overview-links"><button type="button" onClick={() => switchTab('mentions')}>{uiText('Mentioned in pages')} · {pageMentions.length}<Icon name="chevron"/></button></div></Fragment>,
        } satisfies Record<EntityHomeSection, ReactNode>)[section]}</Fragment>)}
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-connections" role="tabpanel" aria-labelledby="entity-home-tab-connections" hidden={tab !== 'connections'} tabIndex={0}>
        <div className="eh-overview-links"><button type="button" aria-expanded={exploring} onClick={()=>setExploring(value=>!value)}>{uiText(exploring?'Show grouped connections':'Explore neighborhood')}</button></div>
        {exploring && <EntityNeighborhood vaultId={vaultId} id={id} refreshKey={refreshKey} onOpen={onOpen} onInspect={onInspect}/>}
        <div hidden={exploring}>
        <section className="eh-section"><h2>{uiText('Relationships')} <span>{relationships.length}</span></h2><EntityConnections items={relationships} entities={entities} onOpen={onOpen} empty={uiText('No relationships yet.')}/></section>
        <section className="eh-section"><h2>{uiText('Referenced entities')} <span>{references.length}</span></h2><EntityConnections items={references} entities={entities} onOpen={onOpen} empty={uiText('No entity references in properties.')}/></section>
        <section className="eh-section"><h2>{uiText('Referenced by')} <span>{incoming.length}</span></h2><EntityConnections items={incoming} entities={entities} onOpen={onOpen} empty={uiText('No other entities reference this one yet.')}/></section>
        <button type="button" className="button" onClick={() => switchTab('edit')}>{uiText('Edit connections')}</button>
        </div>
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-mentions" role="tabpanel" aria-labelledby="entity-home-tab-mentions" hidden={tab !== 'mentions'} tabIndex={0}>
        <EntityMentions pages={pageMentions} linkedPages={linkedPages} onOpenPage={onOpenPage} onOpenMention={onOpenMention} onPin={pageId => void pinMention(pageId)} pinning={pinning} error={pageError}/>
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-sources" role="tabpanel" aria-labelledby="entity-home-tab-sources" hidden={tab !== 'sources'} tabIndex={0}>
        {tab === 'sources' && <EntitySourceEvidence key={vaultId + ':' + id} vaultId={vaultId} entityId={id} refreshKey={refreshKey} pages={pages} onOpenPage={onOpenPage} onOpenSourcePassage={onOpenSourcePassage}/>}
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-discovery" role="tabpanel" aria-labelledby="entity-home-tab-discovery" hidden={tab !== 'discovery'} tabIndex={0}>
        {tab==='discovery' && <EntityDiscovery key={vaultId+':'+id} vaultId={vaultId} id={id} refreshKey={refreshKey} onUpdated={onUpdated} onOpenEntity={onOpen} onOpenPage={onOpenPage} onOpenMention={onOpenMention} onOpenSourcePassage={onOpenSourcePassage}/>}
      </div>
      <div className="eh-tabpanel" id="entity-home-panel-edit" role="tabpanel" aria-labelledby="entity-home-tab-edit" hidden={tab !== 'edit'} tabIndex={0}>
        {schemaError && <p role="alert">{schemaError}</p>}
        <section className="eh-section"><h2>{uiText('Entity details')}</h2><EntityDetails idPrefix="entity-home" key={entity.id} vaultId={vaultId} entity={entity} schema={schema} onSave={input => mutate(() => api.updateEntity(vaultId, id, input))}/></section>
        <section className="eh-section"><h2>{uiText('Properties')}</h2><PropertyEditor key={entity.type + JSON.stringify(entity.subtypes)} entity={{...entity, propertyNames}} entities={entities} mention={mention} onSave={(input, propertyId) => mutate(() => api.saveProperty(vaultId, id, input, propertyId))} onRemove={propertyId => mutate(() => api.removeConnection(vaultId, id, 'properties', propertyId))}/></section>
        <section className="eh-section"><h2>{uiText('Relationships')}</h2><RelationshipEditor entity={entity} entities={entities} mention={mention} onSave={(input, relationId) => mutate(() => api.saveRelationship(vaultId, id, input, relationId))} onRemove={relationId => mutate(() => api.removeConnection(vaultId, id, 'relationships', relationId))}/></section>
      </div>
      {manage && <SourceLifecycleDialog vaultId={vaultId} source={entity} onClose={() => setManage(false)} onUpdated={async () => {await onUpdated(); const value = await api.entity(vaultId, id); if (sameEntity()) setEntity(value);}}/>}
    </>}
  </div></article>;
}
