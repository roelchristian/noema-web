import {useContext} from 'react';
import {ReviewDestination} from '../review/review-destination';
import {PropertyProposalReview} from './PropertyProposalReview';
import {EntityPropertyList} from './EntityPropertyList';
import {propertyLabel,resolvePropertyDefinition} from '../../shared/property-definitions';
import {TemporalPropertyValue} from './TemporalPropertyValue';
import {EntityReference, EntityConnections, EntityDetails, PropertyEditor, RelationshipEditor, type EntityConnection} from './EntityDetails';
import {SourceLifecycleDialog} from './SourceLifecycleDialog';
import {t as uiText} from '../i18n';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {TitleText} from '../components/TitleText';
import {SourceInspectorStatus} from './SourceInspectorStatus';
import {SourceLoadingProgress} from './SourceLoadingProgress';
import {SummaryText} from '../intelligence/SummaryText';
import { PageIcon } from '../components/PageIcon';
import { SourceAttachments } from './SourceAttachments';
import {domainBreadcrumb} from './DomainPicker';
import { useEntitySchema } from './useEntitySchema';
import { inheritedPropertyNames } from '../../shared/entity-schema';
import { useEffect, useRef, useState } from 'react';
import {hasEntityDraft} from './entity-drafts';
import { api } from '../api';
import { entityLabels, type Entity, type EntityDetail } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Mention } from '../components/Mention';
export interface EntityPanelProps {onOpenHome?: (id: string) => void;activeAttachmentId?:string;inspectorTab?:EntityTab;onInspectorTabChange?:(tab:EntityTab)=>void;inspector?: boolean;onCreatePageFromSource:(source:Entity)=>void;onOpenPage: (id: string) => void; refreshKey: string; vaultId: string; id: string; entities: Entity[]; onOpen: (id: string) => void; onClose: () => void; onUpdated: () => Promise<void>; onError: (error: unknown) => void}
const entityTabs = [{id: 'overview', label: uiText("Overview"), icon:'page'}, {id: 'connections', label: uiText("Connections"), icon:'knowledge'}, {id: 'edit', get label(){return uiText("Edit")}, icon:'edit'}] as const;
type EntityTab = typeof entityTabs[number]['id'];
export function EntityPanel(props: EntityPanelProps) {
  const {vaultId, id, entities, onOpen, onClose, onUpdated, onError, onOpenPage, refreshKey, inspector = false} = props;
  const destination=useContext(ReviewDestination),proposalId=destination?.category==='property'&&destination.originId===id?destination.proposalId:undefined;
  const [manage,setManage]=useState(false);
  const [entity, setEntity] = useState<EntityDetail | null>(null), [loadingError, setLoadingError] = useState('');
  const [localTab, setTab] = useState<EntityTab>(() => hasEntityDraft(vaultId, id) ? 'edit' : 'overview');
  const tab = inspector ? props.inspectorTab ?? localTab : localTab;
  const [showAllMentions, setShowAllMentions] = useState(false);
  const currentEntityKey = useRef({vaultId, id}); currentEntityKey.current = {vaultId, id};
  useEffect(() => {setEntity(null); setTab(hasEntityDraft(vaultId, id) ? 'edit' : 'overview');}, [vaultId, id]);
  useEffect(() => {
    let active = true; setLoadingError('');
    void api.entity(vaultId, id).then(e => { if (active) setEntity(e); }).catch(error => { if (active) setLoadingError(String(error)); });
    return () => { active = false; };
  }, [vaultId, id, refreshKey]);
  const sourceBusy=entity?.type==='source'&&entity.attachments?.some(file=>file.status==='queued'||file.status==='processing'||file.status==='ready'&&['pending','running'].includes(file.enrichment_status));
  useEffect(()=>{
    if(!sourceBusy||tab==='edit')return;
    let active=true;
    const timer=setInterval(()=>{void api.entity(vaultId,id).then(value=>{if(active)setEntity(value);}).catch(()=>{});},2000);
    return()=>{active=false;clearInterval(timer);};
  },[vaultId,id,sourceBusy,tab]);
  const {schema, error: schemaError} = useEntitySchema(vaultId);
  const mention = (entityId: string) => <Mention id={entityId} entities={entities} onOpen={onOpen}/>;
  async function mutate(work: () => Promise<EntityDetail>) {
    try { const result = await work(); if(currentEntityKey.current.vaultId===vaultId&&currentEntityKey.current.id===id)setEntity(result); void onUpdated().catch(onError); return result; } catch (error) { onError(error); throw error; }
  }
  const relationships: EntityConnection[] = entity?.relationships.map(relation => ({key: relation.id, target: relation.source_id === id ? relation.target_id : relation.source_id, label: relation.source_id === id ? relation.label : 'Incoming · ' + relation.label})) ?? [];
  const propertyDisplayLabel=(property:import('../../shared/domain').Property)=>{const owner=property.entity_id===id?entity:entities.find(item=>item.id===property.entity_id);return owner?resolvePropertyDefinition(schema.propertyDefinitions,owner.type,owner.subtypes,property.name,property.metadata?.definition_id)?.label??propertyLabel(property.name):propertyLabel(property.name);};
  const references: EntityConnection[] = entity?.properties.filter(property => property.target_id).map(property => ({key: property.id, target: property.target_id!, label: propertyDisplayLabel(property)})) ?? [];
  const incoming: EntityConnection[] = entity?.incomingProperties.map(property => ({key: property.id, target: property.entity_id, label: 'Referenced via ' + propertyDisplayLabel(property)})) ?? [];
  const subtypeNames = schema.subtypes.filter(subtype => entity?.subtypes.includes(subtype.id)).map(subtype => subtype.name);
  const propertyNames = entity ? [...new Map([...entity.propertyNames, ...inheritedPropertyNames(schema,entity.type,entity.subtypes)].map(name => [name.toLowerCase(),name])).values()] : [];
  function switchTab(next: EntityTab) {
    setTab(next);
    if(inspector)props.onInspectorTabChange?.(next);
    document.getElementById('entity-panel')?.scrollTo({top: 0});
    document.getElementById('entity-tab-' + next)?.focus({preventScroll: true});
  }
  const attachment = entity?.attachments?.find(file=>file.id===props.activeAttachmentId)
    ?? entity?.attachments?.find(file=>file.status==='ready'&&file.admitted===1) ?? entity?.attachments?.[0];
  const connectionCount = relationships.length + references.length + incoming.length;
  const pageMentions = entity?.pageMentions ?? [];
  const mentionsSection = <section className="entity-detail-section entity-mentions-section"><h3>{inspector ? uiText("Mentioned in pages") : uiText("Mentions from pages")}<span>{pageMentions.length}</span></h3>
    {pageMentions.length ? <><ul className="entity-connection-list entity-page-mentions">{((inspector||props.onOpenHome)&&!showAllMentions?pageMentions.slice(0,4):pageMentions).map(page=><li key={page.id}>
      <button type="button" onClick={()=>onOpenPage(page.id)}><PageIcon icon={page.icon}/><span><span className="entity-mention-heading"><strong title={page.title||uiText("Untitled")}><TitleText text={page.title||'Untitled'}/></strong><small className="entity-mention-count" aria-label={`${page.mentionCount} ${page.mentionCount===1?'mention':'mentions'}`}>{page.mentionCount}×</small></span>{page.excerpt&&<small className="entity-mention-excerpt" title={page.excerpt}>{page.excerpt}</small>}</span><Icon name="chevron"/></button>
    </li>)}</ul>{(inspector||props.onOpenHome)&&pageMentions.length>4&&<button type="button" className="entity-detail-more" aria-expanded={showAllMentions} onClick={()=>setShowAllMentions(value=>!value)}>{showAllMentions?uiText("Show fewer pages"):uiText("View all {value0} pages",{value0: pageMentions.length})}</button>}</> : <p className="entity-detail-empty">{inspector?uiText("No pages reference this source yet. Add a passage to a page while reading to connect your notes."):uiText("No pages mention this entity yet. Tag it in a page to see it here.")}</p>}
  </section>;
  const tabNavigation = <div className="entity-detail-tabs" role="tablist" aria-label={inspector ? uiText("Source details") : uiText("Entity details")}>
        {entityTabs.map(({id: value, label,icon}) => <button type="button" key={value} id={'entity-tab-' + value} role="tab" aria-selected={tab === value} aria-controls={'entity-tabpanel-' + value} tabIndex={tab === value ? 0 : -1} onClick={() => switchTab(value)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = entityTabs.findIndex(item => item.id === value);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? entityTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + entityTabs.length) % entityTabs.length;
          switchTab(entityTabs[next]!.id);
        }}><Icon name={icon}/>{inspector && value === 'edit' ? uiText("Details") : label}</button>)}
      </div>;
  const panelToolbar = <div className="panel-top entity-detail-toolbar">
    {entity ? <div className="entity-toolbar-heading"><span className="entity-detail-icon" aria-hidden="true"><Icon name={entity.type}/></span><div className="entity-toolbar-identity">{inspector&&<span className="source-inspector-eyebrow">{uiText("Source")}</span>}<h2 id="entity-detail-title" className="entity-toolbar-title" title={entity.name}>{entity.name}</h2></div></div> : <span>{inspector ? uiText("SOURCE INSPECTOR") : uiText("KNOWLEDGE ENTITY")}</span>}
    <button type="button" title={inspector ? uiText("Close source inspector") : uiText("Close entity")} aria-label={inspector ? uiText("Close source inspector") : uiText("Close entity")} onClick={onClose}><Icon name="close"/></button>
  </div>;
  return <aside id="entity-panel" className={"entity-panel entity-detail-panel entity-editor-panel" + (inspector ? " source-inspector" : "")} data-entity-tab={tab} aria-label={inspector ? uiText("Source inspector") : uiText("Knowledge entity")}>{inspector?<div className="source-inspector-header">{panelToolbar}{entity&&tabNavigation}</div>:panelToolbar}
    {!entity ? <p className="panel-body" role={loadingError ? 'alert' : 'status'}>{loadingError || (inspector?uiText("Loading source…"):uiText("Loading entity…"))}</p> : <div className="panel-body entity-detail-body">
      {loadingError && <p role="alert">{loadingError}</p>}
      {!inspector&&tab!=='edit'&&entity.attachments?.map(file=><SourceLoadingProgress key={file.id} file={file}/>)}
      {!inspector&&<div className="entity-detail-classification"><span className="entity-detail-type">{uiText(entityLabels[entity.type])}</span>{entity.type==='source'&&<span>{entity.attachments?.some(file=>file.status==='queued'||file.status==='processing')?uiText("Processing"):entity.inactive?uiText("Inactive"):entity.sourceEnrichmentStatus==='pending'||entity.sourceEnrichmentStatus==='running'?uiText("Processed · Enriching with AI"):entity.sourceEnrichmentStatus==='failed'?uiText("Processed · AI enrichment failed"):uiText("Processed")}</span>}{!!subtypeNames.length && <span>{subtypeNames.join(' · ')}</span>}</div>}
      <div className="entity-lifecycle-controls">{entity.archived_at&&<span className="entity-archived-status" role="status"><Icon name="archive"/>{uiText("Archived")}</span>}<button type="button" className="entity-lifecycle-action" aria-haspopup="dialog" onClick={()=>setManage(true)}><Icon name={entity.archived_at?'undo':'archive'}/>{entity.archived_at?uiText("Restore…"):uiText("Archive…")}</button></div>
      {manage&&<SourceLifecycleDialog vaultId={vaultId} source={entity} onClose={()=>setManage(false)} onUpdated={async()=>{await onUpdated();setEntity(await api.entity(vaultId,id));}}/>}
      {!inspector && props.onOpenHome && <div className="entity-preview-navigation"><p>{pageMentions.length} {uiText(pageMentions.length===1?"page":"pages")} · {connectionCount} {uiText(connectionCount===1?"connection":"connections")}</p><button type="button" className="button" onClick={() => props.onOpenHome?.(id)}>{uiText("Open entity homepage")}<Icon name="chevron"/></button></div>}
      {!inspector && tabNavigation}
      <div id="entity-tabpanel-overview" className="entity-detail-tabpanel" role="tabpanel" aria-labelledby="entity-tab-overview" hidden={tab !== 'overview'} tabIndex={0}>
      {inspector&&<>
        <SourceInspectorStatus files={entity.attachments??[]} vaultId={vaultId} onError={onError} onChange={file=>{
          setEntity(current=>current?{...current,attachments:current.attachments?.map(item=>item.id===file.id?file:item)}:current);
          void onUpdated().catch(onError);
        }}/>
        {attachment&&<SourceInspectorSummary key={attachment.id} name={attachment.generated_name||attachment.name} summary={attachment.summary}/>}
        {entity.description&&<section className="entity-detail-section"><h3>{uiText("Description")}</h3><p className="entity-detail-description">{entity.description}</p></section>}
        <section className="entity-detail-section source-inspector-metadata"><h3>{uiText("Source details")}<button type="button" className="entity-detail-more" onClick={()=>switchTab('edit')}>{uiText("Edit")}<Icon name="edit"/></button></h3>
          <dl className="entity-overview-properties">
            {!!subtypeNames.length&&<div><dt>{uiText("Type")}</dt><dd>{subtypeNames.join(' · ')}</dd></div>}
            {attachment&&<><div><dt>{uiText("Format")}</dt><dd>{attachment.format.toUpperCase()}{attachment.pages?uiText(" · {value0} pages",{value0: attachment.pages}):''}</dd></div>{attachment.language&&<div><dt>{uiText("Language")}</dt><dd>{attachment.language}</dd></div>}</>}
          </dl>
          <EntityPropertyList active={tab==='overview'} definitions={schema.propertyDefinitions} key={vaultId + ':' + id + ':source'} density="source" vaultId={vaultId} entity={{...entity,propertyNames}} entities={entities} mention={mention} onSave={(input,propertyId)=>mutate(()=>api.saveProperty(vaultId,id,input,propertyId))} onRemove={propertyId=>mutate(()=>api.removeConnection(vaultId,id,'properties',propertyId))} onRefresh={()=>mutate(()=>api.entity(vaultId,id))}/>
        </section>
        {(!!entity.propertyProposalCount||proposalId)&&<PropertyProposalReview proposalId={proposalId} key={vaultId+':'+id+':review'} vaultId={vaultId} entityId={id} entities={entities} onUpdated={async()=>{await mutate(()=>api.entity(vaultId,id));}}/>}
        <nav className="source-inspector-links" aria-label={uiText("Source connections")}>
          <button type="button" onClick={()=>switchTab('connections')}><Icon name="page"/><span>{uiText("Mentioned in") + " "}{pageMentions.length} {pageMentions.length===1?uiText("page"):uiText("pages")}</span><Icon name="chevron"/></button>
          <button type="button" onClick={()=>switchTab('connections')}><Icon name="knowledge"/><span>{connectionCount} {connectionCount===1?uiText("connection"):uiText("connections")}</span><Icon name="chevron"/></button>
        </nav>
      </>}
      {!inspector&&<>
      {!inspector&&entity.type==='source'&&<div className="entity-source-workflow"><button type="button" className="button" disabled={!!entity.archived_at||entity.inactive||entity.sourceStatus!=='ready'} onClick={()=>props.onCreatePageFromSource(entity)}><Icon name="sparkles"/>{uiText("Create page from source")}</button>{entity.sourceStatus!=='ready'&&<p className="section-hint">{entity.inactive?uiText("Retry source processing before creating a page."):uiText("Available once source processing finishes.")}</p>}</div>}
      {entity.type==='source'&&entity.attachments?.map(file=><div key={file.id}>{file.language&&<p className="section-hint">{uiText("Language:") + " "}{file.language}</p>}{file.summary&&<div className="ai-summary-text"><SummaryText text={file.summary}/></div>}</div>)}
      {entity.description && <p className="entity-detail-description">{entity.description}</p>}
        {entity.type==='concept' && <section className="entity-detail-section"><h3>{uiText("Disciplines")}</h3><p className="section-hint">{entity.domainIds?.length ? entity.domainIds.map(domainBreadcrumb).join(' · ') : uiText("No disciplines selected.")}</p></section>}
        <section className="entity-detail-section"><h3>{uiText("Properties")}<span>{entity.properties.length}</span></h3>
          <EntityPropertyList active={tab==='overview'} definitions={schema.propertyDefinitions} key={vaultId + ':' + id} density="compact" vaultId={vaultId} entity={{...entity,propertyNames}} entities={entities} mention={mention} onSave={(input,propertyId)=>mutate(()=>api.saveProperty(vaultId,id,input,propertyId))} onRemove={propertyId=>mutate(()=>api.removeConnection(vaultId,id,'properties',propertyId))} onRefresh={()=>mutate(()=>api.entity(vaultId,id))}/>
        </section>
        {(!!entity.propertyProposalCount||proposalId)&&<PropertyProposalReview proposalId={proposalId} key={vaultId+':'+id+':review'} vaultId={vaultId} entityId={id} entities={entities} onUpdated={async()=>{await mutate(()=>api.entity(vaultId,id));}}/>}
        <section className="entity-detail-section"><h3>{uiText("Related knowledge")}<span>{relationships.length} {relationships.length === 1 ? uiText("connection") : uiText("connections")}</span></h3>
          <EntityConnections items={relationships.slice(0, 4)} entities={entities} onOpen={onOpen} empty="No related knowledge yet."/>
          {!!relationships.length && <button type="button" className="entity-detail-more" onClick={() => switchTab('connections')}>{relationships.length > 4 ? uiText("View all ") + relationships.length + uiText(" connections") : uiText("View connections")}<Icon name="chevron"/></button>}
        </section>
        {mentionsSection}
        {entity.type!=='source' && !!entity.aliases?.length && <section className="entity-detail-section"><h3>{uiText("Also known as")}</h3><ul className="entity-overview-aliases">{entity.aliases.map(alias => <li key={alias}>{alias}</li>)}</ul></section>}
        {entity.type === 'source' && <section className="entity-detail-section"><h3>{uiText("Attached sources")}<span>{entity.attachments?.length ?? 0}</span></h3>
          {entity.attachments?.length ? <ul className="entity-overview-sources">{entity.attachments.map(file => <li key={file.id}>
            {file.admitted===1?<>
              <a href={'/api/source-files/' + encodeURIComponent(file.id) + '/download?vault=' + encodeURIComponent(vaultId)} download><Icon name="source"/><span>{file.name}<small>{(file.size / 1024).toFixed(1)}{" " + uiText("KB")}{file.pdf_flattened===1?uiText(" · Flattened locally"):''}</small></span><Icon name="download"/></a>
              {file.status==='ready'&&file.text.trim()&&<a href={'/api/source-files/' + encodeURIComponent(file.id) + '/download-processed?vault=' + encodeURIComponent(vaultId)} download><Icon name="page"/><span>{uiText("Download processed JSON")}<small>{uiText("Sections, semantic blocks, and physical pages")}</small></span><Icon name="download"/></a>}
            </>:<span>{file.name}<small>{file.status==='failed'?uiText("Inactive — processing failed"):uiText("Processing in background…")}</small></span>}
          </li>)}</ul> : <p className="entity-detail-empty">{uiText("No attached files. Add sources in") + " "}{inspector ? uiText("Details") : uiText("Edit")}.</p>}
        </section>}
      </>}
      </div>
      <div id="entity-tabpanel-connections" className="entity-detail-tabpanel" role="tabpanel" aria-labelledby="entity-tab-connections" hidden={tab !== 'connections'} tabIndex={0}>
        {inspector&&mentionsSection}
        <section className="entity-detail-section"><h3>{uiText("Relationships")}<span>{relationships.length}</span></h3>{inspector?<RelationshipEditor entity={entity} entities={entities} mention={mention} onSave={(input,relationId)=>mutate(()=>api.saveRelationship(vaultId,id,input,relationId))} onRemove={relationId=>mutate(()=>api.removeConnection(vaultId,id,'relationships',relationId))}/>:<EntityConnections items={relationships} entities={entities} onOpen={onOpen} empty="No relationships yet."/>}</section>
        <section hidden={inspector&&!references.length} className="entity-detail-section"><h3>{uiText("Referenced entities")}<span>{references.length}</span></h3><EntityConnections items={references} entities={entities} onOpen={onOpen} empty="No entity references in properties."/></section>
        <section hidden={inspector&&!incoming.length} className="entity-detail-section"><h3>{uiText("Referenced by")}<span>{incoming.length}</span></h3><EntityConnections items={incoming} entities={entities} onOpen={onOpen} empty="No other entities reference this one yet."/></section>
        {!inspector&&<button type="button" className="button entity-edit-connections" onClick={()=>switchTab('edit')}>{uiText("Edit connections")}</button>}
        {inspector&&!!(references.length+incoming.length)&&<button type="button" className="entity-detail-more" onClick={()=>switchTab('edit')}>{uiText("Edit property references")}<Icon name="chevron"/></button>}
      </div>
      <div id="entity-tabpanel-edit" className="entity-detail-tabpanel entity-detail-edit" role="tabpanel" aria-labelledby="entity-tab-edit" hidden={tab !== 'edit'} tabIndex={0}>
        {schemaError && <p role="alert">{schemaError}</p>}
        <section className="entity-detail-section entity-identity-section"><EntityDetails vaultId={vaultId} schema={schema} key={vaultId + ':' + entity.id} entity={entity} onSave={async input => {
          let result: EntityDetail;
          try {result = await api.updateEntity(vaultId, id, input);} catch (error) {onError(error); throw error;}
          if (currentEntityKey.current.vaultId === vaultId && currentEntityKey.current.id === id) setEntity(result);
          // The entity is saved even if refreshing the surrounding workspace fails.
          void onUpdated().catch(onError);
          return result;
        }}/></section>
        {entity.type==='source'&&<SourceAttachments compact={inspector} key={entity.id} vaultId={vaultId} entityId={entity.id} initial={entity.attachments} onChange={attachments => {setEntity(current => current ? {...current, attachments,inactive:attachments.some(file=>file.status==='failed'),sourceStatus:attachments[0]?.status,sourceEnrichmentStatus:attachments[0]?.enrichment_status} : current);if(attachments.every(file=>file.status==='failed'||file.status==='ready'&&file.enrichment_status!=='pending'&&file.enrichment_status!=='running'))void api.entity(vaultId,id).then(result=>{setEntity(result);return onUpdated();}).catch(onError);else if(entity.inactive)void onUpdated().catch(onError);}}/>}
        <section className="panel-section"><h3>{uiText("Properties") + " "}<span>{entity.properties.length}</span></h3>
          <PropertyEditor definitions={schema.propertyDefinitions} key={entity.type + JSON.stringify(entity.subtypes)} entity={{...entity, propertyNames}} entities={entities} mention={mention} onSave={(input, propertyId) => mutate(() => api.saveProperty(vaultId, id, input, propertyId))} onRemove={propertyId => mutate(() => api.removeConnection(vaultId, id, 'properties', propertyId))}/>
        </section>
        {!inspector&&<section className="panel-section"><h3>{uiText("Relationships") + " "}<span>{entity.relationships.length}</span></h3>
          <RelationshipEditor entity={entity} entities={entities} mention={mention} onSave={(input, relationId) => mutate(() => api.saveRelationship(vaultId, id, input, relationId))} onRemove={relationId => mutate(() => api.removeConnection(vaultId, id, 'relationships', relationId))}/>
        </section>}
      </div>
    </div>}
  </aside>;
}
function SourceInspectorSummary({name,summary}:{name:string;summary?:string|null}) {
  const [expanded,setExpanded]=useState(false);
  const long=!!summary&&summary.length>600;
  return <section className="entity-detail-section source-inspector-summary"><h3>{uiText("AI summary")}</h3><p className="source-inspector-filename" title={name}>{name}</p>
    {summary?<><div id="source-inspector-summary-text" className={"ai-summary-text"+(long&&!expanded?" is-collapsed":"")}><SummaryText text={summary}/></div>{long&&<button type="button" className="entity-detail-more" aria-expanded={expanded} aria-controls="source-inspector-summary-text" onClick={()=>setExpanded(value=>!value)}>{expanded?uiText("Show less"):uiText("Show more")}</button>}</>:<p className="entity-detail-empty">{uiText("No AI summary available yet.")}</p>}
  </section>;
}
