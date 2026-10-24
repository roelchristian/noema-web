import {useEffect, useId, useRef, useState} from 'react';
import type {Entity, PageSummary} from '../../shared/domain';
import {t as uiText} from '../i18n';
import {canonicalRelationshipPredicates,canonicalRelationshipLabel} from '../../shared/relationship-predicates';

export type ConnectTarget = {kind:'entity'|'page';id:string;name:string;type:string};
export type ConnectOptions = {annotation:string;pinned:boolean;predicate:string};
/** One picker for intentional connections. Choosing a result saves; options are optional. */
export function ConnectPicker({sourceLabel,entities=[],pages=[],excludeEntityIds=[],excludePageIds=[],relationships=false,disabled=false,onConnect,onCancel}: {
  sourceLabel:string; entities?:Entity[]; pages?:PageSummary[]; excludeEntityIds?:string[]; excludePageIds?:string[];
  relationships?:boolean;disabled?:boolean;onConnect:(target:ConnectTarget,options:ConnectOptions)=>Promise<void>;onCancel?:()=>void;
}) {
  const id=useId(),lock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [query,setQuery]=useState(''),[kind,setKind]=useState<'all'|'entity'|'page'>('all');
  const [annotation,setAnnotation]=useState(''),[pinned,setPinned]=useState(false),[predicate,setPredicate]=useState('Related to');
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const targets:ConnectTarget[]=[
    ...entities.filter(item=>!excludeEntityIds.includes(item.id)&&!item.archived_at&&!item.inactive&&[item.name,...item.aliases??[],item.type].some(value=>value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).map(item=>({kind:'entity' as const,id:item.id,name:item.name,type:item.type})),
    ...pages.filter(item=>!excludePageIds.includes(item.id)&&!item.archived_at&&(item.title||'Untitled').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(item=>({kind:'page' as const,id:item.id,name:item.title||'Untitled',type:'Page'})),
  ].filter(item=>kind==='all'||item.kind===kind).slice(0,50);
  async function connect(target:ConnectTarget) {
    if(lock.current||disabled)return;
    lock.current=true;setPending(true);setError('');
    try {await onConnect(target,{annotation,pinned,predicate:canonicalRelationshipLabel(predicate.trim()||'Related to')});if(alive.current){setQuery('');setAnnotation('');setPinned(false);}}
    catch(value){if(alive.current)setError(value instanceof Error?value.message:String(value));}
    finally{lock.current=false;if(alive.current)setPending(false);}
  }
  return <section className="connect-picker" aria-label={uiText('Add connection')}>
    <p className="connect-picker-from">{uiText('From:')} {sourceLabel}</p>
    <label htmlFor={id+'-search'}>{uiText('Find an entity or page')}</label>
    <input id={id+'-search'} type="search" value={query} disabled={pending||disabled} placeholder={uiText('Search names, aliases or types…')} onChange={event=>setQuery(event.target.value)}/>
    {!!entities.length&&!!pages.length&&<div className="connect-picker-filters" role="group" aria-label={uiText('Connection target type')}>{(['all','entity','page'] as const).map(value=><button key={value} type="button" aria-pressed={kind===value} disabled={pending||disabled} onClick={()=>setKind(value)}>{uiText(value==='all'?'All':value==='entity'?'Entities':'Pages')}</button>)}</div>}
    {relationships&&<label>{uiText('Relationship')}<input list={id+'-predicates'} value={predicate} maxLength={200} disabled={pending||disabled} onChange={event=>setPredicate(event.target.value)}/><datalist id={id+'-predicates'}>{canonicalRelationshipPredicates.map(item=><option key={item.label} value={item.label}/>)}</datalist></label>}
    <details><summary>{uiText('Options')}</summary><label>{uiText('Connection note (optional)')}<textarea value={annotation} maxLength={2000} rows={2} disabled={pending||disabled} onChange={event=>setAnnotation(event.target.value)}/></label><label className="connect-picker-pin"><input type="checkbox" checked={pinned} disabled={pending||disabled} onChange={event=>setPinned(event.target.checked)}/>{uiText('Featured')}</label></details>
    <div className="connect-picker-results page-entity-candidates" role="group" aria-label={uiText('Available connections')}>{targets.map(item=><button type="button" key={item.kind+':'+item.id} disabled={pending||disabled} aria-label={uiText('Connect')+' '+item.name} onClick={()=>void connect(item)}><span>{item.name}</span><small>{uiText(item.type)}</small></button>)}{!targets.length&&<p>{uiText('No matching connections.')}</p>}</div>
    {error&&<p role="alert">{error}</p>}{pending&&<p role="status">{uiText('Saving connection…')}</p>}
    {onCancel&&<button type="button" className="button small" disabled={pending} onClick={onCancel}>{uiText('Cancel')}</button>}
  </section>;
}
