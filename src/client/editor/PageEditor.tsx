import { useEffect, useRef } from 'react';
import type { Entity, Page, Vault } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { Mention } from '../components/Mention';
import type { CreateEntityRequest } from '../knowledge/CreateEntityDialog';
import { BlockEditor } from './BlockEditor';
interface Props {page: Page; vault: Vault; entities: Entity[]; onChange: (patch: Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds'>>) => void; onDelete: () => void; onOpenEntity: (id: string) => void; onCreateEntity: (request: CreateEntityRequest) => void; onSave: () => void}
export function PageEditor({page, vault, entities, onChange, onDelete, onOpenEntity, onCreateEntity, onSave}: Props) {
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => { if (page.title === 'Untitled') { title.current?.focus(); title.current?.select(); } }, [page.id]);
  return <article className="page"><div className="page-eyebrow"><span className="page-symbol"><Icon name="page"/></span>{vault.name.toUpperCase()}</div>
    <input ref={title} id="page-title" aria-label="Page title" placeholder="Untitled" maxLength={500} value={page.title} onChange={e => onChange({title: e.target.value})}/>
    <div className="page-meta"><span><Icon name="page"/> Page</span><span><Icon name="knowledge"/> Connected knowledge</span><button onClick={onDelete}>Delete page</button></div>
    <section className="page-sources"><div className="sources-heading"><Icon name="source"/><span>Sources</span><small>References for this page</small></div>
      <div className="source-list">{page.sourceIds.map(id => <div key={id} className="page-source"><Mention id={id} entities={entities} onOpen={onOpenEntity}/><button aria-label="Remove source from page" onClick={() => onChange({sourceIds: page.sourceIds.filter(s => s !== id)})}>×</button></div>)}</div>
      <div className="source-actions"><select aria-label="Attach existing source" value="" onChange={e => { if (e.target.value) onChange({sourceIds: [...page.sourceIds, e.target.value]}); }}><option value="">Add a source…</option>{entities.filter(e => e.type === 'source' && !page.sourceIds.includes(e.id)).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select><button onClick={() => onCreateEntity({source: true})}>+ New source</button></div>
    </section>
    <BlockEditor blocks={page.blocks} entities={entities} onChange={blocks => onChange({blocks})} onOpenEntity={onOpenEntity} onCreateEntity={(name, onCreated) => onCreateEntity({name, onCreated})} onSave={onSave}/>
    <footer className="editor-footer"><kbd>/</kbd> choose a block <span>·</span><kbd>@</kbd> mention an entity <span>·</span> Enter for a new block</footer>
  </article>;
}
