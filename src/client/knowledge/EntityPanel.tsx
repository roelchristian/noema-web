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
import { entityLabels, entityTypes, type Entity, type EntityDetail, type EntityMentionCase, type EntityType, type Property, type Relationship } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Mention } from '../components/Mention';
import { AliasInput, parseAliases } from './AliasInput';
interface Props {onCreatePageFromSource:(source:Entity)=>void;onOpenPage: (id: string) => void; refreshKey: string; vaultId: string; id: string; entities: Entity[]; onOpen: (id: string) => void; onClose: () => void; onUpdated: () => Promise<void>; onError: (error: unknown) => void}
const entityTabs = [{id: 'overview', label: 'Overview'}, {id: 'connections', label: 'Connections'}, {id: 'edit', label: 'Edit'}] as const;
type EntityTab = typeof entityTabs[number]['id'];
interface EntityConnection {key: string; target: string; label: string}
export function EntityPanel(props: Props) {
  const {vaultId, id, entities, onOpen, onClose, onUpdated, onError, onOpenPage, refreshKey} = props;
  const [entity, setEntity] = useState<EntityDetail | null>(null), [loadingError, setLoadingError] = useState('');
  const [tab, setTab] = useState<EntityTab>(() => hasEntityDraft(vaultId, id) ? 'edit' : 'overview');
  const currentEntityKey = useRef({vaultId, id}); currentEntityKey.current = {vaultId, id};
  useEffect(() => {setEntity(null); setTab(hasEntityDraft(vaultId, id) ? 'edit' : 'overview');}, [vaultId, id]);
  useEffect(() => {
    let active = true; setLoadingError('');
    void api.entity(vaultId, id).then(e => { if (active) setEntity(e); }).catch(error => { if (active) setLoadingError(String(error)); });
    return () => { active = false; };
  }, [vaultId, id, refreshKey]);
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
    document.getElementById('entity-panel')?.scrollTo({top: 0});
    document.getElementById('entity-tab-' + next)?.focus({preventScroll: true});
  }
  return <aside id="entity-panel" className="entity-panel entity-detail-panel" aria-label="Knowledge entity"><div className="panel-top entity-detail-toolbar">
    {entity ? <div className="entity-toolbar-heading"><span className="entity-detail-icon" aria-hidden="true"><Icon name={entity.type}/></span><h2 id="entity-detail-title" className="entity-toolbar-title" title={entity.name}>{entity.name}</h2></div> : <span>KNOWLEDGE ENTITY</span>}
    <button type="button" title="Close entity" aria-label="Close entity" onClick={onClose}><Icon name="close"/></button>
  </div>
    {!entity ? <p className="panel-body" role={loadingError ? 'alert' : 'status'}>{loadingError || 'Loading entity…'}</p> : <div className="panel-body entity-detail-body">
      {loadingError && <p role="alert">{loadingError}</p>}
      <div className="entity-detail-classification"><span className="entity-detail-type">{entityLabels[entity.type]}</span>{entity.type==='source'&&<span>{entity.attachments?.some(file=>file.status==='queued'||file.status==='processing')?'Processing':entity.inactive?'Inactive':entity.sourceEnrichmentStatus==='pending'||entity.sourceEnrichmentStatus==='running'?'Processed · Enriching with AI':entity.sourceEnrichmentStatus==='failed'?'Processed · AI enrichment failed':'Processed'}</span>}{!!subtypeNames.length && <span>{subtypeNames.join(' · ')}</span>}</div>
      {entity.type==='source'&&<div className="entity-source-workflow"><button type="button" className="button" disabled={entity.inactive||entity.sourceStatus!=='ready'} onClick={()=>props.onCreatePageFromSource(entity)}><Icon name="sparkles"/>Create page from source</button>{entity.sourceStatus!=='ready'&&<p className="section-hint">{entity.inactive?'Retry source processing before creating a page.':'Available once source processing finishes.'}</p>}</div>}
      {entity.type==='source'&&entity.attachments?.map(file=><div key={file.id}>{file.language&&<p className="section-hint">Language: {file.language}</p>}{file.summary&&<div className="ai-summary-text"><SummaryText text={file.summary}/></div>}</div>)}
      {entity.description && <p className="entity-detail-description">{entity.description}</p>}
      <div className="entity-detail-tabs" role="tablist" aria-label="Entity details">
        {entityTabs.map(({id: value, label}) => <button type="button" key={value} id={'entity-tab-' + value} role="tab" aria-selected={tab === value} aria-controls={'entity-tabpanel-' + value} tabIndex={tab === value ? 0 : -1} onClick={() => switchTab(value)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index = entityTabs.findIndex(item => item.id === value);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? entityTabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + entityTabs.length) % entityTabs.length;
          switchTab(entityTabs[next]!.id);
        }}>{label}</button>)}
      </div>
      <div id="entity-tabpanel-overview" className="entity-detail-tabpanel" role="tabpanel" aria-labelledby="entity-tab-overview" hidden={tab !== 'overview'} tabIndex={0}>
        {entity.type==='concept' && <section className="entity-detail-section"><h3>Disciplines</h3><p className="section-hint">{entity.domainIds?.length ? entity.domainIds.map(domainBreadcrumb).join(' · ') : 'No disciplines selected.'}</p></section>}
        <section className="entity-detail-section"><h3>Properties<span>{entity.properties.length + unsetProperties.length}</span></h3>
          {entity.properties.length || unsetProperties.length ? <dl className="entity-overview-properties">{entity.properties.map(property => <div key={property.id}><dt>{property.name}</dt><dd>{property.target_id ? <EntityReference id={property.target_id} entities={entities} onOpen={onOpen}/> : property.value}</dd></div>)}{unsetProperties.map(name => <div key={'unset-' + name}><dt>{name}</dt><dd><button type="button" onClick={() => switchTab('edit')}>Not set</button></dd></div>)}</dl> : <p className="entity-detail-empty">No inherited fields yet. Define properties on a subtype in Settings → Knowledge Entities.</p>}
        </section>
        <section className="entity-detail-section"><h3>Related knowledge<span>{relationships.length} {relationships.length === 1 ? 'connection' : 'connections'}</span></h3>
          <EntityConnections items={relationships.slice(0, 4)} entities={entities} onOpen={onOpen} empty="No related knowledge yet."/>
          {!!relationships.length && <button type="button" className="entity-detail-more" onClick={() => switchTab('connections')}>{relationships.length > 4 ? 'View all ' + relationships.length + ' connections' : 'View connections'}<Icon name="chevron"/></button>}
        </section>
        <section className="entity-detail-section entity-mentions-section"><h3>Mentions from pages<span>{entity.pageMentions?.length ?? 0}</span></h3>
          {entity.pageMentions?.length ? <ul className="entity-connection-list entity-page-mentions">{entity.pageMentions.map(page => <li key={page.id}>
            <button type="button" onClick={() => onOpenPage(page.id)}><PageIcon icon={page.icon}/><span><span className="entity-mention-heading"><strong title={page.title || 'Untitled'}>{page.title || 'Untitled'}</strong><small className="entity-mention-count" aria-label={`${page.mentionCount} ${page.mentionCount === 1 ? 'mention' : 'mentions'}`}>{page.mentionCount}×</small></span>{page.excerpt && <small className="entity-mention-excerpt" title={page.excerpt}>{page.excerpt}</small>}</span><Icon name="chevron"/></button>
          </li>)}</ul> : <p className="entity-detail-empty">No pages mention this entity yet. Tag it in a page to see it here.</p>}
        </section>
        {entity.type!=='source' && !!entity.aliases?.length && <section className="entity-detail-section"><h3>Also known as</h3><ul className="entity-overview-aliases">{entity.aliases.map(alias => <li key={alias}>{alias}</li>)}</ul></section>}
        {entity.type === 'source' && <section className="entity-detail-section"><h3>Attached sources<span>{entity.attachments?.length ?? 0}</span></h3>
          {entity.attachments?.length ? <ul className="entity-overview-sources">{entity.attachments.map(file => <li key={file.id}>{file.admitted===1?<a href={'/api/source-files/' + encodeURIComponent(file.id) + '/download?vault=' + encodeURIComponent(vaultId)} download><Icon name="source"/><span>{file.name}<small>{(file.size / 1024).toFixed(1)} KB{file.pdf_flattened===1?' · Flattened locally':''}</small></span><Icon name="download"/></a>:<span>{file.name}<small>{file.status==='failed'?'Inactive — processing failed':'Processing in background…'}</small></span>}</li>)}</ul> : <p className="entity-detail-empty">No attached files. Add sources in Edit.</p>}
        </section>}
      </div>
      <div id="entity-tabpanel-connections" className="entity-detail-tabpanel" role="tabpanel" aria-labelledby="entity-tab-connections" hidden={tab !== 'connections'} tabIndex={0}>
        <section className="entity-detail-section"><h3>Relationships<span>{relationships.length}</span></h3><EntityConnections items={relationships} entities={entities} onOpen={onOpen} empty="No relationships yet."/></section>
        <section className="entity-detail-section"><h3>Referenced entities<span>{references.length}</span></h3><EntityConnections items={references} entities={entities} onOpen={onOpen} empty="No entity references in properties."/></section>
        <section className="entity-detail-section"><h3>Referenced by<span>{incoming.length}</span></h3><EntityConnections items={incoming} entities={entities} onOpen={onOpen} empty="No other entities reference this one yet."/></section>
        <button type="button" className="button entity-edit-connections" onClick={() => switchTab('edit')}>Edit connections</button>
      </div>
      <div id="entity-tabpanel-edit" className="entity-detail-tabpanel entity-detail-edit" role="tabpanel" aria-labelledby="entity-tab-edit" hidden={tab !== 'edit'} tabIndex={0}>
        {schemaError && <p role="alert">{schemaError}</p>}
        <section className="entity-detail-section"><h3>Details</h3><EntityDetails vaultId={vaultId} schema={schema} key={vaultId + ':' + entity.id} entity={entity} onSave={async input => {
          let result: EntityDetail;
          try {result = await api.updateEntity(vaultId, id, input);} catch (error) {onError(error); throw error;}
          if (currentEntityKey.current.vaultId === vaultId && currentEntityKey.current.id === id) setEntity(result);
          // The entity is saved even if refreshing the surrounding workspace fails.
          void onUpdated().catch(onError);
          return result;
        }}/></section>
        {entity.type==='source'&&<SourceAttachments key={entity.id} vaultId={vaultId} entityId={entity.id} initial={entity.attachments} onChange={attachments => {setEntity(current => current ? {...current, attachments,inactive:attachments.some(file=>file.status==='failed'),sourceStatus:attachments[0]?.status,sourceEnrichmentStatus:attachments[0]?.enrichment_status} : current);if(attachments.every(file=>file.status==='failed'||file.status==='ready'&&file.enrichment_status!=='pending'&&file.enrichment_status!=='running'))void api.entity(vaultId,id).then(result=>{setEntity(result);return onUpdated();}).catch(onError);else if(entity.inactive)void onUpdated().catch(onError);}}/>}
        <section className="panel-section"><h3>Properties <span>{entity.properties.length}</span></h3><p className="section-hint">Fields are inherited from this category and its selected subtypes. Define new fields in Settings → Knowledge Entities; set each entity’s values here.</p>
          <PropertyEditor key={entity.type + JSON.stringify(entity.subtypes)} entity={{...entity, propertyNames}} entities={entities} mention={mention} onSave={(input, propertyId) => mutate(() => api.saveProperty(vaultId, id, input, propertyId))} onRemove={propertyId => mutate(() => api.removeConnection(vaultId, id, 'properties', propertyId))}/>
        </section>
        <section className="panel-section"><h3>Relationships <span>{entity.relationships.length}</span></h3><p className="section-hint">Named connections, independent of properties.</p>
          <RelationshipEditor entity={entity} entities={entities} mention={mention} onSave={(input, relationId) => mutate(() => api.saveRelationship(vaultId, id, input, relationId))} onRemove={relationId => mutate(() => api.removeConnection(vaultId, id, 'relationships', relationId))}/>
        </section>
        <p className="panel-footnote">Changes are shared across your vault.</p>
      </div>
    </div>}
  </aside>;
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
  return <form id="entity-form" className="entity-detail-form" onSubmit={submit}>
    <label>Name<input className="entity-name" aria-label="Entity name" required maxLength={200} disabled={busy} value={name} onChange={e => change({name: e.target.value})}/></label>
    <h4 className="entity-form-heading">Classification</h4>
    <label>Entity type<Select aria-label="Entity type" value={type} disabled={busy} onChange={e => change({type: e.target.value as EntityType, subtypes: [], domainIds: []})}>{entityTypes.map(t => <option key={t} value={t} disabled={t!==entity.type&&(t==='source'||entity.type==='source')}>{entityLabels[t]}</option>)}</Select></label>
    <SubtypePicker type={type} value={subtypes} subtypes={schema.subtypes} onChange={value => change({subtypes: value})} disabled={busy}/>
    {type==='concept'&&<DomainPicker value={domainIds} onChange={domainIds => change({domainIds})} disabled={busy}/>}
    <h4 className="entity-form-heading">{type==='source'?'Mentions':'Mentions & aliases'}</h4>
    {type!=='source'&&<AliasInput value={aliases} onChange={value => change({aliases: value})} disabled={busy}/>}
    <label>Default tag casing<Select aria-label="Default tag casing" value={mentionCase} disabled={busy} onChange={event => change({mentionCase: event.target.value as EntityMentionCase})}><option value="canonical">Entity name</option><option value="lowercase">Lowercase</option></Select></label>
    <p className="section-hint">Used when inserting a tag without source text. AI tags and tags made from selected text keep the passage’s original capitalization.</p>
    <h4 className="entity-form-heading">About this entity</h4>
    <label>Description<textarea aria-label="Entity description" placeholder="Add context to help identify this entity…" rows={4} disabled={busy} value={description} onChange={e => change({description: e.target.value})}/></label>
    <div className="entity-detail-save"><span id="entity-saved" role="status">{busy ? 'Saving changes…' : dirty ? 'Unsaved changes' : status || 'No unsaved changes'}</span><div><button type="button" className="button small" disabled={busy || !dirty} onClick={reset}>Reset</button><button className="button small primary" disabled={busy || !dirty || !name.trim()}>{busy ? 'Saving…' : 'Save details'}</button></div></div>
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
    {!!unset.length && <div className="entity-property-unset"><p>Fields without values <span>{unset.length}</span></p><div>{unset.map(field => <button type="button" key={field} disabled={busy} onClick={() => {reset(); setName(field); setStatus(''); setFocusRequest(current => current + 1);}}><Icon name="plus"/>{field}</button>)}</div></div>}
    {!entity.propertyNames.length && !entity.properties.length && <p className="entity-detail-empty">No property fields yet. Choose subtypes and save the entity’s details, or define fields in Settings → Knowledge Entities.</p>}
    {(!!entity.propertyNames.length || !!edit) && <form ref={form} className="entity-property-form" aria-label={edit ? 'Edit property' : 'Add property'} onSubmit={submit}>
      <div className="entity-property-form-heading"><h4>{edit ? 'Edit property' : 'Add a property value'}</h4>{edit && <span>Editing saved value</span>}</div>
      <label>Property<Select required aria-label="Property name" disabled={busy} value={name} onChange={event => {setName(event.target.value);setStatus('');}}><option value="">Choose a property…</option>{names.map(field => <option key={field} value={field}>{field}</option>)}</Select></label>
      <fieldset className="property-value-kind" disabled={busy}><legend>Value type</legend><div>{(['text', 'entity'] as const).map(option => <button type="button" key={option} aria-pressed={kind === option} onClick={() => {setKind(option);setStatus('');}}><Icon name={option === 'text' ? 'page' : 'knowledge'}/>{option === 'text' ? 'Text' : 'Entity reference'}</button>)}</div></fieldset>
      {kind === 'text' ? <label>Value<textarea required rows={3} aria-label="Property value" placeholder="Enter a value…" disabled={busy} value={value} onChange={event => {setValue(event.target.value);setStatus('');}}/></label> : <div className="property-reference-fields">
        <label>Find an entity<input type="search" aria-label="Search referenced entities" placeholder="Search by name, alias, or type…" disabled={busy} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {if(event.key === 'Enter') event.preventDefault();}}/></label>
        <label>Referenced entity<Select required aria-label="Referenced entity" disabled={busy} value={target} onChange={event => {setTarget(event.target.value);setStatus('');}}><option value="">Choose an entity…</option>{matches.map(item => <option key={item.id} value={item.id}>{item.name} · {entityLabels[item.type]}</option>)}</Select></label>
        {!matches.length && <p className="section-hint">No entities match your search.</p>}
      </div>}
      <div className="entity-property-form-actions"><button type="button" className="button small" disabled={busy || !(edit || name || value || target || query)} onClick={()=>{reset();setStatus('');}}>{edit ? 'Cancel edit' : 'Clear'}</button><button className="button small primary" disabled={busy || !name || !(kind === 'text' ? value.trim() : target)}>{busy ? 'Saving…' : edit ? 'Save changes' : 'Add value'}</button></div>
      <p className="entity-property-save-hint">Save each property separately from entity details.</p>
    </form>}
    {error && <p className="entity-property-error" role="alert">{error}</p>}<p className="entity-property-status" role="status">{status}</p>
  </div>;
}

