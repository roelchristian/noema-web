import {PropertyDefinitionManager} from './PropertyDefinitionManager';
import {inheritedPropertyDefinitions, propertyDefinitionConflicts} from '../../shared/property-definitions';
import {t as uiText} from '../i18n';
import {useRef, useState, type FormEvent} from 'react';
import {entityLabels, entityTypes, type EntityType} from '../../shared/domain';
import {subtypeDisplayName, type EntitySchema} from '../../shared/entity-schema';
import {api} from '../api';
import {Icon} from '../components/Icon';
import {ColorPicker} from '../settings/ColorPicker';
import type {Appearance, PillColor} from '../settings/appearance';
import {pageIcons, type PageIconId} from '../../shared/page-icons';
import {subtypeIcon, type SubtypeIcons} from '../../shared/entity-icons';

export function EntityTypeManager({vaultId,schema,onChange,entityColors,onColorChange,subtypeIcons={},onSubtypeIconChange,onResetSubtypeIcons}: {
  vaultId:string;schema:EntitySchema;onChange:(schema:EntitySchema)=>void;
  entityColors:Appearance['entityColors'];onColorChange:(type:EntityType,color:PillColor)=>void;
  onResetSubtypeIcons?:(ids:string[])=>void;subtypeIcons?:SubtypeIcons;onSubtypeIconChange?:(id:string,icon:PageIconId|null|undefined)=>void;
}) {
  const [inspectRequest,setInspectRequest]=useState<{id:string}>();
  function inspect(id:string){setInspectRequest({id});setView('properties');}
  const [type,setType]=useState<EntityType>('person'),[view,setView]=useState<'types'|'properties'>('types');
  const [mobileDetail,setMobileDetail]=useState(false),[subtypeDrafts,setSubtypeDrafts]=useState<Partial<Record<EntityType,string>>>({});
  const [selectedSubtypes,setSelectedSubtypes]=useState<Partial<Record<EntityType,string>>>({});
  const [palette,setPalette]=useState(''),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const heading=useRef<HTMLHeadingElement>(null),paletteTrigger=useRef<HTMLButtonElement|null>(null),typeButtons=useRef<Partial<Record<EntityType,HTMLButtonElement|null>>>({});
  const subtypes=schema.subtypes.filter(item=>item.type===type),selectedSubtype=selectedSubtypes[type]??'';
  const effective=inheritedPropertyDefinitions(schema,type,selectedSubtype?[selectedSubtype]:[]),conflicts=propertyDefinitionConflicts(effective);
  const subtype=subtypeDrafts[type]??'';
  function closePalette(){setPalette('');setSearch('');paletteTrigger.current?.focus();}
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{const next=await api.addSubtype(vaultId,type,subtype);onChange(next);setSubtypeDrafts(value=>({...value,[type]:''}));}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}}
  return <div className="entity-schema-manager">
    <div className="schema-views" role="group" aria-label={uiText('Entity settings view')}>
      <button type="button" aria-pressed={view==='types'} onClick={()=>setView('types')}>{uiText('Types & subtypes')}</button>
      <button type="button" aria-pressed={view==='properties'} onClick={()=>setView('properties')}>{uiText('Properties')}</button>
    </div>
    <div hidden={view!=='types'} className="schema-types" data-detail={mobileDetail}>
      <nav className="schema-type-nav" aria-label={uiText('Main entity type')}>{entityTypes.map(item=><button ref={node=>{typeButtons.current[item]=node;}} key={item} type="button" aria-pressed={type===item} disabled={busy} onClick={()=>{setType(item);setMobileDetail(true);setPalette('');setError('');requestAnimationFrame(()=>heading.current?.focus());}}><span className={'entity-icon '+item}><Icon name={item}/></span><span>{uiText(entityLabels[item])}<small>{schema.subtypes.filter(subtype=>subtype.type===item).length} {uiText('subtypes')}</small></span></button>)}</nav>
      <div className="schema-type-inspector">
        <button type="button" className="schema-back" onClick={()=>{setMobileDetail(false);requestAnimationFrame(()=>typeButtons.current[type]?.focus());}}>{uiText('Back to types')}</button>
        <h3 ref={heading} tabIndex={-1}>{uiText(entityLabels[type])}</h3>
        <div className="entity-color-row"><span className={'mention '+type}><Icon name={type}/>{uiText(entityLabels[type])}</span><ColorPicker key={type} id={'color-'+type} label={entityLabels[type]+' color'} value={entityColors[type]} onChange={color=>onColorChange(type,color)}/></div>
        <p className="section-hint">{uiText('Colors and icons apply in this browser only. Subtypes inherit the category color. For multiple subtypes, the first assigned icon is used.')}</p>
        <div className="schema-section-heading"><h4>{uiText('Subtypes')}</h4><button type="button" disabled={!onResetSubtypeIcons} onClick={()=>onResetSubtypeIcons?.(subtypes.map(item=>item.id))}>{uiText('Reset icons')}</button></div>
        <div className="schema-subtypes">{subtypes.map(item=>{const icon=subtypeIcon(type,item.id,subtypeIcons),name=subtypeDisplayName(item,subtypes);return <div key={item.id} className="schema-subtype-row">
          <button type="button" className={'entity-icon '+type} aria-label={uiText('Icon for {name}',{name})} aria-expanded={palette===item.id} disabled={!onSubtypeIconChange} onClick={event=>{paletteTrigger.current=event.currentTarget;setPalette(item.id);setSearch('');}}><Icon name={icon?'page:'+icon:type}/></button>
          <button type="button" aria-pressed={selectedSubtype===item.id} title={item.description} onClick={()=>setSelectedSubtypes(value=>({...value,[type]:item.id}))}>{name}</button>
          <details className="schema-overflow"><summary aria-label={uiText('Options for {name}',{name})}>⋯</summary><p>{item.description||name}</p><button type="button" onClick={()=>onSubtypeIconChange?.(item.id,undefined)}>{uiText('Default icon')}</button><button type="button" onClick={()=>onSubtypeIconChange?.(item.id,null)}>{uiText('Use category icon')}</button></details>
        </div>;})}</div>
        {palette&&<section className="schema-icon-palette" aria-label={uiText('Choose subtype icon')} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();closePalette();}}}>
          <div className="schema-section-heading"><h4>{uiText('Choose subtype icon')}</h4><button type="button" onClick={closePalette}>{uiText('Close')}</button></div>
          <input autoFocus type="search" aria-label={uiText('Search icons')} value={search} onChange={event=>setSearch(event.target.value)}/>
          <div className="schema-icon-options">{[{id:'default',label:'Default icon'},{id:'category',label:'Use category icon'},...pageIcons].filter(item=>item.label.toLowerCase().includes(search.toLowerCase())).map(item=><button type="button" key={item.id} aria-pressed={item.id===(Object.hasOwn(subtypeIcons,palette)?subtypeIcons[palette]??'category':'default')} onClick={()=>{onSubtypeIconChange?.(palette,item.id==='default'?undefined:item.id==='category'?null:item.id as PageIconId);closePalette();}}>{item.id!=='default'&&item.id!=='category'&&<Icon name={'page:'+item.id}/>}<span>{uiText(item.label)}</span></button>)}</div>
        </section>}
        <form className="type-add-form" onSubmit={event=>{void save(event);}}><input required maxLength={200} aria-label={uiText('New subtype name')} placeholder={uiText('e.g. Researcher')} value={subtype} disabled={busy} onChange={event=>setSubtypeDrafts(value=>({...value,[type]:event.target.value}))}/><button className="button small" disabled={busy}>{uiText('Add subtype')}</button></form>
        <div className="schema-section-heading"><h4>{uiText('Effective properties')}</h4><button type="button" aria-pressed={!selectedSubtype} onClick={()=>setSelectedSubtypes(value=>({...value,[type]:''}))}>{uiText('Whole type')}</button></div>
        <p className="section-hint">{selectedSubtype?subtypes.find(item=>item.id===selectedSubtype)?.name:uiText(entityLabels[type])} · {effective.length} {uiText('properties')}</p>
        {conflicts.length>0&&<details className="property-definition-conflicts"><summary>{uiText('Schema issues')} ({conflicts.length})</summary><p>{uiText('These inherited definitions conflict when used together. Historical authored values remain preserved.')}</p>{conflicts.map(conflict=><p key={conflict.key}>{conflict.definitions.map(item=><button type="button" key={item.id} onClick={()=>inspect(item.id)}>{item.label} · {item.valueKind.replace(/_/g,' ')}</button>)}</p>)}</details>}
        <div className="schema-property-summary">{effective.map(item=><details key={item.id}><summary>{item.label}<small>{item.scope.kind==='main_type'?entityLabels[type]:subtypes.find(subtype=>item.scope.kind==='subtype'&&subtype.id===item.scope.subtypeId)?.name}</small></summary><p>{item.description||item.valueKind.replace(/_/g,' ')} · {item.cardinality==='one'?uiText('Single value'):uiText('Multiple values')}</p><code>{item.key}</code><button type="button" onClick={()=>inspect(item.id)}>{uiText('Inspect property')}</button></details>)}</div>
        {error&&<p role="alert" className="dialog-error">{error}</p>}
      </div>
    </div>
    <div hidden={view!=='properties'}><PropertyDefinitionManager inspectRequest={inspectRequest} vaultId={vaultId} type={type} schema={schema} onChange={onChange}/></div>
  </div>;
}
