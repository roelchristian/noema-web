import { Select } from '../components/Select';
import { useState, type FormEvent } from 'react';
import { entityLabels, entityTypes, type EntityInput, type EntityType } from '../../shared/domain';
import { SubtypePicker } from './SubtypePicker';
import { useEntitySchema } from './useEntitySchema';
import { Modal } from '../components/Modal';
export interface CreateEntityRequest {name?: string; source?: boolean; onCreated?: (id: string) => void}
export function CreateEntityDialog({vaultId, initial, onSubmit, onClose}: {vaultId: string; initial: CreateEntityRequest; onSubmit: (input: EntityInput) => Promise<void>; onClose: () => void}) {
  const [name, setName] = useState(initial.name || ''), [type, setType] = useState<EntityType>(initial.source ? 'source' : 'person');
  const {schema, error: schemaError} = useEntitySchema(vaultId);
  const [subtypes, setSubtypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await onSubmit({name, type, subtypes}); onClose(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <Modal onClose={() => { if (!busy) onClose(); }} titleId="create-dialog-title"><form onSubmit={submit}>
    <div className="dialog-eyebrow">KNOWLEDGE ENTITY</div><h2 id="create-dialog-title">Create {initial.source ? 'a source' : 'an entity'}</h2><p>A reusable object you can reference across your vault’s pages.</p>
    <label>Name<input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder="e.g. Ursula K. Le Guin" autoComplete="off"/></label>
    <label>Entity type<Select value={type} onChange={e => { setType(e.target.value as EntityType); setSubtypes([]); }} disabled={initial.source || busy}>{entityTypes.map(t => <option key={t} value={t}>{entityLabels[t]}</option>)}</Select></label>
    <SubtypePicker type={type} value={subtypes} subtypes={schema.subtypes} onChange={setSubtypes} disabled={busy}/>
    <p className="section-hint">Subtypes inherit all properties from their main type.</p>
    {schemaError && <p role="alert">{schemaError}</p>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy}>Create {initial.source ? 'source' : 'entity'}</button></div>
  </form></Modal>;
}
