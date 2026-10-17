import { useState, type FormEvent } from 'react';
import { entityLabels, entityTypes, type EntityType } from '../../shared/domain';
import type { EntitySchema } from '../../shared/entity-schema';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Select } from '../components/Select';
import { ColorPicker } from '../settings/ColorPicker';
import type { Appearance, PillColor } from '../settings/appearance';

export function EntityTypeManager({vaultId, schema, onChange, entityColors, onColorChange}: {
  vaultId: string; schema: EntitySchema; onChange: (schema: EntitySchema) => void;
  entityColors: Appearance['entityColors']; onColorChange: (type: EntityType, color: PillColor) => void;
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
    <div className="entity-type-options" role="group" aria-label="Main entity type">{entityTypes.map(t => <button key={t} type="button" aria-pressed={type === t} disabled={busy} onClick={() => { setType(t); setSelectedSubtype(''); setProperty(''); setError(''); }}><span className={'entity-icon ' + t}><Icon name={t}/></span>{entityLabels[t]}</button>)}</div>
    <div>
      <h3>{entityLabels[type]} color</h3>
      <p className="section-hint">Used for this type’s icons and mentions, including its subtypes. Colors save in this browser.</p>
      <div className="entity-color-row">
        <label htmlFor={'color-' + type}>{entityLabels[type]}</label>
        <span className={'mention ' + type} aria-hidden="true"><Icon name={type}/>{entityLabels[type]}</span>
        <ColorPicker key={type} id={'color-' + type} label={entityLabels[type] + ' color'} value={entityColors[type]} onChange={color => onColorChange(type, color)}/>
      </div>
    </div>
    <div><h3>Subtypes of {entityLabels[type]}</h3><p className="section-hint">Define fields on a subtype to share them with every entity assigned to it. Values are entered separately on each entity.</p><div className="type-field-list">{schema.subtypes.filter(s => s.type === type).map(s => <span key={s.id}><Icon name={type}/>{s.name}</span>)}</div>
      <form className="type-add-form" onSubmit={e => { void save(e,'subtype'); }}><input required maxLength={200} aria-label="New subtype name" placeholder="e.g. Researcher" value={subtype} disabled={busy} onChange={e => setSubtype(e.target.value)}/><button className="button small" disabled={busy}>Add subtype</button></form>
    </div>
    <div><h3>Shared category properties</h3><p className="section-hint">Existing category fields are inherited by every entity in this category, alongside its subtype fields.</p><div className="type-field-list">{schema.properties[type].map(name => <span key={name}>{name}</span>)}</div></div>
    <div><h3>Subtype properties</h3>
      {propertySubtype ? <>
        <Select aria-label="Subtype for property definitions" value={propertySubtype.id} disabled={busy} onChange={event => { setSelectedSubtype(event.target.value); setProperty(''); }}>
          {subtypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <p className="section-hint">Every {propertySubtype.name} entity inherits these fields and the category fields above.</p>
        <div className="type-field-list">{(schema.subtypeProperties[propertySubtype.id] ?? []).map(name => <span key={name}>{name}</span>)}</div>
        <form className="type-add-form" onSubmit={event => { void save(event,'property'); }}><input required maxLength={200} aria-label="New subtype property" placeholder="e.g. occupation" value={property} disabled={busy} onChange={event => setProperty(event.target.value)}/><button className="button small" disabled={busy}>Add property to {propertySubtype.name}</button></form>
      </> : <p className="section-hint">Create a subtype to define its properties.</p>}
    </div>{error && <p role="alert" className="dialog-error">{error}</p>}
  </div></div>;
}
