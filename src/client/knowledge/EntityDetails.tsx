import {useEffect, useRef, useState, useSyncExternalStore, type FormEvent} from 'react';
import {t as uiText} from '../i18n';
import {Icon} from '../components/Icon';
import {Select} from '../components/Select';
import {DomainPicker} from './DomainPicker';
import {SubtypePicker} from './SubtypePicker';
import {AliasInput, parseAliases} from './AliasInput';
import {api} from '../api';
import {entityLabels, entityTypes, type Entity, type EntityDetail, type EntityType, type Property, type Relationship} from '../../shared/domain';
import type {EntitySchema} from '../../shared/entity-schema';
import {clearEntityDraft, entityDraftDirty, entityDraftValues, getEntityDraft, mergeEntityDraft, setEntityDraft, subscribeEntityDrafts, type EntityDraftValues} from './entity-drafts';
export interface EntityConnection {key: string; target: string; label: string}
export function EntityReference({id, entities, onOpen}: {id: string; entities: Entity[]; onOpen: (id: string) => void}) {
  const entity = entities.find(item => item.id === id);
  return <button type="button" className="entity-overview-reference" onClick={() => onOpen(id)}><Icon name={entity?.type ?? 'knowledge'}/><span>{entity?.name ?? uiText("Unknown entity")}</span></button>;
}
export function EntityConnections({items, entities, onOpen, empty}: {items: EntityConnection[]; entities: Entity[]; onOpen: (id: string) => void; empty: string}) {
  return items.length ? <ul className="entity-connection-list">{items.map(item => {
    const entity = entities.find(entity => entity.id === item.target);
    return <li key={item.key}><button type="button" onClick={() => onOpen(item.target)}><Icon name={entity?.type ?? 'knowledge'}/><span><strong>{entity?.name ?? uiText("Unknown entity")}</strong><small>{item.label}</small></span><Icon name="chevron"/></button></li>;
  })}</ul> : <p className="entity-detail-empty">{empty}</p>;
}
export function EntityDetails({vaultId, entity, schema, onSave, idPrefix = "entity"}: {idPrefix?: string; vaultId: string; schema: EntitySchema; entity: EntityDetail; onSave: (input: Parameters<typeof api.updateEntity>[2]) => Promise<EntityDetail>}) {
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
  return <form id={idPrefix + "-form"} className="entity-detail-form" onSubmit={submit} onKeyDown={event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.requestSubmit();}}}>
    <div className="entity-detail-save"><span id={idPrefix + "-saved"} role="status">{busy?uiText("Saving…"):dirty?uiText("Unsaved changes"):status||uiText("Details")}</span><div><button type="button" className="knowledge-icon-action" aria-label={uiText("Discard changes")} title={uiText("Discard changes")} disabled={busy||!dirty} onClick={reset}><Icon name="refresh"/></button><button type="submit" className="button small primary" aria-label={uiText("Save entity details")} aria-keyshortcuts="Meta+Enter Control+Enter" disabled={busy||!dirty||!name.trim()}><Icon name="check"/>{busy?uiText("Saving…"):uiText("Save")}</button></div></div>
    <div className="entity-form-group">
      <label>{uiText("Name")}<input className="entity-name" aria-label={uiText("Entity name")} autoComplete="off" required maxLength={200} disabled={busy} value={name} onChange={e=>change({name:e.target.value})}/></label>
      <label>{uiText("Description")}<textarea aria-label={uiText("Entity description")} placeholder={uiText("A short description…")} rows={3} disabled={busy} value={description} onChange={e=>change({description:e.target.value})}/></label>
    </div>
    <div className="entity-form-group">
      <h4 className="entity-form-heading"><Icon name="semantic"/>{uiText("Classification")}</h4>
      <label>{uiText("Type")}<Select aria-label={uiText("Entity type")} value={type} disabled={busy} onChange={e=>change({type:e.target.value as EntityType,subtypes:[],domainIds:[]})}>{entityTypes.map(t=><option key={t} value={t} disabled={t!==entity.type&&(t==='source'||entity.type==='source')}>{uiText(entityLabels[t])}</option>)}</Select></label>
      <SubtypePicker type={type} value={subtypes} subtypes={schema.subtypes} onChange={value=>change({subtypes:value})} disabled={busy} compact/>
      {type==='concept'&&<DomainPicker value={domainIds} onChange={domainIds=>change({domainIds})} disabled={busy}/>}
    </div>
    <div className="entity-form-group">
      <h4 className="entity-form-heading"><Icon name="quote"/>{uiText("Mentions")}</h4>
      {type!=='source'&&<AliasInput value={aliases} onChange={value=>change({aliases:value})} disabled={busy} compact/>}
      <fieldset className="entity-mention-style" disabled={busy}><legend>{uiText("Tag casing")}</legend><div role="group" aria-label={uiText("Default tag casing")}>{(['canonical','lowercase'] as const).map(option=><button type="button" key={option} aria-pressed={mentionCase===option} title={option==='canonical'?uiText("Use the entity name when inserting a tag"):uiText("Use lowercase when inserting a tag")} onClick={()=>change({mentionCase:option})}>{option==='canonical'?uiText("Entity name"):uiText("lowercase")}</button>)}</div></fieldset>
    </div>
  </form>;

}
type MentionRenderer = (id: string) => React.ReactNode;
export function PropertyEditor({entity, entities, mention, onSave, onRemove}: {entity: EntityDetail; entities: Entity[]; mention: MentionRenderer; onSave: (input: Parameters<typeof api.saveProperty>[2], id?: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>}) {
  const [edit, setEdit] = useState<string>(), [name, setName] = useState(''), [kind, setKind] = useState<'text' | 'entity'>('text'), [value, setValue] = useState(''), [target, setTarget] = useState(''), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const unset = entity.propertyNames.filter(name => !entity.properties.some(property => property.name.toLowerCase() === name.toLowerCase()));
  const names = name && !entity.propertyNames.includes(name) ? [name, ...entity.propertyNames] : entity.propertyNames;
  const matches = entities.filter(item => item.id === target || !item.archived_at && `${item.name} ${(item.aliases ?? []).join(' ')} ${entityLabels[item.type]}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
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
      <div className="entity-property-card-header"><strong>{property.name}</strong><span>{property.target_id ? uiText("Entity reference") : uiText("Text")}</span><div>
        <button type="button" disabled={busy} aria-label={uiText("Edit ")+property.name} title={uiText("Edit value")} onClick={() => editing(property)}><Icon name="edit"/></button>
        <button type="button" disabled={busy} aria-label={uiText("Remove ")+property.name} title={uiText("Remove value")} onClick={() => void remove(property)}><Icon name="close"/></button>
      </div></div><div className="entity-property-value">{property.target_id ? mention(property.target_id) : property.value}</div>
    </div>)}</div>
    {!!unset.length && <div className="entity-property-unset"><div>{unset.map(field => <button type="button" key={field} disabled={busy} onClick={() => {reset(); setName(field); setStatus(''); setFocusRequest(current => current + 1);}}><Icon name="plus"/>{field}</button>)}</div></div>}
    {!entity.propertyNames.length && !entity.properties.length && <p className="entity-detail-empty">{uiText("No fields for this classification.")}</p>}
    {(!!name || !!edit) && <form ref={form} className="entity-property-form" aria-label={edit ? uiText("Edit property") : uiText("Add property")} onSubmit={submit}>
      <div className="entity-property-form-heading"><h4>{edit ? uiText("Edit property") : name}</h4><button type="button" className="knowledge-icon-action" aria-label={uiText("Close property editor")} title={uiText("Close property editor")} disabled={busy} onClick={reset}><Icon name="close"/></button></div>
      <label>{uiText("Property")}<Select required aria-label={uiText("Property name")} disabled={busy} value={name} onChange={event => {setName(event.target.value);setStatus('');}}><option value="">{uiText("Choose a property…")}</option>{names.map(field => <option key={field} value={field}>{field}</option>)}</Select></label>
      <fieldset className="property-value-kind" disabled={busy}><legend>{uiText("Value type")}</legend><div>{(['text', 'entity'] as const).map(option => <button type="button" key={option} aria-pressed={kind === option} onClick={() => {setKind(option);setStatus('');}}><Icon name={option === 'text' ? 'page' : 'knowledge'}/>{option === 'text' ? uiText("Text") : uiText("Entity reference")}</button>)}</div></fieldset>
      {kind === 'text' ? <label>{uiText("Value")}<textarea required rows={3} aria-label={uiText("Property value")} placeholder={uiText("Enter a value…")} disabled={busy} value={value} onChange={event => {setValue(event.target.value);setStatus('');}}/></label> : <div className="property-reference-fields">
        <label>{uiText("Find an entity")}<input type="search" aria-label={uiText("Search referenced entities")} placeholder={uiText("Search by name, alias, or type…")} disabled={busy} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {if(event.key === 'Enter') event.preventDefault();}}/></label>
        <label>{uiText("Referenced entity")}<Select required aria-label={uiText("Referenced entity")} disabled={busy} value={target} onChange={event => {setTarget(event.target.value);setStatus('');}}><option value="">{uiText("Choose an entity…")}</option>{matches.map(item => <option key={item.id} value={item.id}>{item.name} · {uiText(entityLabels[item.type])}</option>)}</Select></label>
        {!matches.length && <p className="section-hint">{uiText("No entities match your search.")}</p>}
      </div>}
      <div className="entity-property-form-actions"><button type="button" className="button small" disabled={busy || !(edit || name || value || target || query)} onClick={()=>{reset();setStatus('');}}>{edit ? uiText("Cancel edit") : uiText("Clear")}</button><button className="button small primary" disabled={busy || !name || !(kind === 'text' ? value.trim() : target)}>{busy ? uiText("Saving…") : edit ? uiText("Save changes") : uiText("Add value")}</button></div>
    </form>}
    {error && <p className="entity-property-error" role="alert">{error}</p>}<p className="entity-property-status" role="status">{status}</p>
  </div>;
}

export function RelationshipEditor({entity, entities, mention, onSave, onRemove}: {entity: EntityDetail; entities: Entity[]; mention: MentionRenderer; onSave: (input: Parameters<typeof api.saveRelationship>[2], id?: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>}) {
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
      <span className="entity-relationship-direction" title={relation.source_id===entity.id?uiText("Outgoing relationship"):uiText("Incoming relationship")}><Icon name={relation.source_id===entity.id?'page-outgoing':'page-incoming'}/></span>
      <div className="entity-relationship-target"><strong>{relation.label}</strong>{mention(relation.source_id===entity.id?relation.target_id:relation.source_id)}</div>
      {relation.source_id===entity.id&&<div className="entity-relationship-actions"><button type="button" className="knowledge-icon-action" aria-label={uiText("Edit relationship: ")+relation.label} title={uiText("Edit relationship")} disabled={busy} onClick={()=>editing(relation)}><Icon name="edit"/></button><button type="button" className="knowledge-icon-action" aria-label={uiText("Remove relationship: ")+relation.label} title={uiText("Remove relationship")} disabled={busy} onClick={()=>void remove(relation)}><Icon name="close"/></button></div>}
    </div>)}</div>}
    {!open&&<button type="button" className="entity-add-connection" disabled={busy} onClick={()=>{reset();setStatus('');setOpen(true);}}><Icon name="plus"/>{uiText("Add relationship")}</button>}
    {open&&<form className="entity-property-form entity-relationship-form" aria-label={edit?uiText("Edit relationship"):uiText("Add relationship")} onSubmit={submit}>
      <div className="entity-property-form-heading"><h4>{edit?uiText("Edit relationship"):uiText("New relationship")}</h4><button type="button" className="knowledge-icon-action" aria-label={uiText("Close relationship editor")} title={uiText("Close relationship editor")} disabled={busy} onClick={reset}><Icon name="close"/></button></div>
      <label>{uiText("Relationship")}<input ref={input} required placeholder={uiText("e.g. member of")} aria-label={uiText("Relationship name")} disabled={busy} value={label} onChange={event=>setLabel(event.target.value)}/></label>
      <label>{uiText("Related entity")}<Select required aria-label={uiText("Related entity")} disabled={busy} value={target} onChange={event=>setTarget(event.target.value)}><option value="">{uiText("Choose an entity…")}</option>{entities.filter(item=>item.id!==entity.id&&(!item.archived_at||item.id===target)).map(item=><option key={item.id} value={item.id}>{item.name} · {uiText(entityLabels[item.type])}</option>)}</Select></label>
      <div className="entity-property-form-actions"><button type="button" className="button small" disabled={busy} onClick={reset}>{uiText("Cancel")}</button><button type="submit" className="button small primary" disabled={busy||!label.trim()||!target}>{busy?uiText("Saving…"):edit?uiText("Save changes"):uiText("Add relationship")}</button></div>
    </form>}
    {error&&<p className="entity-property-error" role="alert">{error}</p>}{status&&<p className="entity-property-status" role="status">{status}</p>}
  </div>;
}
