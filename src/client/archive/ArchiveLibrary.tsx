import './archive.css';
import {useState} from 'react';
import type {ArchivedPage,Organization} from '../../shared/domain';
import {DOMAINS} from '../../shared/domains';
import {LibraryToolbar} from '../components/LibraryToolbar';
import {useLibraryViewState} from '../state/library-view-state';
import {useViewMode} from '../components/ViewModeSwitch';
import {TitleText} from '../components/TitleText';
import {PageIcon} from '../components/PageIcon';
import {PageCover} from '../components/PageCover';
import {Select} from '../components/Select';

export function ArchiveLibrary({vaultId,notes,organization,onRestore,onOpen,onRefresh,onError}:{vaultId:string;notes:ArchivedPage[];organization:Organization;onRestore:(notes:ArchivedPage[])=>Promise<void>;onOpen:(id:string)=>void;onRefresh:()=>Promise<void>;onError:(error:unknown)=>void}) {
  const [viewState,setViewState]=useLibraryViewState(vaultId,'archive');
  const [mode,setMode,ref]=useViewMode(JSON.stringify([vaultId,'archive']),'archive');
  const [selected,setSelected]=useState(new Set<string>()),[pending,setPending]=useState(false);
  const [query,setQuery]=useState(''),[folder,setFolder]=useState(''),[collection,setCollection]=useState(''),[subject,setSubject]=useState(''),[after,setAfter]=useState(''),[before,setBefore]=useState('');
  const visible=notes.filter(note=>(!query||note.title.toLowerCase().includes(query.toLowerCase()))&&(!folder||(folder==='unfiled'?!note.folderId:note.folderId===folder))&&(!collection||note.collectionIds.includes(collection))&&(!subject||note.subjectIds.includes(subject))&&(!after||note.archived_at.slice(0,10)>=after)&&(!before||note.archived_at.slice(0,10)<=before)).sort((a,b)=>viewState.sort.startsWith('title-')?a.title.localeCompare(b.title)*(viewState.sort==='title-desc'?-1:1):(Date.parse(a.updated_at)-Date.parse(b.updated_at))*(viewState.sort==='modified-asc'?1:-1));
  const checked=visible.filter(note=>selected.has(note.id));
  async function run(work:()=>Promise<void>) {if(pending)return;setPending(true);try{await work();setSelected(new Set());}catch(error){onError(error);}finally{setPending(false);}}
  return <section ref={ref} className="organization-library trash-library" data-layout={mode} data-library-vault={vaultId} data-library-destination="archive" aria-busy={pending}>
    <div className="organization-heading"><div className="library-heading-row"><h1 className="page-heading">Archive</h1></div><div className="library-heading-actions"><button className="button" disabled={pending} onClick={()=>void run(onRefresh)}>Refresh</button></div></div>
    <LibraryToolbar sort={viewState.sort} onSort={sort=>setViewState({sort})} mode={mode} onMode={setMode} filter={<input type="search" aria-label="Filter archived pages" placeholder="Filter archived pages…" value={query} onChange={event=>{setQuery(event.target.value);setSelected(new Set());}}/>}/>
    <div className="archive-filters" role="group" aria-label="Archive filters">
      <Select aria-label="Original folder" value={folder} onChange={e=>setFolder(e.target.value)}><option value="">All folders</option><option value="unfiled">Unfiled</option>{organization.folders.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <Select aria-label="Collection" value={collection} onChange={e=>setCollection(e.target.value)}><option value="">All collections</option>{organization.collections.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <Select aria-label="Subject" value={subject} onChange={e=>setSubject(e.target.value)}><option value="">All subjects</option>{DOMAINS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</Select>
      <label>Archived from <input type="date" value={after} onChange={e=>setAfter(e.target.value)}/></label><label>through <input type="date" value={before} onChange={e=>setBefore(e.target.value)}/></label>
    </div>
    {!!visible.length&&<div className="trash-selection-bar"><label><input type="checkbox" aria-label="Select all archived pages" checked={checked.length===visible.length} disabled={pending} onChange={()=>setSelected(checked.length===visible.length?new Set():new Set(visible.map(note=>note.id)))}/> Select all visible</label>{!!checked.length&&<button className="button" disabled={pending} onClick={()=>void run(()=>onRestore(checked))}>Restore selected ({checked.length})</button>}</div>}
    <div className="organization-items">{visible.map(note=><article key={note.id} className="organization-item" data-library-row={'page:'+note.id}><div className="organization-item-row trash-row">
      {mode==='grid'&&<PageCover vaultId={vaultId} imageId={note.featuredImageId}/>}
      <label className="organization-item-icon page-selection"><span className="page-selection-icon"><PageIcon icon={note.icon}/></span><input type="checkbox" aria-label={'Select '+note.title} checked={selected.has(note.id)} disabled={pending} onChange={()=>setSelected(prior=>{const next=new Set(prior);if(next.has(note.id))next.delete(note.id);else next.add(note.id);return next;})}/></label>
      <div className="trash-note"><h2><button data-library-focus onClick={()=>onOpen(note.id)}><TitleText text={note.title||'Untitled'}/></button></h2><small>Archived <time dateTime={note.archived_at}>{new Date(note.archived_at).toLocaleDateString()}</time> · {note.folderName||'Unfiled'}</small></div><div className="trash-actions"><button className="button small" disabled={pending} onClick={()=>void run(()=>onRestore([note]))}>Restore</button></div>
    </div></article>)}{!visible.length&&<p className="organization-empty">{notes.length?'No archived pages match these filters.':'No archived pages.'}</p>}</div>
  </section>;
}
