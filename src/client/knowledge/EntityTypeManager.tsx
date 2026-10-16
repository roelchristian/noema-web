import { useState, type FormEvent } from 'react';
import { entityLabels, entityTypes, type EntityType } from '../../shared/domain';
import type { EntitySchema } from '../../shared/entity-schema';
import { api } from '../api';
import { Select } from '../components/Select';

export function EntityTypeManager({vaultId, schema, onChange}: {vaultId: string; schema: EntitySchema; onChange: (schema: EntitySchema) => void}) {
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
  return <details className="entity-type-manager"><summary>Manage types &amp; subtypes</summary><div className="type-manager-body">
    <label>Main entity type<Select aria-label="Main entity type" value={type} disabled={busy} onChange={e => { setType(e.target.value as EntityType); setError(''); }}>{entityTypes.map(t => <option key={t} value={t}>{entityLabels[t]}</option>)}</Select></label>
    <div><h3>Subtypes of {entityLabels[type]}</h3><p className="section-hint">Each subtype inherits the main type’s properties. Subtypes cannot define their own properties.</p><div className="type-field-list">{schema.subtypes.filter(s => s.type === type).map(s => <span key={s.id}>{s.name}</span>)}</div>
      <form className="type-add-form" onSubmit={e => { void save(e,'subtype'); }}><input required maxLength={200} aria-label="New subtype name" placeholder="e.g. Researcher" value={subtype} disabled={busy} onChange={e => setSubtype(e.target.value)}/><button className="button small" disabled={busy}>Add subtype</button></form>
    </div>
    <div><h3>{entityLabels[type]} properties</h3><p className="section-hint">Shared by this main type and all its subtypes. Values are set separately on each entity.</p><div className="type-field-list">{schema.properties[type].map(name => <span key={name}>{name}</span>)}</div>
      <form className="type-add-form" onSubmit={e => { void save(e,'property'); }}><input required maxLength={200} aria-label="New main type property" placeholder="e.g. occupation" value={property} disabled={busy} onChange={e => setProperty(e.target.value)}/><button className="button small" disabled={busy}>Add property to {entityLabels[type]}</button></form>
    </div>{error && <p role="alert" className="dialog-error">{error}</p>}
  </div></details>;
}
