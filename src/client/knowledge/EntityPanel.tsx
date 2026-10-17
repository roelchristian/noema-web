import { SourceAttachments } from './SourceAttachments';
import { SubtypePicker } from './SubtypePicker';
import { useEntitySchema } from './useEntitySchema';
import { inheritedPropertyNames, type EntitySchema } from '../../shared/entity-schema';
import { Select } from '../components/Select';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { entityLabels, entityTypes, type Entity, type EntityDetail, type EntityType, type Property, type Relationship } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Mention } from '../components/Mention';
import { AliasInput, parseAliases } from './AliasInput';
interface Props {vaultId: string; id: string; entities: Entity[]; onOpen: (id: string) => void; onClose: () => void; onUpdated: () => Promise<void>; onError: (error: unknown) => void}
const entityTabs = [{id: 'overview', label: 'Overview'}, {id: 'connections', label: 'Connections'}, {id: 'edit', label: 'Edit'}] as const;
type EntityTab = typeof entityTabs[number]['id'];
interface EntityConnection {key: string; target: string; label: string}
export function EntityPanel(props: Props) {
  const {vaultId, id, entities, onOpen, onClose, onUpdated, onError} = props;
  const [entity, setEntity] = useState<EntityDetail | null>(null), [loadingError, setLoadingError] = useState('');
  const [tab, setTab] = useState<EntityTab>('overview');
  useEffect(() => {
    let active = true; setEntity(null); setLoadingError(''); setTab('overview');
    void api.entity(vaultId, id).then(e => { if (active) setEntity(e); }).catch(error => { if (active) setLoadingError(String(error)); });
    return () => { active = false; };
  }, [vaultId, id]);
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
      <div className="entity-detail-classification"><span className="entity-detail-type">{entityLabels[entity.type]}</span>{!!subtypeNames.length && <span>{subtypeNames.join(' · ')}</span>}</div>
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
        <section className="entity-detail-section"><h3>Properties<span>{entity.properties.length + unsetProperties.length}</span></h3>
          {entity.properties.length || unsetProperties.length ? <dl className="entity-overview-properties">{entity.properties.map(property => <div key={property.id}><dt>{property.name}</dt><dd>{property.target_id ? <EntityReference id={property.target_id} entities={entities} onOpen={onOpen}/> : property.value}</dd></div>)}{unsetProperties.map(name => <div key={'unset-' + name}><dt>{name}</dt><dd><button type="button" onClick={() => switchTab('edit')}>Not set</button></dd></div>)}</dl> : <p className="entity-detail-empty">No inherited fields yet. Define properties on a subtype in Settings → Knowledge Entities.</p>}
        </section>
        <section className="entity-detail-section"><h3>Related knowledge<span>{relationships.length} {relationships.length === 1 ? 'connection' : 'connections'}</span></h3>
          <EntityConnections items={relationships.slice(0, 4)} entities={entities} onOpen={onOpen} empty="No related knowledge yet."/>
          {!!relationships.length && <button type="button" className="entity-detail-more" onClick={() => switchTab('connections')}>{relationships.length > 4 ? 'View all ' + relationships.length + ' connections' : 'View connections'}<Icon name="chevron"/></button>}
        </section>
        {!!entity.aliases?.length && <section className="entity-detail-section"><h3>Also known as</h3><ul className="entity-overview-aliases">{entity.aliases.map(alias => <li key={alias}>{alias}</li>)}</ul></section>}
        {entity.type === 'source' && <section className="entity-detail-section"><h3>Attached sources<span>{entity.attachments?.length ?? 0}</span></h3>
          {entity.attachments?.length ? <ul className="entity-overview-sources">{entity.attachments.map(file => <li key={file.id}><a href={'/api/source-files/' + encodeURIComponent(file.id) + '/download?vault=' + encodeURIComponent(vaultId)} download><Icon name="source"/><span>{file.name}<small>{(file.size / 1024).toFixed(1)} KB</small></span><Icon name="download"/></a></li>)}</ul> : <p className="entity-detail-empty">No attached files. Add sources in Edit.</p>}
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
        <section className="entity-detail-section"><h3>Details</h3><EntityDetails schema={schema} key={entity.id} entity={entity} onSave={input => mutate(() => api.updateEntity(vaultId, id, input))}/></section>
        {entity.type==='source'&&<SourceAttachments key={entity.id} vaultId={vaultId} entityId={entity.id} initial={entity.attachments} onChange={attachments => setEntity(current => current ? {...current, attachments} : current)}/>}
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
function EntityDetails({entity, schema, onSave}: {schema: EntitySchema; entity: EntityDetail; onSave: (input: Parameters<typeof api.updateEntity>[2]) => Promise<unknown>}) {
  const [name, setName] = useState(entity.name), [type, setType] = useState<EntityType>(entity.type), [description, setDescription] = useState(entity.description), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [subtypes, setSubtypes] = useState(entity.subtypes);
  const [aliases, setAliases] = useState((entity.aliases ?? []).join('\n'));
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setStatus(''); try { await onSave({name, aliases: parseAliases(aliases), type, subtypes, description}); setStatus('Saved'); } catch { /* Parent reports the error. */ } finally { setBusy(false); } }
  return <form id="entity-form" className="entity-detail-form" onSubmit={submit}>
    <label>Name<input className="entity-name" aria-label="Entity name" required maxLength={200} disabled={busy} value={name} onChange={e => {setName(e.target.value);setStatus('');}}/></label>
    <label>Entity type<Select aria-label="Entity type" value={type} disabled={busy} onChange={e => {setType(e.target.value as EntityType);setSubtypes([]);setStatus('');}}>{entityTypes.map(t => <option key={t} value={t} disabled={t!==entity.type&&(t==='source'||entity.type==='source')}>{entityLabels[t]}</option>)}</Select></label>
    <SubtypePicker type={type} value={subtypes} subtypes={schema.subtypes} onChange={value => {setSubtypes(value);setStatus('');}} disabled={busy}/>
    <AliasInput value={aliases} onChange={value => {setAliases(value);setStatus('');}} disabled={busy}/>
    <label>Description<textarea aria-label="Entity description" placeholder="Add a description…" disabled={busy} value={description} onChange={e => {setDescription(e.target.value);setStatus('');}}/></label>
    <div className="entity-detail-save"><button className="button small" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button><span id="entity-saved" role="status">{status}</span></div>
  </form>;
}
type MentionRenderer = (id: string) => React.ReactNode;
function PropertyEditor({entity, entities, mention, onSave, onRemove}: {entity: EntityDetail; entities: Entity[]; mention: MentionRenderer; onSave: (input: Parameters<typeof api.saveProperty>[2], id?: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>}) {
  const [edit, setEdit] = useState<string>(), [name, setName] = useState(''), [kind, setKind] = useState('text'), [value, setValue] = useState(''), [target, setTarget] = useState(''), [busy, setBusy] = useState(false);
  function reset() { setEdit(undefined); setName(''); setKind('text'); setValue(''); setTarget(''); }
  function editing(p: Property) { setEdit(p.id); setName(entity.propertyNames.find(name => name.toLowerCase() === p.name.toLowerCase()) || p.name); setKind(p.target_id ? 'entity' : 'text'); setValue(p.value || ''); setTarget(p.target_id || ''); }
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); try { await onSave(kind === 'entity' ? {name, target_id: target} : {name, value}, edit); reset(); } catch { /* Parent reports the error. */ } finally { setBusy(false); } }
  return <><div className="property-list">{entity.properties.map(p => <div key={p.id} className="property-row"><span>{p.name}</span><div>{p.target_id ? mention(p.target_id) : p.value}</div><button className="edit-item" aria-label="Edit property" disabled={busy} onClick={() => editing(p)}>Edit</button><button className="remove" aria-label="Remove property" disabled={busy} onClick={() => { setBusy(true); void onRemove(p.id).then(() => { if (edit === p.id) reset(); }).catch(() => {}).finally(() => setBusy(false)); }}>×</button></div>)}{!entity.properties.length && <div className="empty-small">No properties yet.</div>}</div>
    <form className="add-form" onSubmit={submit}><Select required aria-label="Property name" disabled={busy || !entity.propertyNames.length} value={name} onChange={e => setName(e.target.value)}><option value="">Choose an inherited property…</option>{entity.propertyNames.map(p => <option key={p} value={p}>{p}</option>)}</Select><Select aria-label="Property value type" value={kind} onChange={e => setKind(e.target.value)}><option value="text">Text value</option><option value="entity">Entity reference</option></Select>
      {kind === 'text' ? <input placeholder="Value" aria-label="Property value" value={value} onChange={e => setValue(e.target.value)}/> : <Select required aria-label="Referenced entity" value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose an entity…</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>}
      <button className="button small" disabled={busy || !entity.propertyNames.length}>{edit ? 'Save value' : '+ Add value'}</button>{edit && <button type="button" className="edit-item" disabled={busy} onClick={reset}>Cancel edit</button>}
    </form></>;
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
