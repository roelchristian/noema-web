import { useEffect, useRef } from 'react';
import type { Entity, Page } from '../../shared/domain';
import type { CreateEntityRequest } from '../knowledge/CreateEntityDialog';
import { PageIconPicker } from '../components/PageIconPicker';
import { BlockEditor } from './BlockEditor';
interface Props {page: Page; entities: Entity[]; onChange: (patch: Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds' | 'icon'>>) => void; onOpenEntity: (id: string) => void; onCreateEntity: (request: CreateEntityRequest) => void; onSave: () => void}
export function PageEditor({page, entities, onChange, onOpenEntity, onCreateEntity, onSave}: Props) {
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => { if (page.title === 'Untitled') { title.current?.focus(); title.current?.select(); } }, [page.id]);
  return <article className="page">
    <PageIconPicker value={page.icon} onChange={icon => onChange({icon})}/>
    <input ref={title} id="page-title" aria-label="Page title" placeholder="Untitled" maxLength={500} value={page.title} onChange={e => onChange({title: e.target.value})}/>
    <BlockEditor blocks={page.blocks} entities={entities} onChange={blocks => onChange({blocks})} onOpenEntity={onOpenEntity} onCreateEntity={(name, onCreated) => onCreateEntity({name, onCreated})} onSave={onSave}/>
  </article>;
}
