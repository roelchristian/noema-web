import { Select } from '../components/Select';
import { useState } from 'react';
import { entityLabels, entityTypes, type Entity } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { useEntitySchema } from './useEntitySchema';
export function KnowledgeLibrary({vaultId, entities, onOpen, onCreate}: {vaultId: string; entities: Entity[]; onOpen: (id: string) => void; onCreate: () => void}) {
  const {schema, error} = useEntitySchema(vaultId);
  const [query, setQuery] = useState(''), [type, setType] = useState('');
  const filtered = entities.filter(e => (!type || e.type === type || e.subtypes.includes(type)) && e.name.toLowerCase().includes(query.toLowerCase()));
  return <section className="library"><div className="page-eyebrow">YOUR KNOWLEDGE, CONNECTED</div><h1>Knowledge entities<span>{entities.length}</span></h1><p>People, places, works, and sources connected within this vault.</p>
    <button className="button primary" onClick={onCreate}>+ New entity</button>
    {error && <p role="alert">{error}</p>}
    <div className="library-tools"><input placeholder="Search your knowledge…" aria-label="Search entities" value={query} onChange={e => setQuery(e.target.value)}/><Select aria-label="Filter entity type" value={type} onChange={e => setType(e.target.value)}><option value="">All types</option>{entityTypes.flatMap(t => [<option key={t} value={t}>{entityLabels[t]} (all)</option>, ...schema.subtypes.filter(s => s.type === t).map(s => <option key={s.id} value={s.id}>{entityLabels[t]} / {s.name}</option>)])}</Select></div>
    <div id="entity-grid">{filtered.map(e => <button key={e.id} className="entity-card" onClick={() => onOpen(e.id)}><span className={'entity-icon ' + e.type}><Icon name={e.type}/></span><small>{entityLabels[e.type]}{e.subtypes.length > 0 && ` / ${e.subtypes.map(id => schema.subtypes.find(s => s.id === id)?.name || 'Subtype').join(', ')}`}</small><h3>{e.name}</h3><p>{e.description || 'Add a description, properties, and connections.'}</p><span className="card-arrow">↗</span></button>)}{!filtered.length && <p className="empty">No entities found. Create one to get started.</p>}</div>
  </section>;
}
