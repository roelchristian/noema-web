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
type Presentation = Pick<LibraryViewState,'sort'|'groupFolders'|'grouping'|'columns'|'density'> & {layout?:'list'};
function presentationFamily(destination:string):string {
  try {const parsed=JSON.parse(destination);if(Array.isArray(parsed)&&parsed[0]==='organization')return 'organization';}catch{/* Named destination. */}
  return destination;
}
const presentationKey=(vaultId:string,destination:string)=>'noema-library-presentation/'+JSON.stringify([vaultId,destination]);
function validPresentation(value:unknown):Partial<Presentation> {
  if(!value||typeof value!=='object')return {};
  const input=value as Record<string,unknown>,result:Partial<Presentation>={};
  if(['modified-desc','modified-asc','title-asc','title-desc','type-asc','type-desc'].includes(String(input.sort)))result.sort=String(input.sort);
  if(input.grouping==='all'||input.grouping==='folders')result.grouping=input.grouping;
  if(typeof input.groupFolders==='boolean')result.groupFolders=input.groupFolders;
  if(['basic','location','collections'].includes(String(input.columns)))result.columns=String(input.columns);
  if(input.density==='compact'||input.density==='standard'||input.density==='comfortable')result.density=input.density;
  if(input.layout==='list'||input.layout==='compact'||input.layout==='grid') {
    result.layout='list';
    if(input.layout==='compact')result.density='compact';
    else if(input.layout==='grid')result.density='standard';
    else result.density??='standard';
  }
  return result;
}
export function readLibraryPresentation(vaultId:string,destination:string,inherit=true):Partial<Presentation> {
  try {
    const read=(key:string)=>validPresentation(JSON.parse(window.localStorage.getItem(presentationKey(vaultId,key))??'null'));
    return {...(inherit?read(presentationFamily(destination)):{}),...read(destination)};
  }catch{return {};}
}
export function saveLibraryPresentation(vaultId:string,destination:string,patch:Partial<Presentation>):void {
  try {
    const clean=validPresentation(patch);
    for(const key of new Set([presentationFamily(destination),destination]))window.localStorage.setItem(presentationKey(vaultId,key),JSON.stringify({...readLibraryPresentation(vaultId,key),...clean}));
  }catch{/* Preferences remain usable when browser storage is unavailable. */}
}
const sessionPrefix='noema-library-session/';
const sessionKey=(vaultId:string,destination:string)=>sessionPrefix+JSON.stringify([vaultId,destination]);
/** Same-tab navigation survives reloads; private filters never enter localStorage. */
export function readLibrarySession(vaultId:string,destination:string):Partial<LibraryViewState> {
  try {
    const value=JSON.parse(window.sessionStorage.getItem(sessionKey(vaultId,destination))??'null');
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    const result:Partial<LibraryViewState>={};
    if(typeof value.entityType==='string')result.entityType=value.entityType;
    if(typeof value.query==='string')result.query=value.query;
    if(typeof value.searchMode==='string')result.searchMode=value.searchMode;
    if(typeof value.focusedRow==='string')result.focusedRow=value.focusedRow;
    if(value.scroll&&Number.isFinite(value.scroll.top)&&Number.isFinite(value.scroll.left))result.scroll={top:Math.max(0,value.scroll.top),left:Math.max(0,value.scroll.left)};
    if(value.anchor&&typeof value.anchor.row==='string'&&Number.isFinite(value.anchor.top))result.anchor={row:value.anchor.row,top:value.anchor.top};
    return result;
  }catch{return {};}
}
const states = new Map<string, LibraryViewState>();
const listeners = new Map<string, Set<() => void>>();
const keyOf = (vaultId: string, destination: string) => JSON.stringify([vaultId,destination]);
const initial = (): LibraryViewState => ({query: '', sort: 'modified-desc', selectedIds: [], expanded: {}, focusedRow: null, scroll: {left: 0, top: 0}, anchor: null});
/** Navigation memory contains view preferences and row IDs, never page bodies. */
export function getLibraryViewState(vaultId: string, destination: string): LibraryViewState {
  const key = keyOf(vaultId,destination);
  let state = states.get(key);
  if (!state) {state = {...initial(),...readLibraryPresentation(vaultId,destination),...readLibrarySession(vaultId,destination)}; states.set(key,state);}
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
  const presentation=Object.fromEntries(Object.entries(patch).filter(([key])=>['sort','groupFolders','grouping','columns','density'].includes(key)));
  if(Object.keys(presentation).length)saveLibraryPresentation(vaultId,destination,presentation);
  try {window.sessionStorage.setItem(sessionKey(vaultId,destination),JSON.stringify({entityType:next.entityType,query:next.query,searchMode:next.searchMode,focusedRow:next.focusedRow,scroll:next.scroll,anchor:next.anchor}));}catch{/* Keep navigation usable when session storage is unavailable. */}
  states.delete(key); states.set(key,next);
  if (notify) for (const listener of listeners.get(key) ?? []) listener();
}
export function subscribeLibraryViewState(vaultId: string, destination: string, listener: () => void): () => void {
  const key = keyOf(vaultId,destination), group = listeners.get(key) ?? new Set<() => void>();
  group.add(listener); listeners.set(key,group);
  return () => {group.delete(listener); if (!group.size) listeners.delete(key);};
}
export function clearLibraryViewStates(vaultId: string): void {
  try {
    for(let index=window.sessionStorage.length-1;index>=0;index--){
      const key=window.sessionStorage.key(index);
      if(key?.startsWith(sessionPrefix)&&(JSON.parse(key.slice(sessionPrefix.length)) as [string,string])[0]===vaultId)window.sessionStorage.removeItem(key);
    }
  }catch{/* Session storage may be unavailable. */}
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
