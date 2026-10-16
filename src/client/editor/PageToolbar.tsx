import { blockSegments } from '../../shared/domain';
import { Select } from '../components/Select';
import { useEffect, useRef, useState } from 'react';
import type { Entity, Page, Organization } from '../../shared/domain';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Mention } from '../components/Mention';
import type { CreateEntityRequest } from '../knowledge/CreateEntityDialog';

export function PageToolbar({page, entities, onSourcesChange, onOpenEntity, onCreateEntity, onError, onDelete, favourite, onOrganizationChange, onAI, aiOpen}: {
  onAI: () => void; aiOpen: boolean;
  favourite: boolean; onOrganizationChange: (data: Organization) => void; page: Page; entities: Entity[]; onDelete: () => void; onSourcesChange: (sourceIds: string[]) => void;
  onOpenEntity: (id: string) => void; onCreateEntity: (request: CreateEntityRequest) => void; onError: (error: unknown) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<'knowledge' | 'sources' | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menu]);
  const connectedIds = new Set(page.blocks.flatMap(block => blockSegments(block).flatMap(segment => segment.entityId ? [segment.entityId] : [])));
  const connected = entities.filter(entity => connectedIds.has(entity.id));
  async function toggleFavourite() {
    if (saving) return;
    setSaving(true);
    try {
      const data = await api.organize(page.vault_id, 'favourites', {kind: 'page', item_id: page.id, favourite: !favourite});
      onOrganizationChange(data);
    } catch (error) { onError(error); }
    finally { setSaving(false); }
  }
  const openEntity = (id: string) => { setMenu(null); onOpenEntity(id); };
  return <div className="page-toolbar" ref={root} role="group" aria-label="Page tools">
    <button className={'page-tool favourite-button ' + (favourite ? 'is-favourite' : '')} disabled={saving} aria-pressed={!!favourite} aria-label={favourite ? 'Remove page from favourites' : 'Add page to favourites'} title={favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void toggleFavourite()}><Icon name="star"/></button>
    <button className="page-tool" aria-expanded={menu === 'knowledge'} aria-controls="page-knowledge-popover" aria-label="Connected knowledge" title="Connected knowledge" onClick={event => { trigger.current = event.currentTarget; setMenu(menu === 'knowledge' ? null : 'knowledge'); }}><Icon name="knowledge"/><span className="page-tool-label">Connected knowledge</span><span className="page-tool-count">{connected.length}</span></button>
    <button className="page-tool" aria-expanded={menu === 'sources'} aria-controls="page-sources-popover" aria-label="Page sources" title="Page sources" onClick={event => { trigger.current = event.currentTarget; setMenu(menu === 'sources' ? null : 'sources'); }}><Icon name="source"/><span className="page-tool-label">Sources</span><span className="page-tool-count">{page.sourceIds.length}</span></button>
    <button className="page-tool" aria-expanded={aiOpen} aria-controls="intelligence-panel" onClick={() => {setMenu(null);onAI();}}>✧ <span>AI</span></button>
    <button className="page-tool" aria-label="Move note to Trash" title="Move to Trash" onClick={() => { setMenu(null); onDelete(); }}><Icon name="trash"/><span className="page-tool-label">Trash</span></button>
    {menu === 'knowledge' && <section id="page-knowledge-popover" className="page-tools-popover" aria-label="Connected knowledge"><h2>Connected knowledge</h2><p>Entities mentioned in this page.</p><div className="toolbar-entity-list">{connected.map(entity => <Mention key={entity.id} id={entity.id} entities={entities} onOpen={openEntity}/>)}</div>{!connected.length && <p className="empty-small">Type @ in a block to connect an entity.</p>}</section>}
    {menu === 'sources' && <section id="page-sources-popover" className="page-tools-popover" aria-label="Page sources"><h2>Page sources</h2><p>References for this page.</p><div className="toolbar-source-list">{page.sourceIds.map(id => <div key={id} className="page-source"><Mention id={id} entities={entities} onOpen={openEntity}/><button aria-label={'Remove source from page: ' + (entities.find(entity => entity.id === id)?.name || id)} onClick={() => onSourcesChange(page.sourceIds.filter(source => source !== id))}>×</button></div>)}</div>{!page.sourceIds.length && <p className="empty-small">No sources attached yet.</p>}<div className="toolbar-source-actions"><Select aria-label="Attach existing source" value="" onChange={event => { if (event.target.value) onSourcesChange([...new Set([...page.sourceIds, event.target.value])]); }}><option value="">Add a source…</option>{entities.filter(entity => entity.type === 'source' && !page.sourceIds.includes(entity.id)).map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</Select><button className="button small" onClick={() => { setMenu(null); onCreateEntity({source: true}); }}>+ New source</button></div></section>}
  </div>;
}
