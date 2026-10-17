import { entityMentionName, type Entity } from '../../shared/domain';
import { Icon } from './Icon';
export function Mention({id, label, entities, onOpen}: {id: string; label?: string; entities: Entity[]; onOpen: (id: string) => void}) {
  const entity = entities.find(e => e.id === id);
  return <span className={'mention ' + (entity?.type || '')} contentEditable={false} data-entity={id} data-mention-text={label} title={label ? entity?.name : undefined} role="button" tabIndex={0} onClick={() => onOpen(id)} onKeyDown={e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpen(id); }
  }}><Icon name={entity?.type || 'knowledge'}/>{label ?? entityMentionName(entity) ?? 'Unknown entity'}</span>;
}
