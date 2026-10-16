import { PageIcon } from '../components/PageIcon';
import { useEffect, useState } from 'react';
import type { TrashedPage } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function TrashLibrary({notes, onRestore, onDelete, onRefresh, onError}: {
  notes: TrashedPage[]; onRestore: (id: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>; onError: (error: unknown) => void;
}) {
  const [target, setTarget] = useState<TrashedPage | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    // A note may reach its expiry while this view is open.
    const next = Math.min(...notes.map(note => Date.parse(note.expires_at)));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => { void onRefresh().catch(onError); },Math.max(1000,Math.min(next - Date.now() + 100,2_147_483_647)));
    return () => clearTimeout(timer);
  }, [notes, onRefresh, onError]);
  const filtered = notes.filter(note => note.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="organization-library trash-library">
    <div className="organization-heading"><div><h1>Trash</h1></div></div>
    {!!notes.length && <input className="organization-search" type="search" aria-label="Search Trash" placeholder="Search deleted notes…" value={query} onChange={event => setQuery(event.target.value)}/>}
    <div className="organization-items">{filtered.map(note => <article className="organization-item" key={note.id}>
      <div className="organization-item-row trash-row"><PageIcon icon={note.icon}/><div className="trash-note"><h2>{note.title || 'Untitled'}</h2><small>Moved to Trash <time dateTime={note.deleted_at}>{new Date(note.deleted_at).toLocaleDateString()}</time> · Deletes <time dateTime={note.expires_at} title={new Date(note.expires_at).toLocaleString()}>{new Date(note.expires_at).toLocaleDateString()}</time></small></div>
        <div className="trash-actions"><button className="button small" onClick={() => { void onRestore(note.id).catch(onError); }} aria-label={'Restore ' + (note.title || 'Untitled')}>Restore</button><button className="button small" onClick={() => setTarget(note)} aria-label={'Delete permanently: ' + (note.title || 'Untitled')}>Delete permanently</button></div>
      </div>
    </article>)}{!filtered.length && <div className="organization-empty"><Icon name="trash"/><h2>{query ? 'No matching notes' : 'Trash is empty'}</h2><p>{query ? 'Try another search.' : 'Notes you move to Trash will appear here for 30 days.'}</p></div>}</div>
    {target && <ConfirmDialog title="Delete permanently?" description={`“${target.title || 'Untitled'}” will be permanently deleted. This cannot be undone.`} action="Delete permanently" onConfirm={() => onDelete(target.id)} onClose={() => setTarget(null)}/>}
  </section>;
}
