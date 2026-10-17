import { SourceAttachments } from './SourceAttachments';
import type { SourceFile } from '../../shared/domain';
import { Select } from '../components/Select';
import { useState, type FormEvent } from 'react';
import { entityLabels, entityTypes, type EntityInput, type EntityType } from '../../shared/domain';
import { SubtypePicker } from './SubtypePicker';
import { useEntitySchema } from './useEntitySchema';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { AliasInput, parseAliases } from './AliasInput';
export interface CreateEntityRequest {name?: string; source?: boolean; onCreated?: (id: string) => void}
export function CreateEntityDialog({vaultId, initial, onSubmit, onClose}: {vaultId: string; initial: CreateEntityRequest; onSubmit: (input: EntityInput) => Promise<void>; onClose: () => void}) {
  const [name, setName] = useState(initial.name || ''), [type, setType] = useState<EntityType>(initial.source ? 'source' : 'person');
  const {schema, error: schemaError} = useEntitySchema(vaultId);
  const [subtypes, setSubtypes] = useState<string[]>([]);
  const [attachments,setAttachments]=useState<SourceFile[]>([]),[uploading,setUploading]=useState(false);
  const [aliases, setAliases] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); if(busy || !name.trim() || uploading || (type==='source'&&!attachments.length))return; setBusy(true); setError('');
    try { await onSubmit({name:name.trim(), aliases: parseAliases(aliases), type, subtypes, ...(type==='source'?{attachmentIds:attachments.map(file=>file.id)}:{})}); onClose(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const namePlaceholder: Partial<Record<EntityType,string>> = {person:'e.g. Ursula K. Le Guin',place:'e.g. Kyoto',organization:'e.g. The Royal Society',event:'e.g. World Expo 2025',creativework:'e.g. The Left Hand of Darkness',organism:'e.g. Ginkgo biloba',culture:'e.g. Japanese',concept:'e.g. Systems thinking',source:'e.g. Interview with Ursula K. Le Guin'};
  return <Modal className="create-entity-dialog" onClose={() => { if (!busy&&!uploading) onClose(); }} titleId="create-dialog-title"><form onSubmit={submit}>
    <header className="create-entity-header"><span className="create-entity-icon" aria-hidden="true"><Icon name={type}/></span><div><h2 id="create-dialog-title">{initial.source ? 'New source' : 'New entity'}</h2><p>Add to your knowledge library.</p></div><button type="button" aria-label="Close entity creation" disabled={busy||uploading} onClick={onClose}><Icon name="close"/></button></header>
    <div className="create-entity-fields">
      <label>Entity type<Select aria-label="Entity type" value={type} onChange={e => { setType(e.target.value as EntityType); setSubtypes([]); setAttachments([]); setError(''); }} disabled={initial.source || busy || uploading}>{entityTypes.map(t => <option key={t} value={t}>{entityLabels[t]}</option>)}</Select></label>
      <label>Name<input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} disabled={busy} placeholder={namePlaceholder[type] ?? 'Entity name'} autoComplete="off"/></label>
      <SubtypePicker type={type} value={subtypes} subtypes={schema.subtypes} onChange={setSubtypes} disabled={busy}/>
      <AliasInput value={aliases} onChange={setAliases} disabled={busy}/>
      {type==='source'&&<SourceAttachments disabled={busy} vaultId={vaultId} onChange={setAttachments} onBusy={setUploading}/>}
      {schemaError && <p className="dialog-error" role="alert">{schemaError}</p>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
    </div>
    <footer className="dialog-actions create-entity-actions"><button type="button" className="button" onClick={onClose} disabled={busy||uploading}>Cancel</button><button className="button primary" disabled={busy||uploading||!name.trim()||(type==='source'&&!attachments.length)}>{busy?'Creating…':type==='source'?'Create source':'Create entity'}</button></footer>
  </form></Modal>;
}