function RelationshipEditor({entity, entities, mention, onSave, onRemove}: {entity: EntityDetail; entities: Entity[]; mention: MentionRenderer; onSave: (input: Parameters<typeof api.saveRelationship>[2], id?: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>}) {
  const [edit, setEdit] = useState<string>(), [label, setLabel] = useState(''), [target, setTarget] = useState(''), [busy, setBusy] = useState(false);
  function reset() { setEdit(undefined); setLabel(''); setTarget(''); }
  function editing(r: Relationship) { setEdit(r.id); setLabel(r.label); setTarget(r.target_id); }
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); try { await onSave({label, target_id: target}, edit); reset(); } catch { /* Parent reports the error. */ } finally { setBusy(false); } }
  return <>{entity.relationships.map(r => <div key={r.id} className="relationship"><span className="relation-label">{r.source_id === entity.id ? '→ ' + r.label : '← ' + r.label + ' (incoming)'}</span>{mention(r.source_id === entity.id ? r.target_id : r.source_id)}{r.source_id === entity.id && <><button className="edit-item" aria-label="Edit relationship" disabled={busy} onClick={() => editing(r)}>Edit</button><button className="remove" aria-label="Remove relationship" disabled={busy} onClick={() => { setBusy(true); void onRemove(r.id).then(() => { if (edit === r.id) reset(); }).catch(() => {}).finally(() => setBusy(false)); }}>×</button></>}</div>)}{!entity.relationships.length && <div className="empty-small">No relationships yet.</div>}
    <form className="add-form" onSubmit={submit}><input required placeholder="e.g. sibling, inspired by, member of" aria-label="Relationship name" value={label} onChange={e => setLabel(e.target.value)}/><Select required aria-label="Related entity" value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose an entity…</option>{entities.filter(e => e.id !== entity.id).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</Select><button className="button small" disabled={busy}>{edit ? 'Save relationship' : '+ Add relationship'}</button>{edit && <button type="button" className="edit-item" disabled={busy} onClick={reset}>Cancel edit</button>}</form>
  </>;
}
