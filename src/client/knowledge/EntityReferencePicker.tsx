import type {ReferenceCreationDraft} from './entity-property-drafts';
import {useEffect,useRef,useState} from 'react';
import {entityLabels,entityTypes,type Entity,type EntityType} from '../../shared/domain';
import {api} from '../api';
import {Select} from '../components/Select';
import {t as uiText} from '../i18n';

interface Props {vaultId:string;entities:Entity[];value:string;onChange:(id:string)=>void;types?:EntityType[];subtypes?:string[];disabled?:boolean;label:string;creation?:ReferenceCreationDraft;onCreationChange?:(creation:ReferenceCreationDraft)=>void}
/** Search pages come from the server. Local entries provide an immediate, bounded fallback. */
export function EntityReferencePicker({vaultId,entities,value,onChange,types=[],subtypes=[],disabled=false,label,creation,onCreationChange}:Props) {
 const [query,setQuery]=useState(''),[page,setPage]=useState(0),[remote,setRemote]=useState<{items:Entity[];nextOffset:number|null;total:number}>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 const [creating,setCreating]=useState(creation?.open??false),[newName,setNewName]=useState(creation?.name??''),[newType,setNewType]=useState<EntityType>(creation?.type??types.find(type=>type!=='source')??'person'),[created,setCreated]=useState<Entity>(),[creatingBusy,setCreatingBusy]=useState(false),[uncertain,setUncertain]=useState(creation?.uncertain??false),[createError,setCreateError]=useState('');
 const lock=useRef(false);
 useEffect(()=>{onCreationChange?.({open:creating,name:newName,type:newType,uncertain});},[creating,newName,newType,uncertain]);
 const typeKey=types.join(','),subtypeKey=subtypes.join(',');
 useEffect(()=>{
  const controller=new AbortController();let active=true;setLoading(true);setError('');
  void api.entityReferenceOptions(vaultId,{query,types,subtypes,offset:page,limit:30,selected:value},controller.signal).then(result=>{if(active)setRemote(result);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:String(reason));}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();};
 },[vaultId,query,typeKey,subtypeKey,page,value,attempt]);
 const selected=created?.id===value?created:entities.find(item=>item.id===value)??remote?.items.find(item=>item.id===value);
 const fallback=entities.filter(item=>item.id===value||!item.archived_at&&(!types.length||types.includes(item.type))&&(!subtypes.length||subtypes.some(subtype=>item.subtypes.includes(subtype)))&&`${item.name} ${(item.aliases??[]).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,30);
 const items=[...(selected?[selected]:[]),...(remote?.items??fallback)].filter((item,index,all)=>all.findIndex(other=>other.id===item.id)===index);
 async function create() {
  if(lock.current||uncertain||!newName.trim()||newType==='source')return;lock.current=true;setCreatingBusy(true);setCreateError('');
  try {
   const entity=await api.createEntity(vaultId,{name:newName.trim(),type:newType,subtypes:subtypes.filter(subtype=>subtype.startsWith(newType+':'))});
   setCreated(entity);onChange(entity.id);setCreating(false);setNewName('');
  } catch {setUncertain(true);setCreateError(uiText('Could not confirm creation. Search for the name and select the saved entity before creating another.'));setQuery(newName.trim());setPage(0);setAttempt(value=>value+1);}
  finally {lock.current=false;setCreatingBusy(false);}
 }
 return <div className="entity-reference-picker">
  <label>{uiText('Find an entity')}<input type="search" autoFocus disabled={disabled} value={query} onChange={event=>{setQuery(event.target.value);setPage(0);setRemote(undefined);}} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}}/></label>
  <Select aria-label={label} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}><option value="">{uiText('Choose an entity…')}</option>{items.map(item=><option key={item.id} value={item.id}>{item.name} · {entityLabels[item.type]}{item.subtypes.length?' · '+item.subtypes.map(value=>value.split(':').pop()).join(', '):''}{item.archived_at?' · '+uiText('Archived'):''}</option>)}</Select>
  {selected?.archived_at&&<p role="status">{uiText('This reference points to an archived entity.')}</p>}
  {loading&&<small role="status">{uiText('Searching…')}</small>}
  {error&&<p role="status">{uiText('Search unavailable. Showing cached matches.')} <button type="button" disabled={disabled} onClick={()=>setAttempt(value=>value+1)}>{uiText('Retry search')}</button></p>}
  {(page>0||remote?.nextOffset!==null&&remote?.nextOffset!==undefined)&&<div className="entity-inline-actions"><button type="button" disabled={disabled||loading||page===0} onClick={()=>setPage(Math.max(0,page-30))}>{uiText('Previous matches')}</button><button type="button" disabled={disabled||loading||remote?.nextOffset===null} onClick={()=>setPage(remote?.nextOffset??page)}>{uiText('More matches')}</button></div>}
  {types.length>0&&types.every(type=>type==='source')&&<small>{uiText('Create Sources through the import workflow.')}</small>}
  {!creating?<button type="button" disabled={disabled||types.length>0&&types.every(type=>type==='source')} onClick={()=>{setCreating(true);setNewName(query);setCreateError('');}}>{uiText('Create a new entity')}</button>:<div className="entity-reference-create" role="group" aria-label={uiText('Create referenced entity')}>
   <label>{uiText('Entity name')}<input value={newName} disabled={disabled||creatingBusy||uncertain} onChange={event=>setNewName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void create();}}}/></label>
   <label>{uiText('Entity type')}<Select value={newType} disabled={disabled||creatingBusy||uncertain} onChange={event=>setNewType(event.target.value as EntityType)}>{(types.length?types:entityTypes).filter(type=>type!=='source').map(type=><option key={type} value={type}>{entityLabels[type]}</option>)}</Select></label>
   <div className="entity-inline-actions"><button type="button" disabled={disabled||creatingBusy||uncertain||!newName.trim()} onClick={()=>void create()}>{uiText('Create and select')}</button><button type="button" disabled={creatingBusy} onClick={()=>setCreating(false)}>{uiText('Return to property')}</button></div>
   {(createError||uncertain)&&<p role="alert">{createError||uiText("Creation outcome is uncertain. Search and select the saved entity; another create request is disabled.")}</p>}
  </div>}
 </div>;
}
