import type {ReactNode} from 'react';
import {Select} from './Select';
import {ViewModeSwitch, type ViewMode} from './ViewModeSwitch';

/** Common order across destinations; lifecycle actions remain owned by the caller. */
export function LibraryToolbar({filter, sort, onSort, mode, onMode, group, onGroup, children, disabled=false}: {
  filter?:ReactNode; sort:string; onSort:(sort:string)=>void; mode:ViewMode; onMode:(mode:ViewMode)=>void;
  group?:boolean; onGroup?:(group:boolean)=>void; children?:ReactNode; disabled?:boolean;
}) {
  return <div className="library-toolbar" role="group" aria-label="Library controls">
    {filter}
    <Select disabled={disabled} aria-label="Sort library" value={sort} onChange={event=>onSort(event.target.value)}>
      <option value="modified-desc">Modified · newest first</option><option value="modified-asc">Modified · oldest first</option>
      <option value="title-asc">Name · A–Z</option><option value="title-desc">Name · Z–A</option>
    </Select>
    {onGroup&&<label className="library-group"><input type="checkbox" disabled={disabled} checked={group} onChange={event=>onGroup(event.target.checked)}/>Group folders first</label>}
    <ViewModeSwitch disabled={disabled} value={mode} onChange={onMode}/>{children}
  </div>;
}
