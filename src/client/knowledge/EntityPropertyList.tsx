import {api} from '../api';
import {useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import type {Entity, EntityDetail, Property, PropertyInput} from '../../shared/domain';
import {entityLabels} from '../../shared/domain';
import {propertyDefinitionFor, propertyLabel} from '../../shared/property-definitions';
import {TemporalPropertyValue} from './TemporalPropertyValue';
import {Select} from '../components/Select';
import {t as uiText} from '../i18n';
import {beginPropertySave, endPropertySave, propertySavePending, runPropertyMutation, clearPropertyDraft, getPropertyDraft, propertyDraftSignature, setPropertyDraft, subscribePropertyDrafts, type EntityPropertyDraft} from './entity-property-drafts';

interface Props {
  vaultId: string; entity: EntityDetail; entities: Entity[]; mention: (id: string) => ReactNode;
  onSave: (input: PropertyInput, id?: string) => Promise<unknown>; onRemove: (id: string) => Promise<unknown>; onRefresh?: () => Promise<EntityDetail>;
  density?: 'home'|'compact'|'source'; priority?: readonly string[]; limit?: number;
}
/** Shared ordinary editing surface. The stored name and value remain unchanged by presentation. */
export function EntityPropertyList(props: Props) {
  const {entity, priority = []} = props;
  const [expanded, setExpanded] = useState(false), [query, setQuery] = useState(''), [showAll,setShowAll] = useState(false);
  const populated = new Set(entity.properties.map(property => property.name.toLocaleLowerCase()));
  const unset = entity.propertyNames.filter((name,index,all) => !populated.has(name.toLocaleLowerCase()) && all.findIndex(other=>other.toLocaleLowerCase()===name.toLocaleLowerCase())===index);
  const rank = (name: string) => {const index=priority.indexOf(name.toLowerCase());return index < 0 ? 999 : index;};
  const properties = [...entity.properties].sort((a,b)=>rank(a.name)-rank(b.name)||propertyLabel(a.name).localeCompare(propertyLabel(b.name)));
  return <div className={'entity-inline-properties density-' + (props.density ?? 'home')}>
    <dl className="entity-overview-properties">{(showAll||!props.limit?properties:properties.slice(0,props.limit)).map(property=><PropertyRow key={property.id} {...props} name={property.name} property={property}/>)}</dl>
    {!!props.limit&&properties.length>props.limit&&<button type="button" className="entity-detail-more" aria-expanded={showAll} onClick={()=>setShowAll(value=>!value)}>{uiText(showAll?'Show fewer properties':'Show all properties')} ({properties.length})</button>}
    {!!unset.length && <div className="entity-inline-suggestions"><dl className="entity-overview-properties">{unset.slice(0,3).map(name=><PropertyRow key={name} {...props} name={name}/>)}</dl>
      {unset.length > 3 && <><button type="button" className="entity-detail-more" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{uiText('Add Property')} ({unset.length-3})</button>{expanded&&<><label>{uiText('Find a property')}<input type="search" value={query} onChange={event=>setQuery(event.target.value)}/></label><dl className="entity-overview-properties">{unset.slice(3).filter(name=>propertyLabel(name).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(name=><PropertyRow key={name} {...props} name={name}/>)}</dl></>}</>}
    </div>}
    {!properties.length&&!unset.length&&<p className="entity-detail-empty">{uiText('No fields for this classification.')}</p>}
  </div>;
}
function PropertyRow({name, property, ...props}: Props & {name: string; property?: Property}) {
  const {vaultId, entity, entities, mention, onSave, onRemove} = props;
  const id = property?.id ?? 'new:' + name;
  const draft = useSyncExternalStore(subscribePropertyDrafts, ()=>getPropertyDraft(vaultId,entity.id,id));
  const busy = useSyncExternalStore(subscribePropertyDrafts, ()=>propertySavePending(vaultId,entity.id,id));
  const [status,setStatus] = useState(''), [query,setQuery] = useState(''), [confirm,setConfirm] = useState(false);
  const lock = useRef(false), suppressBlur = useRef(false);
  const definition = propertyDefinitionFor(entity.type,name), label = propertyLabel(name);
  const managed = entity.type === 'source' && ['Import method','Source URL'].includes(name);
  function begin() {
    const initial = {kind: property?.target_id || !property && definition?.valueKind === 'entity_reference' ? 'entity' as const : 'text' as const, value:property?.value ?? '',target:property?.target_id ?? ''};
    setPropertyDraft(vaultId,entity.id,id,{...initial,baseline:propertyDraftSignature(initial)});setStatus('');
  }
  function change(patch: Partial<EntityPropertyDraft>) {if(draft&&!draft.uncertainCreate)setPropertyDraft(vaultId,entity.id,id,{...draft,...patch,error:undefined});}
  function cancel() {clearPropertyDraft(vaultId,entity.id,id);setConfirm(false);setQuery('');}
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
        await onSave(draft.kind==='entity'?{name,target_id:draft.target}:{name,value:draft.value},property?.id);
      });
      clearPropertyDraft(vaultId,entity.id,id,draft);setStatus(uiText('Saved'));
    } catch {
      // Keep a newer edit if another surface changed it during the request.
      if(getPropertyDraft(vaultId,entity.id,id)===draft)setPropertyDraft(vaultId,entity.id,id,{...draft,uncertainCreate:!property||draft.uncertainCreate,error:uiText(!property?'Could not confirm save. Retry checks saved values before resubmitting.':'Could not save. Your changes are retained.')});
    } finally {lock.current=false;endPropertySave(vaultId,entity.id,id);}
  }
  async function remove() {
    if(!property||lock.current||!beginPropertySave(vaultId,entity.id,id))return;lock.current=true;
    try {await runPropertyMutation(vaultId,entity.id,()=>onRemove(property.id));cancel();}
    catch {setStatus(uiText('Could not remove this value. Try again.'));}
    finally {lock.current=false;endPropertySave(vaultId,entity.id,id);}
  }
  const selected = draft?.target ?? property?.target_id;
  const allowed = entities.filter(item=>item.id===selected||!item.archived_at&&(!definition?.allowedTargetTypes?.length||definition.allowedTargetTypes.includes(item.type))&&(!definition?.allowedTargetSubtypes?.length||definition.allowedTargetSubtypes.some(subtype=>item.subtypes.includes(subtype))));
  const matches=allowed.filter(item=>item.id===selected||`${item.name} ${(item.aliases??[]).join(' ')} ${entityLabels[item.type]}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)||a.name.localeCompare(b.name)).slice(0,50);
  const archived=entities.find(item=>item.id===selected)?.archived_at;
  return <div className="entity-inline-row"><dt>{label}{managed&&<small className="section-hint">{uiText('Source metadata · managed automatically')}</small>}</dt><dd>
    {!draft ? <><div className="entity-inline-value">{property?.target_id&&<span>{mention(property.target_id)}</span>}{managed?<TemporalPropertyValue type={entity.type} name={name} value={property?.value??null}/>:<button type="button" className="entity-inline-activate" aria-label={uiText('Edit ') + label} onClick={begin}>{property?.target_id?uiText('Edit reference'):property?<TemporalPropertyValue type={entity.type} name={name} value={property.value===null?null:property.value.length>220?property.value.slice(0,220)+'…':property.value}/>:uiText('Not set')}</button>}</div></> : <div className="entity-inline-edit" onKeyDown={event=>{
      if(event.nativeEvent.isComposing||event.defaultPrevented)return;
      if(event.key==='Escape'){event.preventDefault();suppressBlur.current=true;cancel();}
      if(event.key==='Enter'&&!event.shiftKey&&(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)&&(draft.kind==='text'&&!draft.value.includes('\n')||event.ctrlKey||event.metaKey)){event.preventDefault();void save();}
    }} onBlur={event=>{
      if(suppressBlur.current){suppressBlur.current=false;return;}
      if(!event.currentTarget.contains(event.relatedTarget as Node)&&draft.kind==='text'&&!draft.error)void save();
    }}>
      {<div className="entity-inline-kind" role="group" aria-label={uiText('Value type')}><button type="button" disabled={busy||!!draft.uncertainCreate} aria-pressed={draft.kind==='entity'} onClick={()=>change({kind:'entity'})}>{uiText('Entity reference')}</button><button type="button" disabled={busy||!!draft.uncertainCreate} aria-pressed={draft.kind==='text'} onClick={()=>change({kind:'text'})}>{uiText('Unresolved text')}</button></div>}
      {draft.kind==='text'?<textarea autoFocus rows={draft.value.includes('\n')?3:1} aria-label={label} disabled={busy||!!draft.uncertainCreate} value={draft.value} onChange={event=>change({value:event.target.value})}/>:<>
        <label>{uiText('Find an entity')}<input autoFocus type="search" disabled={busy||!!draft.uncertainCreate} value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}}/></label>
        <Select aria-label={label + ' · ' + uiText('Referenced entity')} disabled={busy||!!draft.uncertainCreate} value={draft.target} onChange={event=>{const target=event.target.value;change({target});}}><option value="">{uiText('Choose an entity…')}</option>{matches.map(item=><option key={item.id} value={item.id}>{item.name} · {entityLabels[item.type]}{item.subtypes.length?' · '+item.subtypes.map(value=>value.split(':').pop()).join(', '):''}{item.archived_at?' · '+uiText('Archived'):''}</option>)}</Select>
        {!!archived&&<p role="status" className="section-hint">{uiText('This reference points to an archived entity.')}</p>}
        {allowed.length>50&&<p className="section-hint">{uiText('Search to narrow the first 50 matches.')}</p>}
      </>}
      {draft.error&&<p role="alert">{draft.error}</p>}
      <div className="entity-inline-actions"><button type="button" disabled={busy} onPointerDown={()=>{suppressBlur.current=true;}} onClick={cancel}>{uiText('Discard')}</button>{draft.kind==='entity'||draft.error?<button type="button" disabled={busy||!(draft.kind==='text'?draft.value.trim():draft.target)} onClick={()=>void save()}>{uiText(draft.error?'Retry':'Confirm reference')}</button>:<small>{uiText('Enter to save · Escape to discard')}</small>}</div>
    </div>}
    {property&&!managed&&!draft&&<button type="button" className="entity-inline-remove" disabled={busy} aria-label={uiText('Remove ') + label} onClick={()=>setConfirm(true)}>{uiText('Remove value')}</button>}
    {confirm&&<div role="alertdialog" aria-label={uiText('Remove ') + label}><p>{uiText('Remove this value? This cannot be undone.')}</p><button type="button" disabled={busy} onClick={()=>void remove()}>{uiText('Confirm removal')}</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>{uiText('Cancel')}</button></div>}
    <small className="entity-inline-status" role="status">{busy?uiText('Saving…'):status}</small>
  </dd></div>;
}
