import {t as uiText} from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Entity } from '../../shared/domain';
import type { AmbiguousEntityMatch, EntityMatchResolution } from '../../shared/auto-entities';
import { Select } from '../components/Select';
import { Icon } from '../components/Icon';

export function EntityMatchReview({matches, entities, onResolve, disabled = false}: {disabled?: boolean; matches: AmbiguousEntityMatch[]; entities: Entity[]; onResolve: (resolution: EntityMatchResolution) => void}) {
  const [target, setTarget] = useState<{id: string; element: HTMLElement} | null>(null);
  const [position, setPosition] = useState({left: 0, top: 0});
  const popover = useRef<HTMLDivElement>(null);
  const active = matches.find(match => match.id === target?.id);
  useEffect(() => {
    function open(event: Event) {
      const detail = (event as CustomEvent<{id: string; element: HTMLElement}>).detail;
      if (matches.some(match => match.id === detail.id)) setTarget(detail);
    }
    function outside(event: PointerEvent) {
      if (!popover.current?.contains(event.target as Node) && !(event.target as Element).closest('[data-entity-review], .entity-match-review')) setTarget(null);
    }
    function key(event: KeyboardEvent) { if (event.key === 'Escape') setTarget(null); }
    function closeOnScroll(event: Event) { if (!popover.current?.contains(event.target as Node)) setTarget(null); }
    document.addEventListener('noema:entity-review', open);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', closeOnScroll);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('noema:entity-review', open);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', closeOnScroll);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [matches]);
  useLayoutEffect(() => {
    if (!active || !target?.element.isConnected || !popover.current) return;
    const anchor = target.element.getBoundingClientRect(), box = popover.current.getBoundingClientRect();
    setPosition({left: Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8)), top: Math.max(8, anchor.bottom + box.height + 16 <= innerHeight ? anchor.bottom + 8 : anchor.top - box.height - 8)});
  }, [target, active]);
  if (!matches.length) return null;
  return <>
    <div className="entity-match-review"><button type="button" className="entity-review-notice" onClick={() => {
      const element = Array.from(document.querySelectorAll<HTMLElement>('[data-entity-review]')).find(element => element.dataset.entityReview === matches[0]!.id);
      if (element) { element.scrollIntoView({block: 'nearest'}); setTarget({id: matches[0]!.id, element}); }
    }}><Icon name="question-circle"/><span>{matches.length}{" " + uiText("entity") + " "}{matches.length === 1 ? uiText("match needs") : uiText("matches need")}{" " + uiText("review")}</span><span className="entity-review-label">{uiText("Review")}</span></button></div>
    {active && target?.element.isConnected && <div ref={popover} className="entity-match-popover" style={position} role="dialog" aria-label={uiText("Review entity match {value0}",{value0: active.text})}>
      <div className="entity-review-popover-heading"><span><Icon name="question-circle"/>{uiText("Which entity is this?")}</span><button type="button" aria-label={uiText("Close entity review")} onClick={() => setTarget(null)}><Icon name="close"/></button></div>
      <MatchRow disabled={disabled} key={active.id + active.text} match={active} entities={entities} onResolve={resolution => {onResolve(resolution); setTarget(null);}}/>
    </div>}
  </>;
}
function MatchRow({match, entities, onResolve, disabled}: {disabled?: boolean; match: AmbiguousEntityMatch; entities: Entity[]; onResolve: (resolution: EntityMatchResolution) => void}) {
  const [selected, setSelected] = useState('');
  const candidates = entities.filter(entity => match.entityIds.includes(entity.id));
  const valid = candidates.some(entity => entity.id === selected);
  return <div className="entity-match-row" data-match-id={match.id}>
    <strong>“{match.text}”</strong><p>{match.context}</p>
    <Select aria-label={uiText("Entity for {value0}",{value0: match.text})} disabled={disabled} value={valid ? selected : ''} onChange={event => setSelected(event.target.value)}>
      <option value="">{uiText("Choose an entity…")}</option>
      {candidates.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
    </Select>
    <div className="entity-match-actions">
      <button type="button" className="button small" disabled={disabled || !valid} onClick={() => onResolve({match, entityId: selected})}>{uiText("Link this instance")}</button>
      <button type="button" className="button small" disabled={disabled || !valid} onClick={() => onResolve({match, entityId: selected, all: true})}>{uiText("Link all “")}{match.text}{uiText("” instances")}</button>
    </div>
  </div>;
}
