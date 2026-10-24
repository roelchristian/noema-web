import {SuccessNotice} from '../components/SuccessNotice';
import {EntityReferencePicker} from './EntityReferencePicker';
import {clearPropertyDraft,getPropertyDraft,setPropertyDraft,subscribePropertyDrafts,propertyDraftSignature,runPropertyMutation,beginPropertySave,endPropertySave,getAdvancedPropertySelection,setAdvancedPropertySelection,type EntityPropertyDraft} from './entity-property-drafts';
import {resolvePropertyDefinition,propertyLabel} from '../../shared/property-definitions';
import {useEffect, useRef, useState, useSyncExternalStore, type FormEvent} from 'react';
import {t as uiText} from '../i18n';
import {Icon} from '../components/Icon';
import {Select} from '../components/Select';
import {DomainPicker} from './DomainPicker';
import {SubtypePicker} from './SubtypePicker';
import {AliasInput, parseAliases} from './AliasInput';
import {api,ApiError} from '../api';
import {PropertyScalarInput} from './PropertyScalarInput';
import type {PropertyDefinition} from '../../shared/property-definitions';
import {entityLabels, entityTypes, type Entity, type EntityDetail, type EntityType, type Property, type Relationship} from '../../shared/domain';
import type {EntitySchema} from '../../shared/entity-schema';
import {clearEntityDraft, entityDraftDirty, entityDraftValues, getEntityDraft, mergeEntityDraft, setEntityDraft, subscribeEntityDrafts, type EntityDraftValues} from './entity-drafts';
export interface EntityConnection {key: string; target: string; label: string}
export function EntityReference({id, entities, onOpen}: {id: string; entities: Entity[]; onOpen: (id: string) => void}) {
  const entity = entities.find(item => item.id === id);
  return <button type="button" className="entity-overview-reference" onClick={() => onOpen(id)}><Icon name={entity?.type ?? 'knowledge'} entity={entity}/><span>{entity?.name ?? uiText("Unknown entity")}</span></button>;
}
export function EntityConnections({items, entities, onOpen, empty}: {items: EntityConnection[]; entities: Entity[]; onOpen: (id: string) => void; empty: string}) {
  return items.length ? <ul className="entity-connection-list">{items.map(item => {
    const entity = entities.find(entity => entity.id === item.target);
    return <li key={item.key}><button type="button" onClick={() => onOpen(item.target)}><Icon name={entity?.type ?? 'knowledge'} entity={entity}/><span><strong>{entity?.name ?? uiText("Unknown entity")}</strong><small>{item.label}</small></span><Icon name="chevron"/></button></li>;
  })}</ul> : <p className="entity-detail-empty">{empty}</p>;
}
export function EntityDetails({vaultId, entity, schema, onSave, idPrefix = "entity"}: {idPrefix?: string; vaultId: string; schema: EntitySchema; entity: EntityDetail; onSave: (input: Parameters<typeof api.updateEntity>[2]) => Promise<EntityDetail>}) {
  const draft = useSyncExternalStore(subscribeEntityDrafts, () => getEntityDraft(vaultId, entity.id));
  const server = entityDraftValues(entity), values = mergeEntityDraft(draft, server);
  const {name, type, description, subtypes, domainIds, aliases, mentionCase} = values;
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [classificationImpact,setClassificationImpact]=useState<Awaited<ReturnType<typeof api.entityClassificationImpact>>>();
  const classificationChanged=type!==entity.type||JSON.stringify([...subtypes].sort())!==JSON.stringify([...entity.subtypes].sort());
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const dirty = entityDraftDirty(values, server);
  function change(patch: Partial<EntityDraftValues>) {
    setEntityDraft(vaultId, entity.id, server, {...values, ...patch}); setStatus('');setClassificationImpact(undefined);
  }
  function reset() {if (draft) clearEntityDraft(vaultId, entity.id, draft); setStatus('');setClassificationImpact(undefined);}
  async function submit(event: FormEvent,retainLegacy=false) {
    event.preventDefault();
    if (busy || !dirty || !name.trim()) return;
    const submitted = draft;
    setBusy(true); setStatus('');
    try {
      let impact=classificationImpact;
      if(classificationChanged&&!retainLegacy){impact=await api.entityClassificationImpact(vaultId,entity.id,{type,subtypes});if(mounted.current)setClassificationImpact(impact);if(impact.requiresConfirmation||impact.structuralBlockers.length){setStatus(uiText('Review classification impact before saving.'));return;}}
      if(retainLegacy&&(!impact||impact.structuralBlockers.length))return;
      await onSave({...(retainLegacy?{classification_mode:'retain_legacy' as const,impact_fingerprint:impact!.fingerprint}:{}),name: name.trim(), aliases: type === 'source' ? [] : parseAliases(aliases), mentionCase, type, subtypes, domainIds: type === 'concept' ? domainIds : [], description});
      const cleared = submitted && clearEntityDraft(vaultId, entity.id, submitted);
      if (mounted.current && cleared) setStatus('Saved');
    } catch(error) {if(mounted.current){setStatus(error instanceof Error?error.message:uiText('Could not save. Draft retained.'));setClassificationImpact(undefined);}}
    finally {if (mounted.current) setBusy(false);}
  }
  return <form id={idPrefix + "-form"} className="entity-detail-form" onSubmit={submit} onKeyDown={event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.requestSubmit();}}}>
    <div className="entity-detail-save"><span id={idPrefix + "-saved"} role="status">{busy?uiText("Saving…"):status|| (dirty?uiText("Unsaved changes"):uiText("Details"))}</span><div><button type="button" className="knowledge-icon-action" aria-label={uiText("Discard changes")} title={uiText("Discard changes")} disabled={busy||!dirty} onClick={reset}><Icon name="refresh"/></button><button type="submit" className="button small primary" aria-label={uiText("Save entity details")} aria-keyshortcuts="Meta+Enter Control+Enter" disabled={busy||!dirty||!name.trim()}><Icon name="check"/>{busy?uiText("Saving…"):uiText("Save")}</button></div></div>
    {classificationImpact&&classificationChanged&&<section className="entity-classification-impact" aria-label={uiText('Classification impact')}>
      <p role="status">{uiText('Changing classification preserves all authored values and reference IDs.')} {classificationImpact.outgoing.length} {uiText('outgoing values and')} {classificationImpact.incoming.length} {uiText('incoming references need review.')}</p>
      {!!classificationImpact.structuralBlockers.length&&<p role="alert">{classificationImpact.structuralBlockers.join(' ')}</p>}
      <ul>{[...classificationImpact.outgoing,...classificationImpact.incoming].map(item=><li key={item.propertyId}>{item.reason}</li>)}</ul>
      {classificationImpact.requiresConfirmation&&!classificationImpact.structuralBlockers.length&&<button type="button" className="button small" disabled={busy} onClick={event=>void submit(event,true)}>{uiText('Keep legacy values and save classification')}</button>}
    </section>}
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
export function PropertyEditor({entity, entities, mention, onSave, onRemove,definitions}: {definitions?:PropertyDefinition[];entity: EntityDetail; entities: Entity[]; mention: MentionRenderer; onSave: (input: Parameters<typeof api.saveProperty>[2], id?: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>}) {
  const vault=entity.vault_id;
  const [selection,setSelection]=useState(()=>getAdvancedPropertySelection(vault,entity.id)??{edit:undefined as string|undefined,name:''});
  const {edit,name}=selection;
  const draftId=edit??'new:'+name;
  const definition=definitions?resolvePropertyDefinition(definitions,entity.type,entity.subtypes,name,entity.properties.find(item=>item.id===edit)?.metadata?.definition_id):undefined;
  const label=(name:string,bound?:string)=>resolvePropertyDefinition(definitions,entity.type,entity.subtypes,name,bound)?.label??propertyLabel(name);
  useEffect(()=>setSelection(getAdvancedPropertySelection(vault,entity.id)??{name:''}),[vault,entity.id]);
  const draft=useSyncExternalStore(subscribePropertyDrafts,()=>getPropertyDraft(vault,entity.id,draftId));
  const kind=draft?.kind??'text',value=draft?.value??'',target=draft?.target??'';
  const [busy,setBusy]=useState(false);
  function select(next:{edit?:string;name:string}) {setSelection(next);setAdvancedPropertySelection(vault,entity.id,next);}
  function patch(changes:Partial<EntityPropertyDraft>) {const current=getPropertyDraft(vault,entity.id,draftId);if(current?.uncertainCreate)return;const base=current??{kind:'text' as const,value:'',target:'',baseline:propertyDraftSignature({kind:'text',value:'',target:''})};setPropertyDraft(vault,entity.id,draftId,{...base,...changes,error:undefined});}
  const setKind=(kind:'text'|'entity')=>patch({kind}),setValue=(value:string)=>patch({value}),setTarget=(target:string)=>patch({target});
  function setName(name:string) {const current=getPropertyDraft(vault,entity.id,draftId);if(current&&!edit){clearPropertyDraft(vault,entity.id,draftId);setPropertyDraft(vault,entity.id,'new:'+name,current);}select({...selection,name});}

  const [status, setStatus] = useState(''), [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const unset = entity.propertyNames.filter(name => !entity.properties.some(property => property.name.toLowerCase() === name.toLowerCase()));
  const managed=(property:Property)=>(definitions?.some(item=>item.legacyName.toLowerCase()===property.name.toLowerCase()&&!item.editable)??false)&&property.provenance?.origin!=='manual'&&property.provenance?.origin!=='legacy_unknown';
  const names = name && !entity.propertyNames.includes(name) ? [name, ...entity.propertyNames] : entity.propertyNames;
  function reset() {clearPropertyDraft(vault,entity.id,draftId);select({name:''});setError('');}
  function focusValue() {form.current?.scrollIntoView({behavior: 'smooth', block: 'nearest'}); form.current?.querySelector<HTMLElement>('textarea, input')?.focus({preventScroll: true});}
  function editing(property: Property) {const storedName=entity.propertyNames.find(name=>name.toLowerCase()===property.name.toLowerCase())??property.name;const initial={kind:property.target_id?'entity' as const:'text' as const,value:property.value??'',target:property.target_id??'',legacy:property.metadata?.compatibility==='legacy_incompatible'||!!definitions?.some(item=>item.legacyName.toLowerCase()===property.name.toLowerCase()&&!item.editable)&&!managed(property)};if(!getPropertyDraft(vault,entity.id,property.id))setPropertyDraft(vault,entity.id,property.id,{...initial,baseline:propertyDraftSignature(initial)});select({edit:property.id,name:storedName});setError('');setStatus('');setFocusRequest(current=>current+1);}
  useEffect(() => {if (focusRequest) focusValue();}, [focusRequest]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !name || !(kind === 'text' ? value.trim() : target)) return;
    if(!beginPropertySave(vault,entity.id,draftId))return;
    setBusy(true); setError(''); setStatus('');
    try {await runPropertyMutation(vault,entity.id,async()=>{
      if(!edit&&draft?.uncertainCreate){const refreshed=await api.entity(vault,entity.id);const previous=new Set(entity.properties.map(property=>property.id));if(refreshed.properties.some(property=>!previous.has(property.id)&&property.name.toLowerCase()===name.toLowerCase()&&(kind==='entity'?property.target_id===target:property.target_id===null&&property.value===value)))return;}
      const input:Parameters<typeof api.saveProperty>[2]=kind==='entity'?{name,target_id:target}:{name,value};if(definition){input.definition_id=definition.id;if(draft?.legacy)input.compatibility_mode='legacy';}
      await onSave(input,edit);
    });clearPropertyDraft(vault,entity.id,draftId,draft);select({name:''});setStatus(edit?'Property updated.':'Property added.');}
    catch (reason) {if(draft)setPropertyDraft(vault,entity.id,draftId,{...draft,uncertainCreate:!edit&&!(reason instanceof ApiError)||draft.uncertainCreate});setError(reason instanceof ApiError?reason.message:'Could not confirm save. Your changes are retained; retry checks saved values first.');}
    finally {setBusy(false);endPropertySave(vault,entity.id,draftId);}
  }
  async function remove(property: Property) {
    if (!window.confirm(uiText("Remove this value? This cannot be undone."))) return;
    setBusy(true); setError(''); setStatus('');
    try {await runPropertyMutation(vault,entity.id,()=>onRemove(property.id)); if (edit === property.id) reset(); setStatus(property.name+' removed.');}
    catch {setError('Could not remove this property. Try again.');}
    finally {setBusy(false);}
  }
  return <div className="entity-property-editor">
    <div className="entity-property-list">{entity.properties.map(property => <div key={property.id} className={'entity-property-card'+(edit === property.id ? ' is-editing' : '')}>
      <div className="entity-property-card-header"><strong>{label(property.name,property.metadata?.definition_id)}</strong><span>{managed(property)?uiText("Managed source metadata"):property.target_id ? uiText("Entity reference") : uiText("Text")}</span><div>
        <button type="button" disabled={busy||managed(property)} aria-label={uiText("Edit ")+label(property.name,property.metadata?.definition_id)} title={uiText("Edit value")} onClick={() => editing(property)}><Icon name="edit"/></button>
        <button type="button" disabled={busy||managed(property)} aria-label={uiText("Remove ")+label(property.name,property.metadata?.definition_id)} title={uiText("Remove value")} onClick={() => void remove(property)}><Icon name="close"/></button>
      </div></div><div className="entity-property-value">{property.target_id ? mention(property.target_id) : property.value}</div>
    </div>)}</div>
    {!!unset.length && <div className="entity-property-unset"><div>{unset.map(field => <button type="button" key={field} disabled={busy} onClick={() => {select({name:field}); setStatus(''); setFocusRequest(current => current + 1);}}><Icon name="plus"/>{label(field)}</button>)}</div></div>}
    {!entity.propertyNames.length && !entity.properties.length && <p className="entity-detail-empty">{uiText("No fields for this classification.")}</p>}
    {(!!name || !!edit) && <form ref={form} className="entity-property-form" aria-label={edit ? uiText("Edit property") : uiText("Add property")} onSubmit={submit}>
      <div className="entity-property-form-heading"><h4>{edit ? uiText("Edit property") : name}</h4><button type="button" className="knowledge-icon-action" aria-label={uiText("Close property editor")} title={uiText("Close property editor")} disabled={busy} onClick={reset}><Icon name="close"/></button></div>
      <label>{uiText("Property")}<Select required aria-label={uiText("Property name")} disabled={busy||!!draft?.uncertainCreate} value={name} onChange={event => {setName(event.target.value);setStatus('');}}><option value="">{uiText("Choose a property…")}</option>{names.map(field => <option key={field} value={field}>{label(field)}</option>)}</Select></label>
      <fieldset className="property-value-kind" disabled={busy||!!draft?.uncertainCreate}><legend>{uiText("Value type")}</legend><div>{(['text', 'entity'] as const).map(option => <button type="button" key={option} aria-pressed={kind === option} onClick={() => {setKind(option);setStatus('');}}><Icon name={option === 'text' ? 'page' : 'knowledge'}/>{option === 'text' ? uiText("Text") : uiText("Entity reference")}</button>)}</div></fieldset>
      {definition&&edit&&<label><input type="checkbox" checked={!!draft?.legacy} onChange={event=>patch({legacy:event.target.checked})}/>{uiText('Preserve as legacy value')}</label>}
      {kind === 'text' ? <label>{uiText("Value")}<PropertyScalarInput label={uiText('Property value')} definition={draft?.legacy?undefined:definition} disabled={busy||!!draft?.uncertainCreate} value={value} onChange={setValue}/></label> : <EntityReferencePicker vaultId={vault} entities={entities} value={target} onChange={setTarget} disabled={busy||!!draft?.uncertainCreate} types={definition?.allowedTargetTypes} subtypes={definition?.allowedTargetSubtypes} label={uiText('Referenced entity')} creation={draft?.referenceCreation} onCreationChange={referenceCreation=>patch({referenceCreation})}/>}
      <div className="entity-property-form-actions"><button type="button" className="button small" disabled={busy || !(edit || name || value || target)} onClick={()=>{reset();setStatus('');}}>{edit ? uiText("Cancel edit") : uiText("Clear")}</button><button className="button small primary" disabled={busy || !name || !(kind === 'text' ? value.trim() : target)}>{busy ? uiText("Saving…") : draft?.uncertainCreate?uiText("Retry save"):edit ? uiText("Save changes") : uiText("Add value")}</button></div>
    </form>}
    {(error||draft?.uncertainCreate) && <p className="entity-property-error" role="alert">{error||uiText("Save outcome is uncertain. Retry checks saved values before submitting again.")}</p>}<SuccessNotice inline message={status} onDismiss={()=>setStatus('')}/>
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
    {error&&<p className="entity-property-error" role="alert">{error}</p>}{status&&<SuccessNotice inline message={status} onDismiss={()=>setStatus('')}/>}
  </div>;
}
