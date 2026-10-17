import { useState } from 'react';
import type { Entity } from '../../shared/domain';
import type { AmbiguousEntityMatch, EntityMatchResolution } from '../../shared/auto-entities';
import { Select } from '../components/Select';

export function EntityMatchReview({matches, entities, onResolve}: {matches: AmbiguousEntityMatch[]; entities: Entity[]; onResolve: (resolution: EntityMatchResolution) => void}) {
  if (!matches.length) return null;
  return <details className="entity-match-review">
    <summary>{matches.length} entity {matches.length === 1 ? 'match needs' : 'matches need'} review</summary>
    <p>These names match multiple entities. Choose the right entity for this instance or all matching instances on this page.</p>
    {matches.map(match => <MatchRow key={match.id + match.text} match={match} entities={entities} onResolve={onResolve}/>)}
  </details>;
}
function MatchRow({match, entities, onResolve}: {match: AmbiguousEntityMatch; entities: Entity[]; onResolve: (resolution: EntityMatchResolution) => void}) {
  const [selected, setSelected] = useState('');
  const candidates = entities.filter(entity => match.entityIds.includes(entity.id));
  const valid = candidates.some(entity => entity.id === selected);
  return <div className="entity-match-row">
    <strong>“{match.text}”</strong><p>{match.context}</p>
    <Select aria-label={`Entity for ${match.text}`} value={valid ? selected : ''} onChange={event => setSelected(event.target.value)}>
      <option value="">Choose an entity…</option>
      {candidates.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
    </Select>
    <div className="entity-match-actions">
      <button type="button" className="button small" disabled={!valid} onClick={() => onResolve({match, entityId: selected})}>Link this instance</button>
      <button type="button" className="button small" disabled={!valid} onClick={() => onResolve({match, entityId: selected, all: true})}>Link all “{match.text}” instances</button>
    </div>
  </div>;
}
