import {api,ApiError} from '../api';
import {useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import type {Entity, EntityDetail, Property, PropertyInput} from '../../shared/domain';
import type {PropertyDefinition} from '../../shared/property-definitions';
import {EntityReferencePicker} from './EntityReferencePicker';
import {PropertyScalarInput} from './PropertyScalarInput';
import {propertyDefinitionFor, propertyLabel, resolvePropertyDefinition, propertyDefinitionConflicts} from '../../shared/property-definitions';
import {TemporalPropertyValue} from './TemporalPropertyValue';
import {t as uiText} from '../i18n';
import {beginPropertySave, endPropertySave, propertySavePending, runPropertyMutation, clearPropertyDraft, getPropertyDraft, propertyDraftSignature, setPropertyDraft, subscribePropertyDrafts, type EntityPropertyDraft} from './entity-property-drafts';

interface Props {
  vaultId: string; entity: EntityDetail; entities: Entity[]; mention: (id: string) => ReactNode;
  onSave: (input: PropertyInput, id?: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>; onRefresh?: () => Promise<EntityDetail>;
  density?: 'home'|'compact'|'source'; priority?: readonly string[]; limit?: number; definitions?:PropertyDefinition[]; active?:boolean;
}
/** Shared ordinary editing surface. The stored name and value remain unchanged by presentation. */
export function EntityPropertyList(props: Props) {
  const {entity, priority = []} = props;
  const [expanded, setExpanded] = useState(false), [query, setQuery] = useState(''), [showAll,setShowAll] = useState(false);
  const definitionFor=(name:string,bound?:string)=>resolvePropertyDefinition(props.definitions,entity.type,entity.subtypes,name,bound);
  const labelFor=(name:string,bound?:string)=>definitionFor(name,bound)?.label??propertyLabel(name);
  const populated = new Set(entity.properties.map(property=>definitionFor(property.name,property.metadata?.definition_id)?.key??property.name.toLowerCase()));
  const seen=new Set<string>();
  const unset=entity.propertyNames.filter(name=>{const key=definitionFor(name)?.key??name.toLowerCase();if(populated.has(key)||seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>(definitionFor(a)?.sortOrder??999)-(definitionFor(b)?.sortOrder??999)||labelFor(a).localeCompare(labelFor(b)));
  const rank = (name: string) => {const index=priority.indexOf(name.toLowerCase());return index < 0 ? 999 : index;};
  const properties = [...entity.properties].sort((a,b)=>rank(a.name)-rank(b.name)||(definitionFor(a.name,a.metadata?.definition_id)?.sortOrder??999)-(definitionFor(b.name,b.metadata?.definition_id)?.sortOrder??999)||labelFor(a.name,a.metadata?.definition_id).localeCompare(labelFor(b.name,b.metadata?.definition_id))||(a.metadata?.position??0)-(b.metadata?.position??0)||a.id.localeCompare(b.id));
  return <div className={'entity-inline-properties density-' + (props.density ?? 'home')}>
    <dl className="entity-overview-properties">{(showAll||!props.limit?properties:properties.slice(0,props.limit)).map(property=><PropertyRow key={property.id} {...props} name={property.name} property={property}/>)}</dl>
    {!!props.limit&&properties.length>props.limit&&<button type="button" className="entity-detail-more" aria-expanded={showAll} onClick={()=>setShowAll(value=>!value)}>{uiText(showAll?'Show fewer properties':'Show all properties')} ({properties.length})</button>}
    {!!unset.length && <div className="entity-inline-suggestions"><dl className="entity-overview-properties">{unset.slice(0,3).map(name=><PropertyRow key={name} {...props} name={name}/>)}</dl>
      {unset.length > 3 && <><button type="button" className="entity-detail-more" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{uiText('Add Property')} ({unset.length-3})</button>{expanded&&<><label>{uiText('Find a property')}<input type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label><dl className="entity-overview-properties">{unset.slice(3).filter(name=>labelFor(name).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(name=><PropertyRow key={name} {...props} name={name}/>)}</dl></>}</>}
    </div>}
    {!properties.length&&!unset.length&&<p className="entity-detail-empty">{uiText('No fields for this classification.')}</p>}
  </div>;
}
function PropertyRow({name, property, ...props}: Props & {name: string; property?: Property}) {
  const {vaultId, entity, entities, mention, onSave, onRemove} = props;
  const id = property?.id ?? 'new:' + name;
  const draft = useSyncExternalStore(subscribePropertyDrafts, ()=>getPropertyDraft(vaultId,entity.id,id));
  const busy = useSyncExternalStore(subscribePropertyDrafts, ()=>propertySavePending(vaultId,entity.id,id));
  const [status,setStatus] = useState(''), [confirm,setConfirm] = useState(false);
  const lock = useRef(false), suppressBlur = useRef(false);
  const persistedDefinition=props.definitions?resolvePropertyDefinition(props.definitions,entity.type,entity.subtypes,name,property?.metadata?.definition_id):undefined;
  const conflicts=propertyDefinitionConflicts(props.definitions?.filter(item=>item.scope.type===entity.type&&(item.scope.kind==='main_type'||entity.subtypes.includes(item.scope.subtypeId)))??[]).find(item=>item.key===persistedDefinition?.key);
  const definition = persistedDefinition??propertyDefinitionFor(entity.type,name), label = definition?.label??propertyLabel(name);
  const managed = entity.type === 'source' && ['Import method','Source URL'].includes(name);
  function begin() {
    const initial = {kind: property?.target_id || !property && definition?.valueKind === 'entity_reference' ? 'entity' as const : 'text' as const, value:property?.value ?? '',target:property?.target_id ?? '',legacy:!!property&&property.metadata?.compatibility==='legacy_incompatible'};
    setPropertyDraft(vaultId,entity.id,id,{...initial,baseline:propertyDraftSignature(initial)});setStatus('');
  }
  function change(patch: Partial<EntityPropertyDraft>) {const current=getPropertyDraft(vaultId,entity.id,id);if(current&&!current.uncertainCreate)setPropertyDraft(vaultId,entity.id,id,{...current,...patch,error:undefined});}
  function cancel() {clearPropertyDraft(vaultId,entity.id,id);setConfirm(false);}
  async function save() {
    if(!draft||lock.current||!(draft.kind==='text'?draft.value.trim():draft.target))return;
    if(property&&propertyDraftSignature(draft)===draft.baseline) {cancel();return;}
    if(!beginPropertySave(vaultId,entity.id,id))return;lock.current=true;setStatus('');
    try {
      await runPropertyMutation(vaultId,entity.id,async()=>{
        // A failed create response can hide a committed insert. Read before retrying;
        // a failed read leaves the draft untouched and never issues another create.
        if(!property&&draft.uncertainCreate) {
          const refreshed=await (props.onRefresh?.() ?? api.entity(vaultId,entity.id));
          const previousIds=new Set(entity.properties.map(item=>item.id));
          const committed=refreshed.properties.some(item=>!previousIds.has(item.id)&&item.name.toLowerCase()===name.toLowerCase()&&(draft.kind==='entity'?item.target_id===draft.target:item.target_id===null&&item.value===draft.value));
          if(committed)return;
        }
        const input:PropertyInput=draft.kind==='entity'?{name,target_id:draft.target}:{name,value:draft.value};
        if(persistedDefinition){input.definition_id=persistedDefinition.id;if(draft.legacy)input.compatibility_mode='legacy';}
        await onSave(input,property?.id);
      });
      clearPropertyDraft(vaultId,entity.id,id,draft);setStatus(uiText('Saved'));
    } catch (reason) {
      // Keep a newer edit if another surface changed it during the request.
      if(getPropertyDraft(vaultId,entity.id,id)===draft)setPropertyDraft(vaultId,entity.id,id,{...draft,uncertainCreate:!property&&!(reason instanceof ApiError)||draft.uncertainCreate,error:reason instanceof ApiError?reason.message:uiText(!property?'Could not confirm save. Retry checks saved values before resubmitting.':'Could not save. Your changes are retained.')});
    } finally {lock.current=false;endPropertySave(vaultId,entity.id,id);}
  }
  async function remove() {
    if(!property||lock.current||!beginPropertySave(vaultId,entity.id,id))return;lock.current=true;
    try {await runPropertyMutation(vaultId,entity.id,()=>onRemove(property.id));cancel();}
    catch {setStatus(uiText('Could not remove this value. Try again.'));}
    finally {lock.current=false;endPropertySave(vaultId,entity.id,id);}
  }
  return <div className="entity-inline-row"><dt>{label}{property?.metadata?.compatibility==='unresolved'&&<small className="section-hint">{uiText('Unresolved')} · {property.metadata.reason}</small>}{managed&&<small className="section-hint">{uiText('Source metadata · managed automatically')}</small>}</dt><dd>
    {!draft||props.active===false ? <><div className="entity-inline-value">{property?.target_id&&<span>{mention(property.target_id)}</span>}{managed?<TemporalPropertyValue type={entity.type} name={name} value={property?.value??null}/>:<button type="button" className="entity-inline-activate" aria-label={uiText('Edit ') + label} disabled={!!conflicts&&!property} onClick={begin}>{property?.target_id?uiText('Edit reference'):property?<TemporalPropertyValue type={entity.type} name={name} value={property.value===null?null:property.value.length>220?property.value.slice(0,220)+'…':property.value}/>:uiText('Not set')}</button>}</div></> : <div className="entity-inline-edit" onKeyDown={event=>{
      if(event.nativeEvent.isComposing||event.defaultPrevented)return;
      if(event.key==='Escape'){event.preventDefault();suppressBlur.current=true;cancel();}
      if(event.key==='Enter'&&!event.shiftKey&&(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)&&(draft.kind==='text'&&!draft.value.includes('\n')||event.ctrlKey||event.metaKey)){event.preventDefault();void save();}
    }} onBlur={event=>{
      if(suppressBlur.current){suppressBlur.current=false;return;}
      if(!event.currentTarget.contains(event.relatedTarget as Node)&&draft.kind==='text'&&!draft.error)void save();
    }}>
      {<div className="entity-inline-kind" role="group" aria-label={uiText('Value type')}><button type="button" disabled={busy||!!draft.uncertainCreate} aria-pressed={draft.kind==='entity'} onClick={()=>change({kind:'entity'})}>{uiText('Entity reference')}</button><button type="button" disabled={busy||!!draft.uncertainCreate} aria-pressed={draft.kind==='text'} onClick={()=>change({kind:'text'})}>{uiText('Unresolved text')}</button></div>}
      {persistedDefinition&&property&&<label className="entity-property-compatibility"><input type="checkbox" checked={!!draft.legacy} disabled={busy||!!draft.uncertainCreate} onChange={event=>change({legacy:event.target.checked})}/>{uiText('Preserve as legacy value')}{property.metadata?.reason&&<small>{property.metadata.reason}</small>}</label>}
      {draft.kind==='text'?<PropertyScalarInput label={label} definition={draft.legacy?undefined:persistedDefinition} value={draft.value} disabled={busy||!!draft.uncertainCreate} onChange={value=>change({value})}/>:<EntityReferencePicker vaultId={vaultId} entities={entities} value={draft.target} onChange={target=>change({target})} types={definition?.allowedTargetTypes} subtypes={definition?.allowedTargetSubtypes} disabled={busy||!!draft.uncertainCreate} creation={draft.referenceCreation} onCreationChange={referenceCreation=>change({referenceCreation})} label={label+' · '+uiText('Referenced entity')}/>}
      {draft.error&&<p role="alert">{draft.error}</p>}
      <div className="entity-inline-actions"><button type="button" disabled={busy} onPointerDown={()=>{suppressBlur.current=true;}} onClick={cancel}>{uiText('Discard')}</button>{draft.kind==='entity'||draft.error?<button type="button" disabled={busy||!(draft.kind==='text'?draft.value.trim():draft.target)} onClick={()=>void save()}>{uiText(draft.error?'Retry':'Confirm reference')}</button>:<small>{uiText('Enter to save · Escape to discard')}</small>}</div>
    </div>}
    {property&&!managed&&!draft&&<button type="button" className="entity-inline-remove" disabled={busy} aria-label={uiText('Remove ') + label} onClick={()=>setConfirm(true)}>{uiText('Remove value')}</button>}
    {confirm&&<div role="alertdialog" aria-label={uiText('Remove ') + label}><p>{uiText('Remove this value? This cannot be undone.')}</p><button type="button" disabled={busy} onClick={()=>void remove()}>{uiText('Confirm removal')}</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>{uiText('Cancel')}</button></div>}
    {!draft&&property?.metadata?.compatibility==='legacy_incompatible'&&<p role="status" className="section-hint">{uiText('Needs review')}: {property.metadata.reason}</p>}
    {conflicts&&<p role="alert">{uiText('Conflicting inherited definitions require review in Manage Types before adding a value.')} {conflicts.definitions.map(item=>item.label+' ('+item.valueKind+')').join(', ')}</p>}
    <small className="entity-inline-status" role="status">{busy?uiText('Saving…'):status}</small>
  </dd></div>;
}
