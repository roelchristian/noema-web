import { useState, type FormEvent } from 'react';
import { entityLabels, entityTypes, type EntityType } from '../../shared/domain';
import type { EntitySchema } from '../../shared/entity-schema';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ColorPicker } from '../settings/ColorPicker';
import type { Appearance, PillColor } from '../settings/appearance';

export function EntityTypeManager({vaultId, schema, onChange, entityColors, onColorChange}: {
  vaultId: string; schema: EntitySchema; onChange: (schema: EntitySchema) => void;
  entityColors: Appearance['entityColors']; onColorChange: (type: EntityType, color: PillColor) => void;
}) {
  const [type, setType] = useState<EntityType>('person');
  const [subtype, setSubtype] = useState(''), [property, setProperty] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(event: FormEvent, kind: 'subtype' | 'property') {
    event.preventDefault(); setBusy(true); setError('');
    try {
      onChange(await (kind === 'subtype' ? api.addSubtype(vaultId,type,subtype) : api.addTypeProperty(vaultId,type,property)));
      if (kind === 'subtype') setSubtype(''); else setProperty('');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="entity-type-manager"><div className="type-manager-body">
    <div className="entity-type-options" role="group" aria-label="Main entity type">{entityTypes.map(t => <button key={t} type="button" aria-pressed={type === t} disabled={busy} onClick={() => { setType(t); setError(''); }}><span className={'entity-icon ' + t}><Icon name={t}/></span>{entityLabels[t]}</button>)}</div>
    <div>
      <h3>{entityLabels[type]} color</h3>
      <p className="section-hint">Used for this type’s icons and mentions, including its subtypes. Colors save in this browser.</p>
      <div className="entity-color-row">
        <label htmlFor={'color-' + type}>{entityLabels[type]}</label>
        <span className={'mention ' + type} aria-hidden="true"><Icon name={type}/>{entityLabels[type]}</span>
        <ColorPicker key={type} id={'color-' + type} label={entityLabels[type] + ' color'} value={entityColors[type]} onChange={color => onColorChange(type, color)}/>
      </div>
    </div>
    <div><h3>Subtypes of {entityLabels[type]}</h3><p className="section-hint">Each subtype inherits the main type’s properties. Subtypes cannot define their own properties.</p><div className="type-field-list">{schema.subtypes.filter(s => s.type === type).map(s => <span key={s.id}><Icon name={type}/>{s.name}</span>)}</div>
      <form className="type-add-form" onSubmit={e => { void save(e,'subtype'); }}><input required maxLength={200} aria-label="New subtype name" placeholder="e.g. Researcher" value={subtype} disabled={busy} onChange={e => setSubtype(e.target.value)}/><button className="button small" disabled={busy}>Add subtype</button></form>
    </div>
    <div><h3>{entityLabels[type]} properties</h3><p className="section-hint">Shared by this main type and all its subtypes. Values are set separately on each entity.</p><div className="type-field-list">{schema.properties[type].map(name => <span key={name}>{name}</span>)}</div>
      <form className="type-add-form" onSubmit={e => { void save(e,'property'); }}><input required maxLength={200} aria-label="New main type property" placeholder="e.g. occupation" value={property} disabled={busy} onChange={e => setProperty(e.target.value)}/><button className="button small" disabled={busy}>Add property to {entityLabels[type]}</button></form>
    </div>{error && <p role="alert" className="dialog-error">{error}</p>}
  </div></div>;
}
