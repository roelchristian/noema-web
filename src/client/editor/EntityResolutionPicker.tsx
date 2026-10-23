import {useEffect,useId,useRef,useState} from 'react';
import {entityLabels,type Entity} from '../../shared/domain';
import {annotationSuggestions} from './selection-annotation';
import type {MentionMatchOptions} from './mention-picker';
import {Icon} from '../components/Icon';

/** Shared identity choice only. Callers own linking, alias writes and transactions. */
export function EntityResolutionPicker({entities,selection,options,disabled=false,onChoose,query:controlledQuery,onQuery,idPrefix,autoFocus=false,compact=false}:{entities:Entity[];selection:string;options?:MentionMatchOptions;disabled?:boolean;onChoose:(entity:Entity)=>void;query?:string;onQuery?:(query:string)=>void;idPrefix?:string;autoFocus?:boolean;compact?:boolean}) {
  const unique=useId(),prefix=idPrefix??`resolution-${unique}`;
  const [localQuery,setLocalQuery]=useState(''),[index,setIndex]=useState(0);
  const query=controlledQuery??localQuery;
  const {exact,results}=annotationSuggestions(entities,selection,query,options);
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{container.current?.querySelector('[aria-selected=true]')?.scrollIntoView?.({block:'nearest'});},[index,query]);
  const current=results[Math.min(index,results.length-1)];
  return <div ref={container} className="entity-resolution-picker">
    <input autoFocus={autoFocus} aria-label="Search knowledge entities" placeholder="Find an existing entity…" disabled={disabled} value={query} onChange={event=>{setLocalQuery(event.target.value);onQuery?.(event.target.value);setIndex(0);}} onKeyDown={event=>{
      if(event.nativeEvent.isComposing)return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();setIndex(value=>(value+(event.key==='ArrowDown'?1:-1)+results.length)%Math.max(1,results.length));}
      if(event.key==='Enter'&&current){event.preventDefault();event.stopPropagation();onChoose(current);}
    }} role="combobox" aria-expanded="true" aria-controls={`${prefix}-results`} aria-activedescendant={current?`${prefix}-${current.id}`:undefined}/>
    <div className="selection-entity-results" id={`${prefix}-results`} role="listbox" aria-label="Matching identities">
      {results.map(entity=><button id={`${prefix}-${entity.id}`} role="option" aria-selected={entity.id===current?.id} className={entity.id===current?.id?'highlight':''} type="button" key={entity.id} disabled={disabled} onClick={()=>onChoose(entity)}><Icon name={entity.type} entity={entity}/><span>{entity.name}<small>{entityLabels[entity.type]}{exact.some(item=>item.id===entity.id)?' · Exact match':''}{!compact&&entity.description?' · '+entity.description:''}</small>{!compact&&!!entity.aliases?.length&&<small>Aliases: {entity.aliases.join('; ')}</small>}</span></button>)}
      {!results.length&&<p>No matching entities. Search another name or alias.</p>}
    </div>
    {exact.length>1&&<p role="status">Ambiguous identity: choose deliberately from {exact.length} exact matches.</p>}
  </div>;
}
