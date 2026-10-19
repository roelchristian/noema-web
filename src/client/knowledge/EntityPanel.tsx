import {DisclosureSummary} from '../components/DisclosureSummary';
import {TitleText} from '../components/TitleText';
import {SourceInspectorStatus} from './SourceInspectorStatus';
import {SourceLoadingProgress} from './SourceLoadingProgress';
import {SummaryText} from '../intelligence/SummaryText';
import { PageIcon } from '../components/PageIcon';
import { SourceAttachments } from './SourceAttachments';
import {DomainPicker, domainBreadcrumb} from './DomainPicker';
import { SubtypePicker } from './SubtypePicker';
import { useEntitySchema } from './useEntitySchema';
import { inheritedPropertyNames, type EntitySchema } from '../../shared/entity-schema';
import { Select } from '../components/Select';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {clearEntityDraft, entityDraftDirty, entityDraftValues, getEntityDraft, hasEntityDraft, mergeEntityDraft, setEntityDraft, subscribeEntityDrafts, type EntityDraftValues} from './entity-drafts';
import { api } from '../api';
import { entityLabels, entityTypes, type Entity, type EntityDetail, type EntityType, type Property, type Relationship } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Mention } from '../components/Mention';
import { AliasInput, parseAliases } from './AliasInput';
interface Props {activeAttachmentId?:string;inspectorTab?:EntityTab;onInspectorTabChange?:(tab:EntityTab)=>void;inspector?: boolean;onCreatePageFromSource:(source:Entity)=>void;onOpenPage: (id: string) => void; refreshKey: string; vaultId: string; id: string; entities: Entity[]; onOpen: (id: string) => void; onClose: () => void; onUpdated: () => Promise<void>; onError: (error: unknown) => void}
const entityTabs = [{id: 'overview', label: 'Overview', icon:'page'}, {id: 'connections', label: 'Connections', icon:'knowledge'}, {id: 'edit', label: 'Edit', icon:'edit'}] as const;
type EntityTab = typeof entityTabs[number]['id'];
interface EntityConnection {key: string; target: string; label: string}
export function EntityPanel(props: Props) {
  const {vaultId, id, entities, onOpen, onClose, onUpdated, onError, onOpenPage, refreshKey, inspector = false} = props;
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
    try { const result = await work(); setEntity(result); await onUpdated(); } catch (error) { onError(error); throw error; }
  }
  const relationships: EntityConnection[] = entity?.relationships.map(relation => ({key: relation.id, target: relation.source_id === id ? relation.target_id : relation.source_id, label: relation.source_id === id ? relation.label : 'Incoming · ' + relation.label})) ?? [];
  const references: EntityConnection[] = entity?.properties.filter(property => property.target_id).map(property => ({key: property.id, target: property.target_id!, label: property.name})) ?? [];
  const incoming: EntityConnection[] = entity?.incomingProperties.map(property => ({key: property.id, target: property.entity_id, label: 'Referenced via ' + property.name})) ?? [];
  const subtypeNames = schema.subtypes.filter(subtype => entity?.subtypes.includes(subtype.id)).map(subtype => subtype.name);
  const propertyNames = entity ? [...new Map([...entity.propertyNames, ...inheritedPropertyNames(schema,entity.type,entity.subtypes)].map(name => [name.toLowerCase(),name])).values()] : [];
  const unsetProperties = propertyNames.filter(name => !entity?.properties.some(property => property.name.toLowerCase() === name.toLowerCase()));
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
  const mentionsSection = <section className="entity-detail-section entity-mentions-section"><h3>{inspector ? 'Mentioned in pages' : 'Mentions from pages'}<span>{pageMentions.length}</span></h3>
    {pageMentions.length ? <><ul className="entity-connection-list entity-page-mentions">{(inspector&&!showAllMentions?pageMentions.slice(0,4):pageMentions).map(page=><li key={page.id}>
      <button type="button" onClick={()=>onOpenPage(page.id)}><PageIcon icon={page.icon}/><span><span className="entity-mention-heading"><strong title={page.title||'Untitled'}><TitleText text={page.title||'Untitled'}/></strong><small className="entity-mention-count" aria-label={`${page.mentionCount} ${page.mentionCount===1?'mention':'mentions'}`}>{page.mentionCount}×</small></span>{page.excerpt&&<small className="entity-mention-excerpt" title={page.excerpt}>{page.excerpt}</small>}</span><Icon name="chevron"/></button>
    </li>)}</ul>{inspector&&pageMentions.length>4&&<button type="button" className="entity-detail-more" aria-expanded={showAllMentions} onClick={()=>setShowAllMentions(value=>!value)}>{showAllMentions?'Show fewer pages':`View all ${pageMentions.length} pages`}</button>}</> : <p className="entity-detail-empty">{inspector?'No pages reference this source yet. Add a passage to a page while reading to connect your notes.':'No pages mention this entity yet. Tag it in a page to see it here.'}</p>}
  </section>;
  const tabNavigation = <div className="entity-detail-tabs" role="tablist" aria-label={inspector ? "Source details" : "Entity details"}>
        {entityTabs.map(({id: value, label,icon}) => <button type="button" key={value} id={'entity-tab-' + value} role="tab" aria-selected={tab === value} aria-controls={'entity-tabpanel-' + value} tabIndex={tab === value ? 0 : -1} onClick={() => switchTab(value)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = entityTabs.findIndex(item => item.id === value);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? entityTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + entityTabs.length) % entityTabs.length;
          switchTab(entityTabs[next]!.id);
        }}><Icon name={icon}/>{inspector && value === 'edit' ? 'Details' : label}</button>)}
      </div>;
  const panelToolbar = <div className="panel-top entity-detail-toolbar">
    {entity ? <div className="entity-toolbar-heading"><span className="entity-detail-icon" aria-hidden="true"><Icon name={entity.type}/></span><div className="entity-toolbar-identity">{inspector&&<span className="source-inspector-eyebrow">Source</span>}<h2 id="entity-detail-title" className="entity-toolbar-title" title={entity.name}>{entity.name}</h2></div></div> : <span>{inspector ? "SOURCE INSPECTOR" : "KNOWLEDGE ENTITY"}</span>}
    <button type="button" title={inspector ? "Close source inspector" : "Close entity"} aria-label={inspector ? "Close source inspector" : "Close entity"} onClick={onClose}><Icon name="close"/></button>
  </div>;
  return <aside id="entity-panel" className={"entity-panel entity-detail-panel entity-editor-panel" + (inspector ? " source-inspector" : "")} data-entity-tab={tab} aria-label={inspector ? "Source inspector" : "Knowledge entity"}>{inspector?<div className="source-inspector-header">{panelToolbar}{entity&&tabNavigation}</div>:panelToolbar}
    {!entity ? <p className="panel-body" role={loadingError ? 'alert' : 'status'}>{loadingError || (inspector?'Loading source…':'Loading entity…')}</p> : <div className="panel-body entity-detail-body">
      {loadingError && <p role="alert">{loadingError}</p>}
      {!inspector&&tab!=='edit'&&entity.attachments?.map(file=><SourceLoadingProgress key={file.id} file={file}/>)}
      {!inspector&&<div className="entity-detail-classification"><span className="entity-detail-type">{entityLabels[entity.type]}</span>{entity.type==='source'&&<span>{entity.attachments?.some(file=>file.status==='queued'||file.status==='processing')?'Processing':entity.inactive?'Inactive':entity.sourceEnrichmentStatus==='pending'||entity.sourceEnrichmentStatus==='running'?'Processed · Enriching with AI':entity.sourceEnrichmentStatus==='failed'?'Processed · AI enrichment failed':'Processed'}</span>}{!!subtypeNames.length && <span>{subtypeNames.join(' · ')}</span>}</div>}
      {!inspector && tabNavigation}
      <div id="entity-tabpanel-overview" className="entity-detail-tabpanel" role="tabpanel" aria-labelledby="entity-tab-overview" hidden={tab !== 'overview'} tabIndex={0}>
      {inspector&&<>
        <SourceInspectorStatus files={entity.attachments??[]} vaultId={vaultId} onError={onError} onChange={file=>{
          setEntity(current=>current?{...current,attachments:current.attachments?.map(item=>item.id===file.id?file:item)}:current);
          void onUpdated().catch(onError);
        }}/>
        {attachment&&<SourceInspectorSummary key={attachment.id} name={attachment.generated_name||attachment.name} summary={attachment.summary}/>}
        {entity.description&&<section className="entity-detail-section"><h3>Description</h3><p className="entity-detail-description">{entity.description}</p></section>}
        <section className="entity-detail-section source-inspector-metadata"><h3>Source details<button type="button" className="entity-detail-more" onClick={()=>switchTab('edit')}>Edit<Icon name="edit"/></button></h3>
          <dl className="entity-overview-properties">
            {!!subtypeNames.length&&<div><dt>Type</dt><dd>{subtypeNames.join(' · ')}</dd></div>}
            {attachment&&<><div><dt>Format</dt><dd>{attachment.format.toUpperCase()}{attachment.pages?` · ${attachment.pages} pages`:''}</dd></div>{attachment.language&&<div><dt>Language</dt><dd>{attachment.language}</dd></div>}</>}
            {entity.properties.filter(property=>!property.target_id).slice(0,5).map(property=><div key={property.id}><dt>{property.name}</dt><dd>{property.value}</dd></div>)}
          </dl>
          {!attachment&&!entity.properties.length&&!subtypeNames.length&&<p className="entity-detail-empty">Add source details to make this reference easier to find.</p>}
          {entity.properties.filter(property=>!property.target_id).length>5&&<details className="source-inspector-disclosure"><DisclosureSummary>More metadata</DisclosureSummary><dl className="entity-overview-properties">{entity.properties.filter(property=>!property.target_id).slice(5).map(property=><div key={property.id}><dt>{property.name}</dt><dd>{property.value}</dd></div>)}</dl></details>}
        </section>
        <nav className="source-inspector-links" aria-label="Source connections">
          <button type="button" onClick={()=>switchTab('connections')}><Icon name="page"/><span>Mentioned in {pageMentions.length} {pageMentions.length===1?'page':'pages'}</span><Icon name="chevron"/></button>
          <button type="button" onClick={()=>switchTab('connections')}><Icon name="knowledge"/><span>{connectionCount} {connectionCount===1?'connection':'connections'}</span><Icon name="chevron"/></button>
        </nav>
      </>}
      {!inspector&&<>
      {!inspector&&entity.type==='source'&&<div className="entity-source-workflow"><button type="button" className="button" disabled={entity.inactive||entity.sourceStatus!=='ready'} onClick={()=>props.onCreatePageFromSource(entity)}><Icon name="sparkles"/>Create page from source</button>{entity.sourceStatus!=='ready'&&<p className="section-hint">{entity.inactive?'Retry source processing before creating a page.':'Available once source processing finishes.'}</p>}</div>}
      {entity.type==='source'&&entity.attachments?.map(file=><div key={file.id}>{file.language&&<p className="section-hint">Language: {file.language}</p>}{file.summary&&<div className="ai-summary-text"><SummaryText text={file.summary}/></div>}</div>)}
      {entity.description && <p className="entity-detail-description">{entity.description}</p>}
        {entity.type==='concept' && <section className="entity-detail-section"><h3>Disciplines</h3><p className="section-hint">{entity.domainIds?.length ? entity.domainIds.map(domainBreadcrumb).join(' · ') : 'No disciplines selected.'}</p></section>}
        <section className="entity-detail-section"><h3>Properties<span>{entity.properties.length + unsetProperties.length}</span></h3>
          {entity.properties.length || unsetProperties.length ? <dl className="entity-overview-properties">{entity.properties.map(property => <div key={property.id}><dt>{property.name}</dt><dd>{property.target_id ? <EntityReference id={property.target_id} entities={entities} onOpen={onOpen}/> : property.value}</dd></div>)}{unsetProperties.map(name => <div key={'unset-' + name}><dt>{name}</dt><dd><button type="button" onClick={() => switchTab('edit')}>Not set</button></dd></div>)}</dl> : <p className="entity-detail-empty">No inherited fields yet. Define properties on a subtype in Settings → Knowledge Entities.</p>}
        </section>
        <section className="entity-detail-section"><h3>Related knowledge<span>{relationships.length} {relationships.length === 1 ? 'connection' : 'connections'}</span></h3>
          <EntityConnections items={relationships.slice(0, 4)} entities={entities} onOpen={onOpen} empty="No related knowledge yet."/>
          {!!relationships.length && <button type="button" className="entity-detail-more" onClick={() => switchTab('connections')}>{relationships.length > 4 ? 'View all ' + relationships.length + ' connections' : 'View connections'}<Icon name="chevron"/></button>}
        </section>
        {mentionsSection}
        {entity.type!=='source' && !!entity.aliases?.length && <section className="entity-detail-section"><h3>Also known as</h3><ul className="entity-overview-aliases">{entity.aliases.map(alias => <li key={alias}>{alias}</li>)}</ul></section>}
        {entity.type === 'source' && <section className="entity-detail-section"><h3>Attached sources<span>{entity.attachments?.length ?? 0}</span></h3>
          {entity.attachments?.length ? <ul className="entity-overview-sources">{entity.attachments.map(file => <li key={file.id}>
            {file.admitted===1?<>
              <a href={'/api/source-files/' + encodeURIComponent(file.id) + '/download?vault=' + encodeURIComponent(vaultId)} download><Icon name="source"/><span>{file.name}<small>{(file.size / 1024).toFixed(1)} KB{file.pdf_flattened===1?' · Flattened locally':''}</small></span><Icon name="download"/></a>
              {file.status==='ready'&&file.text.trim()&&<a href={'/api/source-files/' + encodeURIComponent(file.id) + '/download-processed?vault=' + encodeURIComponent(vaultId)} download><Icon name="page"/><span>Download processed JSON<small>Sections, semantic blocks, and physical pages</small></span><Icon name="download"/></a>}
            </>:<span>{file.name}<small>{file.status==='failed'?'Inactive — processing failed':'Processing in background…'}</small></span>}
          </li>)}</ul> : <p className="entity-detail-empty">No attached files. Add sources in {inspector ? 'Details' : 'Edit'}.</p>}
        </section>}
      </>}
      </div>
      <div id="entity-tabpanel-connections" className="entity-detail-tabpanel" role="tabpanel" aria-labelledby="entity-tab-connections" hidden={tab !== 'connections'} tabIndex={0}>
        {inspector&&mentionsSection}
        <section className="entity-detail-section"><h3>Relationships<span>{relationships.length}</span></h3>{inspector?<RelationshipEditor entity={entity} entities={entities} mention={mention} onSave={(input,relationId)=>mutate(()=>api.saveRelationship(vaultId,id,input,relationId))} onRemove={relationId=>mutate(()=>api.removeConnection(vaultId,id,'relationships',relationId))}/>:<EntityConnections items={relationships} entities={entities} onOpen={onOpen} empty="No relationships yet."/>}</section>
        <section hidden={inspector&&!references.length} className="entity-detail-section"><h3>Referenced entities<span>{references.length}</span></h3><EntityConnections items={references} entities={entities} onOpen={onOpen} empty="No entity references in properties."/></section>
        <section hidden={inspector&&!incoming.length} className="entity-detail-section"><h3>Referenced by<span>{incoming.length}</span></h3><EntityConnections items={incoming} entities={entities} onOpen={onOpen} empty="No other entities reference this one yet."/></section>
        {!inspector&&<button type="button" className="button entity-edit-connections" onClick={()=>switchTab('edit')}>Edit connections</button>}
        {inspector&&!!(references.length+incoming.length)&&<button type="button" className="entity-detail-more" onClick={()=>switchTab('edit')}>Edit property references<Icon name="chevron"/></button>}
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
        <section className="panel-section"><h3>Properties <span>{entity.properties.length}</span></h3>
          <PropertyEditor key={entity.type + JSON.stringify(entity.subtypes)} entity={{...entity, propertyNames}} entities={entities} mention={mention} onSave={(input, propertyId) => mutate(() => api.saveProperty(vaultId, id, input, propertyId))} onRemove={propertyId => mutate(() => api.removeConnection(vaultId, id, 'properties', propertyId))}/>
        </section>
        {!inspector&&<section className="panel-section"><h3>Relationships <span>{entity.relationships.length}</span></h3>
          <RelationshipEditor entity={entity} entities={entities} mention={mention} onSave={(input, relationId) => mutate(() => api.saveRelationship(vaultId, id, input, relationId))} onRemove={relationId => mutate(() => api.removeConnection(vaultId, id, 'relationships', relationId))}/>
        </section>}
      </div>
    </div>}
  </aside>;
}
function SourceInspectorSummary({name,summary}:{name:string;summary?:string|null}) {
  const [expanded,setExpanded]=useState(false);
  const long=!!summary&&summary.length>600;
  return <section className="entity-detail-section source-inspector-summary"><h3>AI summary</h3><p className="source-inspector-filename" title={name}>{name}</p>
    {summary?<><div id="source-inspector-summary-text" className={"ai-summary-text"+(long&&!expanded?" is-collapsed":"")}><SummaryText text={summary}/></div>{long&&<button type="button" className="entity-detail-more" aria-expanded={expanded} aria-controls="source-inspector-summary-text" onClick={()=>setExpanded(value=>!value)}>{expanded?'Show less':'Show more'}</button>}</>:<p className="entity-detail-empty">No AI summary available yet.</p>}
  </section>;
}
function EntityReference({id, entities, onOpen}: {id: string; entities: Entity[]; onOpen: (id: string) => void}) {
  const entity = entities.find(item => item.id === id);
  return <button type="button" className="entity-overview-reference" onClick={() => onOpen(id)}><Icon name={entity?.type ?? 'knowledge'}/><span>{entity?.name ?? 'Unknown entity'}</span></button>;
}
function EntityConnections({items, entities, onOpen, empty}: {items: EntityConnection[]; entities: Entity[]; onOpen: (id: string) => void; empty: string}) {
  return items.length ? <ul className="entity-connection-list">{items.map(item => {
    const entity = entities.find(entity => entity.id === item.target);
    return <li key={item.key}><button type="button" onClick={() => onOpen(item.target)}><Icon name={entity?.type ?? 'knowledge'}/><span><strong>{entity?.name ?? 'Unknown entity'}</strong><small>{item.label}</small></span><Icon name="chevron"/></button></li>;
  })}</ul> : <p className="entity-detail-empty">{empty}</p>;
}
function EntityDetails({vaultId, entity, schema, onSave}: {vaultId: string; schema: EntitySchema; entity: EntityDetail; onSave: (input: Parameters<typeof api.updateEntity>[2]) => Promise<EntityDetail>}) {
  const draft = useSyncExternalStore(subscribeEntityDrafts, () => getEntityDraft(vaultId, entity.id));
  const server = entityDraftValues(entity), values = mergeEntityDraft(draft, server);
  const {name, type, description, subtypes, domainIds, aliases, mentionCase} = values;
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const dirty = entityDraftDirty(values, server);
  function change(patch: Partial<EntityDraftValues>) {
    setEntityDraft(vaultId, entity.id, server, {...values, ...patch}); setStatus('');
  }
  function reset() {if (draft) clearEntityDraft(vaultId, entity.id, draft); setStatus('');}
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !dirty || !name.trim()) return;
    const submitted = draft;
    setBusy(true); setStatus('');
    try {
      await onSave({name: name.trim(), aliases: type === 'source' ? [] : parseAliases(aliases), mentionCase, type, subtypes, domainIds: type === 'concept' ? domainIds : [], description});
      const cleared = submitted && clearEntityDraft(vaultId, entity.id, submitted);
      if (mounted.current && cleared) setStatus('Saved');
    } catch { /* Parent reports the error; the draft remains available. */ }
    finally {if (mounted.current) setBusy(false);}
  }
  return <form id="entity-form" className="entity-detail-form" onSubmit={submit} onKeyDown={event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.requestSubmit();}}}>
    <div className="entity-detail-save"><span id="entity-saved" role="status">{busy?'Saving…':dirty?'Unsaved changes':status||'Details'}</span><div><button type="button" className="knowledge-icon-action" aria-label="Discard changes" title="Discard changes" disabled={busy||!dirty} onClick={reset}><Icon name="refresh"/></button><button type="submit" className="button small primary" aria-label="Save entity details" aria-keyshortcuts="Meta+Enter Control+Enter" disabled={busy||!dirty||!name.trim()}><Icon name="check"/>{busy?'Saving…':'Save'}</button></div></div>
    <div className="entity-form-group">
      <label>Name<input className="entity-name" aria-label="Entity name" autoComplete="off" required maxLength={200} disabled={busy} value={name} onChange={e=>change({name:e.target.value})}/></label>
      <label>Description<textarea aria-label="Entity description" placeholder="A short description…" rows={3} disabled={busy} value={description} onChange={e=>change({description:e.target.value})}/></label>
    </div>
    <div className="entity-form-group">
      <h4 className="entity-form-heading"><Icon name="semantic"/>Classification</h4>
      <label>Type<Select aria-label="Entity type" value={type} disabled={busy} onChange={e=>change({type:e.target.value as EntityType,subtypes:[],domainIds:[]})}>{entityTypes.map(t=><option key={t} value={t} disabled={t!==entity.type&&(t==='source'||entity.type==='source')}>{entityLabels[t]}</option>)}</Select></label>
      <SubtypePicker type={type} value={subtypes} subtypes={schema.subtypes} onChange={value=>change({subtypes:value})} disabled={busy} compact/>
      {type==='concept'&&<DomainPicker value={domainIds} onChange={domainIds=>change({domainIds})} disabled={busy}/>}
    </div>
    <div className="entity-form-group">
      <h4 className="entity-form-heading"><Icon name="quote"/>Mentions</h4>
      {type!=='source'&&<AliasInput value={aliases} onChange={value=>change({aliases:value})} disabled={busy} compact/>}
      <fieldset className="entity-mention-style" disabled={busy}><legend>Tag casing</legend><div role="group" aria-label="Default tag casing">{(['canonical','lowercase'] as const).map(option=><button type="button" key={option} aria-pressed={mentionCase===option} title={option==='canonical'?'Use the entity name when inserting a tag':'Use lowercase when inserting a tag'} onClick={()=>change({mentionCase:option})}>{option==='canonical'?'Entity name':'lowercase'}</button>)}</div></fieldset>
    </div>
  </form>;

}
type MentionRenderer = (id: string) => React.ReactNode;
function PropertyEditor({entity, entities, mention, onSave, onRemove}: {entity: EntityDetail; entities: Entity[]; mention: MentionRenderer; onSave: (input: Parameters<typeof api.saveProperty>[2], id?: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>}) {
  const [edit, setEdit] = useState<string>(), [name, setName] = useState(''), [kind, setKind] = useState<'text' | 'entity'>('text'), [value, setValue] = useState(''), [target, setTarget] = useState(''), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const unset = entity.propertyNames.filter(name => !entity.properties.some(property => property.name.toLowerCase() === name.toLowerCase()));
  const names = name && !entity.propertyNames.includes(name) ? [name, ...entity.propertyNames] : entity.propertyNames;
  const matches = entities.filter(item => item.id === target || `${item.name} ${(item.aliases ?? []).join(' ')} ${entityLabels[item.type]}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function reset() {setEdit(undefined); setName(''); setKind('text'); setValue(''); setTarget(''); setQuery(''); setError('');}
  function focusValue() {form.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'}); form.current?.querySelector<HTMLElement>('textarea, input')?.focus({preventScroll: true});}
  function editing(property: Property) {setEdit(property.id); setName(entity.propertyNames.find(name => name.toLowerCase() === property.name.toLowerCase()) || property.name); setKind(property.target_id ? 'entity' : 'text'); setValue(property.value || ''); setTarget(property.target_id || ''); setQuery(''); setError(''); setStatus(''); setFocusRequest(current => current + 1);}
  useEffect(() => {if (focusRequest) focusValue();}, [focusRequest]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !name || !(kind === 'text' ? value.trim() : target)) return;
    setBusy(true); setError(''); setStatus('');
    try {await onSave(kind === 'entity' ? {name, target_id: target} : {name, value}, edit); reset(); setStatus(edit ? 'Property updated.' : 'Property added.');}
    catch {setError('Could not save this property. Your changes are still here; try again.');}
    finally {setBusy(false);}
  }
  async function remove(property: Property) {
    setBusy(true); setError(''); setStatus('');
    try {await onRemove(property.id); if (edit === property.id) reset(); setStatus(property.name+' removed.');}
    catch {setError('Could not remove this property. Try again.');}
    finally {setBusy(false);}
  }
  return <div className="entity-property-editor">
    <div className="entity-property-list">{entity.properties.map(property => <div key={property.id} className={'entity-property-card'+(edit === property.id ? ' is-editing' : '')}>
      <div className="entity-property-card-header"><strong>{property.name}</strong><span>{property.target_id ? 'Entity reference' : 'Text'}</span><div>
        <button type="button" disabled={busy} aria-label={'Edit '+property.name} title="Edit value" onClick={() => editing(property)}><Icon name="edit"/></button>
        <button type="button" disabled={busy} aria-label={'Remove '+property.name} title="Remove value" onClick={() => void remove(property)}><Icon name="close"/></button>
      </div></div><div className="entity-property-value">{property.target_id ? mention(property.target_id) : property.value}</div>
    </div>)}</div>
    {!!unset.length && <div className="entity-property-unset"><div>{unset.map(field => <button type="button" key={field} disabled={busy} onClick={() => {reset(); setName(field); setStatus(''); setFocusRequest(current => current + 1);}}><Icon name="plus"/>{field}</button>)}</div></div>}
    {!entity.propertyNames.length && !entity.properties.length && <p className="entity-detail-empty">No fields for this classification.</p>}
    {(!!name || !!edit) && <form ref={form} className="entity-property-form" aria-label={edit ? 'Edit property' : 'Add property'} onSubmit={submit}>
      <div className="entity-property-form-heading"><h4>{edit ? 'Edit property' : name}</h4><button type="button" className="knowledge-icon-action" aria-label="Close property editor" title="Close property editor" disabled={busy} onClick={reset}><Icon name="close"/></button></div>
      <label>Property<Select required aria-label="Property name" disabled={busy} value={name} onChange={event => {setName(event.target.value);setStatus('');}}><option value="">Choose a property…</option>{names.map(field => <option key={field} value={field}>{field}</option>)}</Select></label>
      <fieldset className="property-value-kind" disabled={busy}><legend>Value type</legend><div>{(['text', 'entity'] as const).map(option => <button type="button" key={option} aria-pressed={kind === option} onClick={() => {setKind(option);setStatus('');}}><Icon name={option === 'text' ? 'page' : 'knowledge'}/>{option === 'text' ? 'Text' : 'Entity reference'}</button>)}</div></fieldset>
      {kind === 'text' ? <label>Value<textarea required rows={3} aria-label="Property value" placeholder="Enter a value…" disabled={busy} value={value} onChange={event => {setValue(event.target.value);setStatus('');}}/></label> : <div className="property-reference-fields">
        <label>Find an entity<input type="search" aria-label="Search referenced entities" placeholder="Search by name, alias, or type…" disabled={busy} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {if(event.key === 'Enter') event.preventDefault();}}/></label>
        <label>Referenced entity<Select required aria-label="Referenced entity" disabled={busy} value={target} onChange={event => {setTarget(event.target.value);setStatus('');}}><option value="">Choose an entity…</option>{matches.map(item => <option key={item.id} value={item.id}>{item.name} · {entityLabels[item.type]}</option>)}</Select></label>
        {!matches.length && <p className="section-hint">No entities match your search.</p>}
      </div>}
      <div className="entity-property-form-actions"><button type="button" className="button small" disabled={busy || !(edit || name || value || target || query)} onClick={()=>{reset();setStatus('');}}>{edit ? 'Cancel edit' : 'Clear'}</button><button className="button small primary" disabled={busy || !name || !(kind === 'text' ? value.trim() : target)}>{busy ? 'Saving…' : edit ? 'Save changes' : 'Add value'}</button></div>
    </form>}
    {error && <p className="entity-property-error" role="alert">{error}</p>}<p className="entity-property-status" role="status">{status}</p>
  </div>;
}

function RelationshipEditor({entity, entities, mention, onSave, onRemove}: {entity: EntityDetail; entities: Entity[]; mention: MentionRenderer; onSave: (input: Parameters<typeof api.saveRelationship>[2], id?: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>}) {
  const [edit,setEdit]=useState<string>(),[open,setOpen]=useState(false),[label,setLabel]=useState(''),[target,setTarget]=useState(''),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[status,setStatus]=useState('');
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(open)input.current?.focus();},[open,edit]);
  function reset(){setEdit(undefined);setOpen(false);setLabel('');setTarget('');setError('');}
  function editing(relation:Relationship){setEdit(relation.id);setLabel(relation.label);setTarget(relation.target_id);setError('');setStatus('');setOpen(true);}
  async function submit(event:FormEvent){
    event.preventDefault();if(busy||!label.trim()||!target)return;
    setBusy(true);setError('');
    try{await onSave({label:label.trim(),target_id:target},edit);reset();setStatus('Relationship saved.');}
    catch{setError('Could not save this relationship. Try again.');}
    finally{setBusy(false);}
  }
  async function remove(relation:Relationship){
    setBusy(true);setError('');
    try{await onRemove(relation.id);if(edit===relation.id)reset();setStatus('Relationship removed.');}
    catch{setError('Could not remove this relationship. Try again.');}
    finally{setBusy(false);}
  }
  return <div className="entity-relationship-editor">
    {!!entity.relationships.length&&<div className="entity-relationship-list">{entity.relationships.map(relation=><div key={relation.id} className={'entity-relationship-card'+(edit===relation.id?' is-editing':'')}>
      <span className="entity-relationship-direction" title={relation.source_id===entity.id?'Outgoing relationship':'Incoming relationship'}><Icon name={relation.source_id===entity.id?'page-outgoing':'page-incoming'}/></span>
      <div className="entity-relationship-target"><strong>{relation.label}</strong>{mention(relation.source_id===entity.id?relation.target_id:relation.source_id)}</div>
      {relation.source_id===entity.id&&<div className="entity-relationship-actions"><button type="button" className="knowledge-icon-action" aria-label={'Edit relationship: '+relation.label} title="Edit relationship" disabled={busy} onClick={()=>editing(relation)}><Icon name="edit"/></button><button type="button" className="knowledge-icon-action" aria-label={'Remove relationship: '+relation.label} title="Remove relationship" disabled={busy} onClick={()=>void remove(relation)}><Icon name="close"/></button></div>}
    </div>)}</div>}
    {!open&&<button type="button" className="entity-add-connection" disabled={busy} onClick={()=>{reset();setStatus('');setOpen(true);}}><Icon name="plus"/>Add relationship</button>}
    {open&&<form className="entity-property-form entity-relationship-form" aria-label={edit?'Edit relationship':'Add relationship'} onSubmit={submit}>
      <div className="entity-property-form-heading"><h4>{edit?'Edit relationship':'New relationship'}</h4><button type="button" className="knowledge-icon-action" aria-label="Close relationship editor" title="Close relationship editor" disabled={busy} onClick={reset}><Icon name="close"/></button></div>
      <label>Relationship<input ref={input} required placeholder="e.g. member of" aria-label="Relationship name" disabled={busy} value={label} onChange={event=>setLabel(event.target.value)}/></label>
      <label>Related entity<Select required aria-label="Related entity" disabled={busy} value={target} onChange={event=>setTarget(event.target.value)}><option value="">Choose an entity…</option>{entities.filter(item=>item.id!==entity.id).map(item=><option key={item.id} value={item.id}>{item.name} · {entityLabels[item.type]}</option>)}</Select></label>
      <div className="entity-property-form-actions"><button type="button" className="button small" disabled={busy} onClick={reset}>Cancel</button><button type="submit" className="button small primary" disabled={busy||!label.trim()||!target}>{busy?'Saving…':edit?'Save changes':'Add relationship'}</button></div>
    </form>}
    {error&&<p className="entity-property-error" role="alert">{error}</p>}{status&&<p className="entity-property-status" role="status">{status}</p>}
  </div>;
}
