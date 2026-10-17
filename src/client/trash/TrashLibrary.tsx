import {PageCover} from '../components/PageCover';
import {ViewModeSwitch, useViewMode} from '../components/ViewModeSwitch';
import {ActionMenu} from '../components/ActionMenu';
import { PageIcon } from '../components/PageIcon';
import { useEffect, useState } from 'react';
import type { TrashedPage } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function TrashLibrary({vaultId,notes, onRestore, onDelete, onRefresh, onError}: {
  vaultId:string; notes: TrashedPage[]; onRestore: (id: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>; onError: (error: unknown) => void;
}) {
  const [viewMode, setViewMode, libraryRef] = useViewMode('trash');
  const [target, setTarget] = useState<TrashedPage | null>(null);
  useEffect(() => {
    // A note may reach its expiry while this view is open.
    const next = Math.min(...notes.map(note => Date.parse(note.expires_at)));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => { void onRefresh().catch(onError); },Math.max(1000,Math.min(next - Date.now() + 100,2_147_483_647)));
    return () => clearTimeout(timer);
  }, [notes, onRefresh, onError]);
  return <section ref={libraryRef} className="organization-library trash-library" data-layout={viewMode}>
    <div className="organization-heading"><div className="library-heading-row"><h1 className="page-heading">Trash</h1></div><div className="library-heading-actions"><ViewModeSwitch value={viewMode} onChange={setViewMode}/></div></div>
    <div className="organization-items">{notes.map(note => <article className="organization-item" key={note.id}>
      <div className="organization-item-row trash-row">{viewMode==='grid' && <PageCover vaultId={vaultId} imageId={note.featuredImageId}/>}<span className="organization-item-icon"><PageIcon icon={note.icon}/></span><div className="trash-note"><h2 title={note.title || 'Untitled'}>{note.title || 'Untitled'}</h2><small>Moved to Trash <time dateTime={note.deleted_at}>{new Date(note.deleted_at).toLocaleDateString()}</time> · Deletes <time dateTime={note.expires_at} title={new Date(note.expires_at).toLocaleString()}>{new Date(note.expires_at).toLocaleDateString()}</time></small></div>
        <div className="trash-actions"><button className="button small" onClick={() => { void onRestore(note.id).catch(onError); }} aria-label={'Restore ' + (note.title || 'Untitled')}>Restore</button>{viewMode === 'list' ? <button className="button small" onClick={() => setTarget(note)} aria-label={'Delete permanently: ' + (note.title || 'Untitled')}>Delete permanently</button> : <ActionMenu label={'Actions for ' + (note.title || 'Untitled')} actions={[{label: 'Delete permanently', icon: 'trash', danger: true, onSelect: () => setTarget(note)}]}/>}</div>
      </div>
    </article>)}{!notes.length && <div className="organization-empty"><Icon name="trash"/><h2>Trash is empty</h2><p>Notes you move to Trash will appear here for 30 days.</p></div>}</div>
    {target && <ConfirmDialog title="Delete permanently?" description={`“${target.title || 'Untitled'}” will be permanently deleted. This cannot be undone.`} action="Delete permanently" onConfirm={() => onDelete(target.id)} onClose={() => setTarget(null)}/>}
  </section>;
}
