import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {TitleText} from '../components/TitleText';
import {useLibraryRangeSelection} from '../state/use-library-range-selection';
import {LibraryToolbar} from '../components/LibraryToolbar';
import {useLibraryViewState} from '../state/library-view-state';
import {useLibraryDensity} from '../components/LibraryDensitySwitch';
import {ActionMenu} from '../components/ActionMenu';
import { PageIcon } from '../components/PageIcon';
import { useEffect, useState } from 'react';
import type { TrashedPage } from '../../shared/domain';
import { Icon } from '../components/Icon';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function TrashLibrary({vaultId,notes, onRestore, onDelete, onRestoreSelected, onDeleteSelected, onRefresh, onError}: {
  vaultId:string; notes: TrashedPage[]; onRestore: (id: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onRestoreSelected: (ids: string[]) => Promise<void>; onDeleteSelected: (ids: string[]) => Promise<void>;
  onRefresh: () => Promise<void>; onError: (error: unknown) => void;
}) {
  const [density, setDensity, libraryRef] = useLibraryDensity(JSON.stringify([vaultId,'trash']), 'trash');
  const [target, setTarget] = useState<TrashedPage[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [viewState,setViewState]=useLibraryViewState(vaultId,'trash');
  const visible=notes.filter(note=>note.title.toLowerCase().includes(viewState.query.toLowerCase())).sort((a,b)=>viewState.sort.startsWith('title-')?a.title.localeCompare(b.title)*(viewState.sort==='title-desc'?-1:1):(Date.parse(a.deleted_at)-Date.parse(b.deleted_at))*(viewState.sort==='modified-asc'?1:-1));
  const checked = visible.filter(note => selected.has(note.id));
  const allChecked = notes.length > 0 && checked.length === visible.length;
  useEffect(() => {
    setSelected(previous => {
      const next = new Set(notes.filter(note => previous.has(note.id)).map(note => note.id));
      return next.size === previous.size ? previous : next;
    });
  }, [notes]);
  async function run(work: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    try { await work(); } finally { setPending(false); }
  }
  const toggle=useLibraryRangeSelection(visible.map(note=>note.id),selected,setSelected,vaultId);
  useEffect(() => {
    // A note may reach its expiry while this view is open.
    const next = Math.min(...notes.map(note => Date.parse(note.expires_at)));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => { void onRefresh().catch(onError); },Math.max(1000,Math.min(next - Date.now() + 100,2_147_483_647)));
    return () => clearTimeout(timer);
  }, [notes, onRefresh, onError]);
  return <section ref={libraryRef} className={"organization-library trash-library" + (checked.length ? " has-selection" : "") + (!notes.length ? " is-empty" : "")} aria-busy={pending} data-layout="list" data-density={density} data-library-vault={vaultId} data-library-destination="trash">
    <div className="organization-heading"><div className="library-heading-row"><h1 className="page-heading">{uiText("Trash")}</h1></div>{!!notes.length && <div className="library-heading-actions"></div>}</div>
    {!!notes.length && <LibraryToolbar dateLabel="Moved to Trash" disabled={pending} sort={viewState.sort} onSort={sort=>setViewState({sort})} density={density} onDensity={setDensity} filter={<input type="search" disabled={pending} aria-label="Filter Trash" placeholder="Filter Trash…" value={viewState.query} onChange={event=>{setViewState({query:event.target.value});setSelected(new Set());}}/>}/>}
    {!!notes.length && <div className="trash-selection-bar">
      <label className="trash-select-all"><input type="checkbox" aria-label={uiText("Select all notes in Trash")} checked={allChecked} ref={input => { if (input) input.indeterminate = checked.length > 0 && !allChecked; }} disabled={pending} onChange={() => setSelected(allChecked ? new Set() : new Set(visible.map(note => note.id)))}/>{uiText("Select all")}</label>
      <span role="status">{checked.length} {uiText("selected")}</span>
    </div>}
    {!!checked.length && <div className="organization-bulk-actions" role="toolbar" aria-label={uiText("Selected Trash actions")}>
      <button disabled={pending} onClick={() => { void run(() => onRestoreSelected(checked.map(note => note.id))).catch(onError); }}><Icon name="undo"/>{uiText("Restore selected")}</button>
      <button className="is-danger" disabled={pending} onClick={() => setTarget(checked)}><Icon name="trash"/>{uiText("Delete selected permanently")}</button>
      <button disabled={pending} onClick={() => setSelected(new Set())}><Icon name="close"/>{uiText("Clear")}</button>
      {pending && <span role="status">{uiText("Working…")}</span>}
    </div>}
    <div className="organization-items">{visible.map(note => <article className="organization-item" key={note.id} data-library-row={'page:'+note.id}>
      <div className="organization-item-row trash-row"><label className="organization-item-icon page-selection"><span className="page-selection-icon"><PageIcon icon={note.icon}/></span><input type="checkbox" aria-label={uiText("Select ") + (note.title || uiText("Untitled"))} checked={selected.has(note.id)} disabled={pending} onChange={event=>toggle(note.id,(event.nativeEvent as MouseEvent).shiftKey)}/><span className="page-selection-check"><Icon name="check"/></span></label><div className="trash-note"><h2 title={note.title || uiText("Untitled")}><TitleText text={note.title || 'Untitled'}/></h2><small>{uiText("Moved to Trash") + " "}<time dateTime={note.deleted_at}>{new Date(note.deleted_at).toLocaleDateString(getLocale())}</time>{" " + uiText("· Deletes") + " "}<time dateTime={note.expires_at} title={new Date(note.expires_at).toLocaleString(getLocale())}>{new Date(note.expires_at).toLocaleDateString(getLocale())}</time></small></div>
        <div className="trash-actions"><button data-library-focus className="button small" disabled={pending} onClick={() => { void run(() => onRestore(note.id)).catch(onError); }} aria-label={uiText("Restore ") + (note.title || uiText("Untitled"))}><Icon name="undo"/>{uiText("Restore")}</button>{density === 'standard' ? <button className="button small is-danger" disabled={pending} onClick={() => setTarget([note])} aria-label={uiText("Delete permanently: ") + (note.title || uiText("Untitled"))}><Icon name="trash"/>{uiText("Delete permanently")}</button> : <ActionMenu lazy disabled={pending} label={'Actions for ' + (note.title || 'Untitled')} actions={[{get label(){return uiText("Delete permanently")}, icon: 'trash', danger: true, onSelect: () => setTarget([note])}]}/>}</div>
      </div>
    </article>)}{!notes.length && <div className="organization-empty trash-empty"><Icon name="trash"/><h2>{uiText("Trash is empty")}</h2><p>{uiText("Notes you move to Trash will appear here for 30 days.")}</p></div>}</div>
    {target && <ConfirmDialog danger title={uiText("Delete permanently?")} description={target.length === 1 ? `“${target[0].title || 'Untitled'}” will be permanently deleted. This cannot be undone.` : uiText("{count} selected notes will be permanently deleted. This cannot be undone.", {count: target.length})} action={uiText("Delete permanently")} onConfirm={() => run(() => target.length===1 ? (visible.some(note=>note.id===target[0].id)?onDelete(target[0].id):Promise.resolve()) : onDeleteSelected(target.filter(note => visible.some(current => current.id === note.id)).map(note => note.id)))} onClose={() => setTarget(null)}/>}
  </section>;
}
