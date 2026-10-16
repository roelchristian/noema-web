import { useState } from 'react';
import { entityLabels, entityTypes, type Entity } from '../../shared/domain';
import { Icon } from '../components/Icon';
export function KnowledgeLibrary({entities, onOpen}: {entities: Entity[]; onOpen: (id: string) => void}) {
  const [query, setQuery] = useState(''), [type, setType] = useState('');
  const filtered = entities.filter(e => (!type || e.type === type) && e.name.toLowerCase().includes(query.toLowerCase()));
  return <section className="library"><div className="page-eyebrow">YOUR KNOWLEDGE, CONNECTED</div><h1>Knowledge entities<span>{entities.length}</span></h1><p>People, places, works, and sources connected within this vault.</p>
    <div className="library-tools"><input placeholder="Search your knowledge…" aria-label="Search entities" value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="Filter entity type" value={type} onChange={e => setType(e.target.value)}><option value="">All types</option>{entityTypes.map(t => <option key={t} value={t}>{entityLabels[t]}</option>)}</select></div>
    <div id="entity-grid">{filtered.map(e => <button key={e.id} className="entity-card" onClick={() => onOpen(e.id)}><span className={'entity-icon ' + e.type}><Icon name={e.type}/></span><small>{entityLabels[e.type]}</small><h3>{e.name}</h3><p>{e.description || 'Add a description, properties, and connections.'}</p><span className="card-arrow">↗</span></button>)}{!filtered.length && <p className="empty">No entities found. Create one to get started.</p>}</div>
  </section>;
}
