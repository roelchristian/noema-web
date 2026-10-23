import {PropertyDefinitionManager} from './PropertyDefinitionManager';
import {propertyLabel} from '../../shared/property-definitions';
import {t as uiText} from '../i18n';
import { useState, type FormEvent } from 'react';
import { entityLabels, entityTypes, type EntityType } from '../../shared/domain';
import {subtypeDisplayName, type EntitySchema } from '../../shared/entity-schema';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { ColorPicker } from '../settings/ColorPicker';
import type { Appearance, PillColor } from '../settings/appearance';
import {pageIcons,type PageIconId} from '../../shared/page-icons';
import {subtypeIcon,type SubtypeIcons} from '../../shared/entity-icons';

export function EntityTypeManager({vaultId, schema, onChange, entityColors, onColorChange,subtypeIcons={},onSubtypeIconChange}: {
  vaultId: string; schema: EntitySchema; onChange: (schema: EntitySchema) => void;
  entityColors: Appearance['entityColors']; onColorChange: (type: EntityType, color: PillColor) => void;
  subtypeIcons?:SubtypeIcons;onSubtypeIconChange?:(id:string,icon:PageIconId|null|undefined)=>void;
}) {
  const [type, setType] = useState<EntityType>('person');
  const [subtype, setSubtype] = useState(''), [property, setProperty] = useState('');
  const [selectedSubtype, setSelectedSubtype] = useState('');
  const subtypes = schema.subtypes.filter(item => item.type === type);
  const propertySubtype = subtypes.find(item => item.id === selectedSubtype) ?? subtypes[0];
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(event: FormEvent, kind: 'subtype' | 'property') {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (kind === 'property' && !propertySubtype) return;
      const next = await (kind === 'subtype' ? api.addSubtype(vaultId,type,subtype) : api.addSubtypeProperty(vaultId,type,propertySubtype!.id,property));
      onChange(next);
      if (kind === 'subtype') setSelectedSubtype(next.subtypes.find(item => item.type === type && item.name.toLowerCase() === subtype.trim().toLowerCase())?.id ?? '');
      if (kind === 'subtype') setSubtype(''); else setProperty('');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="entity-type-manager"><div className="type-manager-body">
    <div className="entity-type-options" role="group" aria-label={uiText("Main entity type")}>{entityTypes.map(t => <button key={t} type="button" aria-pressed={type === t} disabled={busy} onClick={() => { setType(t); setSelectedSubtype(''); setProperty(''); setError(''); }}><span className={'entity-icon ' + t}><Icon name={t}/></span>{uiText(entityLabels[t])}</button>)}</div>
    <div>
      <h3>{uiText(entityLabels[type])}{" " + uiText("color")}</h3>
      <p className="section-hint">{uiText("Applies to icons and mentions, including subtypes.")}</p>
      <div className="entity-color-row">
        <label htmlFor={'color-' + type}>{uiText(entityLabels[type])}</label>
        <span className={'mention ' + type} aria-hidden="true"><Icon name={type}/>{uiText(entityLabels[type])}</span>
        <ColorPicker key={type} id={'color-' + type} label={entityLabels[type] + ' color'} value={entityColors[type]} onChange={color => onColorChange(type, color)}/>
      </div>
    </div>
    <div><h3>{uiText("Subtypes of") + " "}{uiText(entityLabels[type])}</h3><p className="section-hint">{uiText("Choose an icon for each subtype. Colors come from the main category.")}</p><p className="section-hint">{uiText("For multiple subtypes, the first assigned icon is used.")}</p><div className="subtype-icon-list">{subtypes.map(s => {
      const icon=subtypeIcon(type,s.id,subtypeIcons),name=subtypeDisplayName(s,subtypes);
      return <div key={s.id} className="subtype-icon-row" title={s.description}><span className={'entity-icon '+type}><Icon name={icon?'page:'+icon:type}/></span><label htmlFor={'subtype-icon-'+s.id}>{name}</label><Select id={'subtype-icon-'+s.id} aria-label={uiText('Icon for {name}',{name})} value={Object.hasOwn(subtypeIcons,s.id)?subtypeIcons[s.id]??'category':'default'} disabled={busy||!onSubtypeIconChange} onChange={event=>onSubtypeIconChange?.(s.id,event.target.value==='default'?undefined:event.target.value==='category'?null:event.target.value as PageIconId)}><option value="default">{uiText('Default icon')}</option><option value="category">{uiText('Use category icon')}</option>{pageIcons.map(item=><option key={item.id} value={item.id}>{uiText(item.label)}</option>)}</Select></div>;
    })}</div>
      <form className="type-add-form" onSubmit={e => { void save(e,'subtype'); }}><input required maxLength={200} aria-label={uiText("New subtype name")} placeholder={uiText("e.g. Researcher")} value={subtype} disabled={busy} onChange={e => setSubtype(e.target.value)}/><button className="button small" disabled={busy}>{uiText("Add subtype")}</button></form>
    </div>
    <div><h3>{uiText("Shared category properties")}</h3><p className="section-hint">{uiText("Fields shared by all entities in this category.")}</p><div className="type-field-list">{schema.properties[type].map(name => <span key={name}>{propertyLabel(name)}</span>)}</div></div>
    <div><h3>{uiText("Subtype properties")}</h3>
      {propertySubtype ? <>
        <Select aria-label={uiText("Subtype for property definitions")} value={propertySubtype.id} disabled={busy} onChange={event => { setSelectedSubtype(event.target.value); setProperty(''); }}>
          {subtypes.map(item => <option key={item.id} value={item.id}>{subtypeDisplayName(item,subtypes)}</option>)}
        </Select>
        <p className="section-hint">{propertySubtype.description}</p>
        <p className="section-hint">{uiText("Fields shared by all") + " "}{propertySubtype.name}{" " + uiText("entities.")}</p>
        <div className="type-field-list">{(schema.subtypeProperties[propertySubtype.id] ?? []).map(name => <span key={name}>{propertyLabel(name)}</span>)}</div>
        <form className="type-add-form" onSubmit={event => { void save(event,'property'); }}><input required maxLength={200} aria-label={uiText("New subtype property")} placeholder={uiText("e.g. occupation")} value={property} disabled={busy} onChange={event => setProperty(event.target.value)}/><button className="button small" disabled={busy}>{uiText("Add property to") + " "}{propertySubtype.name}</button></form>
      </> : <p className="section-hint">{uiText("Create a subtype to define its properties.")}</p>}
    </div><PropertyDefinitionManager key={type} vaultId={vaultId} type={type} schema={schema} onChange={onChange}/>{error && <p role="alert" className="dialog-error">{error}</p>}
  </div></div>;
}
