import { SourceAttachments } from './SourceAttachments';
import { SubtypePicker } from './SubtypePicker';
import { useEntitySchema } from './useEntitySchema';
import type { EntitySchema } from '../../shared/entity-schema';
import { Select } from '../components/Select';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { entityLabels, entityTypes, type Entity, type EntityDetail, type EntityType, type Property, type Relationship } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Mention } from '../components/Mention';
import { AliasInput, parseAliases } from './AliasInput';
interface Props {vaultId: string; id: string; entities: Entity[]; onOpen: (id: string) => void; onClose: () => void; onUpdated: () => Promise<void>; onError: (error: unknown) => void}
export function EntityPanel(props: Props) {
  const {vaultId, id, entities, onOpen, onClose, onUpdated, onError} = props;
  const [entity, setEntity] = useState<EntityDetail | null>(null), [loadingError, setLoadingError] = useState('');
  useEffect(() => {
    let active = true; setEntity(null); setLoadingError('');
    void api.entity(vaultId, id).then(e => { if (active) setEntity(e); }).catch(error => { if (active) setLoadingError(String(error)); });
    return () => { active = false; };
  }, [vaultId, id]);
  const {schema, setSchema, error: schemaError} = useEntitySchema(vaultId);
  const mention = (entityId: string) => <Mention id={entityId} entities={entities} onOpen={onOpen}/>;
  async function mutate(work: () => Promise<EntityDetail>) {
    try { const result = await work(); setEntity(result); setSchema({...schema, properties: {...schema.properties, [result.type]: result.propertyNames}}); await onUpdated(); } catch (error) { onError(error); throw error; }
  }
  return <aside id="entity-panel" className="entity-panel"><div className="panel-top"><span>KNOWLEDGE ENTITY</span><button title="Close entity" aria-label="Close entity" onClick={onClose}>×</button></div>
    {!entity ? <p className="panel-body" role="status">{loadingError || 'Loading entity…'}</p> : <div className="panel-body"><span className={'entity-icon large ' + entity.type}><Icon name={entity.type}/></span>
      {schemaError && <p role="alert">{schemaError}</p>}
      <EntityDetails schema={schema} key={entity.id} entity={entity} onSave={input => mutate(() => api.updateEntity(vaultId, id, input))}/>
      {entity.type==='source'&&<SourceAttachments key={entity.id} vaultId={vaultId} entityId={entity.id} initial={entity.attachments}/>}
      <section className="panel-section"><h3>Properties <span>{entity.properties.length}</span></h3><p className="section-hint">{entity.subtypes.length > 0 ? `Properties inherited from ${entityLabels[entity.type]}. Add new fields on the main type in Knowledge entities.` : 'Describe this entity with values or entity references. New property names become available to all subtypes of this type.'}</p>
        <PropertyEditor key={entity.type + JSON.stringify(entity.subtypes)} entity={{...entity, propertyNames: [...new Set([...entity.propertyNames, ...schema.properties[entity.type]])]}} entities={entities} mention={mention} onSave={(input, propertyId) => mutate(() => api.saveProperty(vaultId, id, input, propertyId))} onRemove={propertyId => mutate(() => api.removeConnection(vaultId, id, 'properties', propertyId))}/>
      </section>
      <section className="panel-section"><h3>Relationships <span>{entity.relationships.length}</span></h3><p className="section-hint">Named connections, independent of properties.</p>
        <RelationshipEditor entity={entity} entities={entities} mention={mention} onSave={(input, relationId) => mutate(() => api.saveRelationship(vaultId, id, input, relationId))} onRemove={relationId => mutate(() => api.removeConnection(vaultId, id, 'relationships', relationId))}/>
      </section>
      {!!entity.incomingProperties.length && <section className="panel-section"><h3>Referenced by</h3>{entity.incomingProperties.map(p => <div key={p.id} className="backlink">{mention(p.entity_id)}<small>via {p.name}</small></div>)}</section>}
      <p className="panel-footnote">One entity. Many connections.<br/>Changes are shared across your vault.</p>
    </div>}
  </aside>;
}
function EntityDetails({entity, schema, onSave}: {schema: EntitySchema; entity: EntityDetail; onSave: (input: Parameters<typeof api.updateEntity>[2]) => Promise<unknown>}) {
  const [name, setName] = useState(entity.name), [type, setType] = useState<EntityType>(entity.type), [description, setDescription] = useState(entity.description), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [subtypes, setSubtypes] = useState(entity.subtypes);
  const [aliases, setAliases] = useState((entity.aliases ?? []).join('\n'));
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setStatus(''); try { await onSave({name, aliases: parseAliases(aliases), type, subtypes, description}); setStatus('Saved'); } catch { /* Parent reports the error. */ } finally { setBusy(false); } }
  return <form id="entity-form" onSubmit={submit}><input className="entity-name" aria-label="Entity name" required maxLength={200} value={name} onChange={e => setName(e.target.value)}/><Select aria-label="Entity type" value={type} onChange={e => { setType(e.target.value as EntityType); setSubtypes([]); }}>{entityTypes.map(t => <option key={t} value={t} disabled={t!==entity.type&&(t==='source'||entity.type==='source')}>{entityLabels[t]}</option>)}</Select><SubtypePicker type={type} value={subtypes} subtypes={schema.subtypes} onChange={setSubtypes} disabled={busy}/><AliasInput value={aliases} onChange={setAliases} disabled={busy}/><textarea aria-label="Entity description" placeholder="Add a description…" value={description} onChange={e => setDescription(e.target.value)}/><button className="button small" disabled={busy}>Save details</button><span id="entity-saved"> {status}</span></form>;
}
type MentionRenderer = (id: string) => React.ReactNode;
function PropertyEditor({entity, entities, mention, onSave, onRemove}: {entity: EntityDetail; entities: Entity[]; mention: MentionRenderer; onSave: (input: Parameters<typeof api.saveProperty>[2], id?: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>}) {
  const [edit, setEdit] = useState<string>(), [name, setName] = useState(''), [kind, setKind] = useState('text'), [value, setValue] = useState(''), [target, setTarget] = useState(''), [busy, setBusy] = useState(false);
  function reset() { setEdit(undefined); setName(''); setKind('text'); setValue(''); setTarget(''); }
  function editing(p: Property) { setEdit(p.id); setName(entity.propertyNames.find(name => name.toLowerCase() === p.name.toLowerCase()) || p.name); setKind(p.target_id ? 'entity' : 'text'); setValue(p.value || ''); setTarget(p.target_id || ''); }
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); try { await onSave(kind === 'entity' ? {name, target_id: target} : {name, value}, edit); reset(); } catch { /* Parent reports the error. */ } finally { setBusy(false); } }
  return <><div className="property-list">{entity.properties.map(p => <div key={p.id} className="property-row"><span>{p.name}</span><div>{p.target_id ? mention(p.target_id) : p.value}</div><button className="edit-item" aria-label="Edit property" disabled={busy} onClick={() => editing(p)}>Edit</button><button className="remove" aria-label="Remove property" disabled={busy} onClick={() => { setBusy(true); void onRemove(p.id).then(() => { if (edit === p.id) reset(); }).catch(() => {}).finally(() => setBusy(false)); }}>×</button></div>)}{!entity.properties.length && <div className="empty-small">No properties yet.</div>}</div>
    <form className="add-form" onSubmit={submit}>{entity.subtypes.length > 0 ? <Select required aria-label="Property name" value={name} onChange={e => setName(e.target.value)}><option value="">Choose an inherited property…</option>{entity.propertyNames.map(p => <option key={p} value={p}>{p}</option>)}</Select> : <><input required list="entity-property-names" placeholder="Property name" aria-label="Property name" value={name} onChange={e => setName(e.target.value)}/><datalist id="entity-property-names">{entity.propertyNames.map(p => <option key={p} value={p}/>)}</datalist></>}<Select aria-label="Property value type" value={kind} onChange={e => setKind(e.target.value)}><option value="text">Text value</option><option value="entity">Entity reference</option></Select>
      {kind === 'text' ? <input placeholder="Value" aria-label="Property value" value={value} onChange={e => setValue(e.target.value)}/> : <Select required aria-label="Referenced entity" value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose an entity…</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>}
      <button className="button small" disabled={busy}>{edit ? 'Save property' : '+ Add property'}</button>{edit && <button type="button" className="edit-item" disabled={busy} onClick={reset}>Cancel edit</button>}
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
