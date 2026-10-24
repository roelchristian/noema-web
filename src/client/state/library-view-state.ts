import {useCallback, useSyncExternalStore} from 'react';

export interface LibraryViewState {
  groupFolders?: boolean;
  columns?: string;
  density?: string;
  scope?: string;
  searchMode?: string;
  query: string;
  sort: string;
  selectedIds: string[];
  expanded: Record<string, boolean>;
  focusedRow: string | null;
  scroll: {left: number; top: number};
  anchor: {row: string; top: number} | null;
  grouping?: string;
  entityType?: string;
}
export type LibraryViewUpdate = Partial<LibraryViewState> | ((previous: LibraryViewState) => LibraryViewState | Partial<LibraryViewState>);
const states = new Map<string, LibraryViewState>();
const listeners = new Map<string, Set<() => void>>();
const keyOf = (vaultId: string, destination: string) => JSON.stringify([vaultId,destination]);
const initial = (): LibraryViewState => ({query: '', sort: 'modified-desc', selectedIds: [], expanded: {}, focusedRow: null, scroll: {left: 0, top: 0}, anchor: null});
/** Navigation memory contains view preferences and row IDs, never page bodies. */
export function getLibraryViewState(vaultId: string, destination: string): LibraryViewState {
  const key = keyOf(vaultId,destination);
  let state = states.get(key);
  if (!state) {state = initial(); states.set(key,state);}
  return state;
}
export function setLibraryViewState(vaultId: string, destination: string, update: LibraryViewUpdate, notify = true): void {
  const key = keyOf(vaultId,destination), previous = getLibraryViewState(vaultId,destination);
  const patch = typeof update === 'function' ? update(previous) : update;
  if (patch === previous) return;
  const same = Object.entries(patch).every(([name,value]) => {
    const before = previous[name as keyof LibraryViewState];
    return before === value || typeof value === 'object' && value !== null && JSON.stringify(before) === JSON.stringify(value);
  });
  if (same) return;
  const next = {...previous,...patch};
  states.delete(key); states.set(key,next);
  if (notify) for (const listener of listeners.get(key) ?? []) listener();
}
export function subscribeLibraryViewState(vaultId: string, destination: string, listener: () => void): () => void {
  const key = keyOf(vaultId,destination), group = listeners.get(key) ?? new Set<() => void>();
  group.add(listener); listeners.set(key,group);
  return () => {group.delete(listener); if (!group.size) listeners.delete(key);};
}
export function clearLibraryViewStates(vaultId: string): void {
  const removed: string[] = [];
  for (const key of states.keys()) if ((JSON.parse(key) as [string,string])[0] === vaultId) {states.delete(key); removed.push(key);}
  for (const key of removed) for (const listener of listeners.get(key) ?? []) listener();
}
export function useLibraryViewState(vaultId: string, destination: string): [LibraryViewState, (update: LibraryViewUpdate) => void] {
  const subscribe = useCallback((listener: () => void) => subscribeLibraryViewState(vaultId,destination,listener), [vaultId,destination]);
  const snapshot = useCallback(() => getLibraryViewState(vaultId,destination), [vaultId,destination]);
  const update = useCallback((value: LibraryViewUpdate) => setLibraryViewState(vaultId,destination,value), [vaultId,destination]);
  return [useSyncExternalStore(subscribe,snapshot,snapshot),update];
}
