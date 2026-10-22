import {t as uiText} from '../i18n';
import {TitleText} from '../components/TitleText';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Organization, OrganizationContext, PageSummary } from '../../shared/domain';
import { readSidebarExpansion, saveSidebarExpansion } from './sidebar-expansion';
import { pageURL } from '../state/navigation-address';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageIcon } from '../components/PageIcon';
import { ActionMenu } from '../components/ActionMenu';
import { NameDialog } from '../components/NameDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { folderBreadcrumbs } from './breadcrumbs';
import { folderDropHandlers } from './folder-drop';
import {PageOrganizationDialog} from './PageOrganizationDialog';
import {FolderCollectionDialog} from './FolderCollectionDialog';
import { isFolderDrag, readFolderDrop, startFolderDrag } from './folder-drag';
import { isPageDrag, readPageDrop, startPageDrag } from './page-drag';

/** Rename in place without navigating away from the current page. */
function SidebarNameInput({name,onSave,onDone,maxLength=500}: {maxLength?:number;name:string;onSave:(name:string)=>Promise<void>;onDone:()=>void}) {
  const [value,setValue]=useState(name),[pending,setPending]=useState(false),[error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null),finishing=useRef(false);
  useEffect(()=>{input.current?.focus();input.current?.select();},[]);
  async function save() {
    if(finishing.current)return;
    const next=value.trim();
    if(!next||next===name){finishing.current=true;onDone();return;}
    finishing.current=true;setPending(true);setError('');
    try {await onSave(next);onDone();}
    catch(error) {
      finishing.current=false;setPending(false);setError(error instanceof Error?error.message:'Could not rename. Try again.');
      requestAnimationFrame(()=>input.current?.focus());
    }
  }
  return <div className="sidebar-inline-name"><input ref={input} aria-label={uiText('Rename ')+name} aria-invalid={!!error} value={value} maxLength={maxLength} disabled={pending} onChange={event=>setValue(event.target.value)} onBlur={()=>void save()} onDragStart={event=>event.preventDefault()} onKeyDown={event=>{
    event.stopPropagation();
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Enter'){event.preventDefault();void save();}
    if(event.key==='Escape'){event.preventDefault();finishing.current=true;onDone();}
  }}/>{error&&<small role="alert">{error}</small>}</div>;
}

interface Container {scope?: string; linkedCollection?: string; type: 'collections' | 'folders'; id?: string; name: string; collection: string; parent: string}
export function SidebarOrganization({vaultId, data, pages, activePageId, activeFolderPath, revealPageId, onRevealed, context, active, unfiledActive = false, disabled, available, onOpen, onOpenUnfiled, onOpenPage, onRenamePage, onDeletePage, onMovePage, onChanged, onError}: {
  activePageId?: string; activeFolderPath: string[]; revealPageId: string | null; onRevealed: () => void;
  vaultId?: string; data: Organization; pages: PageSummary[]; context: OrganizationContext; active: boolean; unfiledActive?:boolean; disabled: boolean; available: boolean;
  onOpenUnfiled: () => void; onRenamePage: (page:PageSummary,title:string) => Promise<void>; onDeletePage: (page:PageSummary) => void;
  onOpen: (collection?: string, folder?: string) => void; onOpenPage: (id: string) => void;
  onMovePage: (id: string, collection: string, folder: string | null, remove?:boolean) => Promise<void>;
  onChanged: (data: Organization) => void; onError: (error: unknown) => void;
}) {
  const [renameKey,setRenameKey]=useState<string|null>(null);
  const [organizePage, setOrganizePage] = useState<PageSummary|null>(null);
  const [edit, setEdit] = useState<Container | null>(null), [remove, setRemove] = useState<Container | null>(null);
  const [addFolder, setAddFolder] = useState<{folderId?:string;collectionId?:string}|null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => readSidebarExpansion(vaultId));
  const [dropTarget, setDropTarget] = useState<string | null>(null), [dropStatus, setDropStatus] = useState('');
  const dropping = useRef(false);
  const tree = useRef<HTMLElement>(null);
  useEffect(() => { if (vaultId) saveSidebarExpansion(vaultId, expanded); }, [vaultId, expanded]);
  useEffect(() => {
    if (!revealPageId || revealPageId !== activePageId) return;
    setExpanded(previous => new Set([...previous, ...(activeFolderPath.length ? activeFolderPath.map(id => 'folder:' + id) : ['unfiled'])]));
    const frame = requestAnimationFrame(() => {
      const link = Array.from(tree.current?.querySelectorAll<HTMLAnchorElement>('[data-canonical-page]') ?? []).find(item => item.dataset.canonicalPage === revealPageId);
      link?.scrollIntoView({block:'nearest'});
      link?.focus({preventScroll:true});
      onRevealed();
    });
    return () => cancelAnimationFrame(frame);
  }, [revealPageId, activePageId, activeFolderPath, onRevealed]);
  useEffect(() => {
    if (!active || !context.folder) return;
    const path = folderBreadcrumbs(data.folders, context.folder);
    setExpanded(previous => new Set([...previous, ...path.map(crumb => 'folder:' + crumb.target!.folder)]));
  }, [active, context.folder, data.folders]);
  const toggle = (id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const expand = (id: string) => setExpanded(previous => new Set(previous).add(id));
  const newFolder = (collection: string, parent = '') => setEdit({type: 'folders', name: '', collection, parent});
  const containedPages = (collection: string, folder: string | null) => pages.filter(page => collection ? data.memberships.some(item => item.kind === 'page' && item.item_id === page.id && item.collection_id === collection) : folder ? data.locations.some(item => item.kind === 'page' && item.item_id === page.id && item.folder_id === folder) : !data.locations.some(item => item.kind === 'page' && item.item_id === page.id && item.folder_id));
  async function drop(event: DragEvent, container: Container) {
    event.preventDefault(); setDropTarget(null);
    if (disabled || dropping.current || !vaultId) return;
    if (container.type === 'collections' && isFolderDrag(event)) {
      const folderId=readFolderDrop(event,vaultId);
      if (folderId && data.folders.some(folder=>folder.id===folderId)) setAddFolder({folderId,collectionId:container.id});
      return;
    }
    const id = readPageDrop(event, vaultId);
    if (!id || !pages.some(page => page.id === id)) return;
    dropping.current = true;
    setDropStatus(container.type === 'folders' ? 'Moving page…' : 'Adding to collection…');
    try {
      await onMovePage(id, container.collection, container.type === 'folders' ? container.id! : null);
      setExpanded(previous => { const next = new Set(previous); next.add(container.type === 'collections' ? 'collection:' + container.id : (container.scope ?? '') + 'folder:' + container.id); return next; });
      setDropStatus(`Page added to ${container.name}`);
    } catch (error) { setDropStatus('Could not move page. Try again.'); onError(error); }
    finally { dropping.current = false; }
  }
  function item(container: Container, depth = 0) {
    const branch = container.type === 'collections' ? 'collection:' + container.id : (container.scope ?? '') + 'folder:' + container.id;
    const selected = active && (container.type === 'folders' ? context.folder === container.id : context.collection === container.id && !context.folder);
    const open = () => onOpen(container.collection, container.type === 'folders' ? container.id : '');
    const hasChildren = container.type === 'collections' && (data.folderLinks ?? []).some(link=>link.collection_id===container.id) || container.type === 'folders' && data.folders.some(folder => folder.parent_id === container.id) || containedPages(container.collection, container.type === 'folders' ? container.id! : null).length > 0;
    const icon = container.type === 'folders' ? container.linkedCollection ? 'folder-linked' : 'folder' : 'collection';
    return <div className={'sidebar-item-row organization-branch ' + (selected ? 'is-selected ' : '') + (dropTarget === container.id ? 'is-drop-target' : '')} style={{paddingLeft: Math.min(depth, 5) * 12}}
      draggable={!disabled && renameKey!==branch && container.type === 'folders'} onDragStart={event => { if (container.type === 'folders' && vaultId) startFolderDrag(event, vaultId, container.id!); }}
      onDragOver={event => { if (!disabled && !dropping.current && (isPageDrag(event) || container.type === 'collections' && isFolderDrag(event))) { event.preventDefault(); event.dataTransfer.dropEffect = container.type === 'collections' ? 'copy' : 'move'; setDropTarget(container.id!); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current === container.id ? null : current); }}
      onDrop={event => void drop(event, container)}
      {...(container.type === 'folders' ? folderDropHandlers({
        folder: data.folders.find(folder => folder.id === container.id)!, vaultId: vaultId || '', pages, data, pending: disabled, moving: dropping,
        onHover: setDropTarget, onStatus: setDropStatus, onError,
        onMove: async (pageId, folderId) => { await onMovePage(pageId, '', folderId); expand((container.scope ?? '') + 'folder:' + folderId); },
        onMoveFolder: async (source, parentId) => {
          onChanged(await api.organize(vaultId!, 'folders/' + source.id, {name: source.name, parent_id: parentId}));
          expand((container.scope ?? '') + 'folder:' + parentId);
        },
      }) : {})}>

      {hasChildren ? <button className="branch-toggle" disabled={disabled} aria-label={(expanded.has(branch) ? uiText("Collapse ") : uiText("Expand ")) + container.name} aria-expanded={expanded.has(branch)} onClick={() => toggle(branch)}><span className="branch-container-icon"><Icon name={icon}/></span><span className="branch-chevron"><Icon name="chevron"/></span></button> : <button className="branch-leaf-icon" disabled={disabled} aria-label={uiText("Open ") + container.name} onClick={open}><Icon name={icon}/></button>}
      {renameKey===branch ? <SidebarNameInput maxLength={200} name={container.name} onDone={()=>setRenameKey(current=>current===branch?null:current)} onSave={async name=>{onChanged(await api.organize(vaultId!,container.type+'/'+container.id,{name,...(container.type==='folders'?{parent_id:container.parent||null}:{})},'PUT'));}}/> : <button className={'nav container-link ' + (selected ? 'active' : '')} disabled={disabled} aria-label={uiText("Open ") + (container.type === 'folders' ? uiText("folder: ") : uiText("collection: ")) + container.name} title={container.name} onClick={open}><span>{container.name}{container.linkedCollection && <small className="linked-folder-label">{uiText("Linked")}</small>}</span></button>}
      {renameKey!==branch && <ActionMenu label={'Options for ' + container.name} disabled={disabled} actions={[
        {get label(){return uiText("Open")}, icon, onSelect: open},
        {label: container.type === 'folders' ? uiText("Add to collection…") : uiText("Add folder…"), icon:'collection', onSelect:()=>setAddFolder(container.type==='folders'?{folderId:container.id}:{collectionId:container.id})},
        {get label(){return uiText("Rename")}, icon: 'edit', onSelect: () => setRenameKey(branch)},
        ...(container.type === 'folders' ? [{label: data.favourites.some(item => item.kind === 'folder' && item.item_id === container.id) ? uiText("Remove from favourites") : uiText("Add to favourites"), icon: 'star', onSelect: () => { void api.organize(vaultId!, 'favourites', {kind: 'folder', item_id: container.id, favourite: !data.favourites.some(item => item.kind === 'folder' && item.item_id === container.id)}).then(onChanged).catch(onError); }}] : []),
        ...(container.type === 'folders' ? [{label: uiText("New subfolder"), icon: 'plus', onSelect: () => newFolder('', container.id)}] : []),
        ...(container.linkedCollection ? [{label:uiText("Unlink from collection"),icon:'close',onSelect:()=>{void api.organize(vaultId!,'folder-memberships',{folder_id:container.id,collection_id:container.linkedCollection,remove:true}).then(onChanged).catch(onError);}}] : [{label: 'Remove ' + (container.type === 'folders' ? 'folder' : 'collection'), icon: 'trash', danger: true, onSelect: () => setRemove(container)}]),
      ]}/>}
    </div>;
  }
  function pageLinks(collection: string, folder: string | null, depth: number, scope = '') {
    return containedPages(collection, folder).map(page => <div className={"sidebar-item-row sidebar-page-row " + (page.id===activePageId?"is-current-page":"")} key={page.id}>{renameKey===`${scope}${collection}/page:${page.id}` ? <><span className="sidebar-rename-page-icon" style={{paddingLeft:8+Math.min(depth,5)*12}}><PageIcon icon={page.icon}/></span><SidebarNameInput name={page.title} onDone={()=>setRenameKey(current=>current===`${scope}${collection}/page:${page.id}`?null:current)} onSave={title=>onRenamePage(page,title)}/></> : <><a className="page-link organization-page-link" href={pageURL(vaultId!, page.id)} aria-current={page.id === activePageId ? 'page' : undefined} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined} data-canonical-page={!collection && !scope ? page.id : undefined} style={{paddingLeft: 8 + Math.min(depth, 5) * 12}} draggable={!disabled} onDragStart={event => startPageDrag(event, vaultId!, page.id)} onClick={event => {
      if (disabled) { event.preventDefault(); return; }
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onOpenPage(page.id);
    }} title={page.title || uiText("Untitled")}><PageIcon icon={page.icon}/><span className="page-link-title"><TitleText text={page.title || 'Untitled'}/></span></a><ActionMenu label={'Actions for ' + (page.title || uiText('Untitled'))} disabled={disabled} actions={[
      {label:uiText('Open'),icon:'page',onSelect:()=>onOpenPage(page.id)},
      {label:uiText('Rename'),icon:'edit',onSelect:()=>setRenameKey(`${scope}${collection}/page:${page.id}`)},
      {label:uiText('Organize…'),icon:'folder',onSelect:()=>setOrganizePage(page)},
      {label:data.favourites.some(item=>item.kind==='page'&&item.item_id===page.id)?uiText('Remove from favourites'):uiText('Add to favourites'),icon:'star',onSelect:()=>{void api.organize(vaultId!,'favourites',{kind:'page',item_id:page.id,favourite:!data.favourites.some(item=>item.kind==='page'&&item.item_id===page.id)}).then(onChanged).catch(onError);}},
      {label:uiText('Move to Trash'),icon:'trash',danger:true,onSelect:()=>onDeletePage(page)},
    ]}/></>}</div>);
  }
  function folders(collection: string, parent: string | null, depth: number, scope = '') {
    return data.folders.filter(folder => folder.parent_id === parent).map(folder => <div key={folder.id}>
      {item({type: 'folders', id: folder.id, name: folder.name, collection, parent: folder.parent_id || '', scope}, depth)}
      {expanded.has(scope + 'folder:' + folder.id) && <div className="sidebar-branch-children">{folders(collection, folder.id, depth + 1, scope)}{pageLinks(collection, folder.id, depth + 1, scope)}</div>}
    </div>);
  }
  return <nav ref={tree} className="sidebar-group organization-sidebar" aria-label={uiText("Folders and collections")} onDragEnd={() => setDropTarget(null)}>
    {available && <><div className="organization-sidebar-label">{uiText("Folders")}<ActionMenu icon="plus" label={uiText("Folder actions")} disabled={disabled} actions={[{get label(){return uiText("New folder")}, icon: 'folder', onSelect: () => newFolder('')}]}/></div>{folders('', null, 0)}{containedPages('', null).length > 0 && <div>
      <div className={"sidebar-item-row organization-branch " + (unfiledActive?"is-selected":"")}>
        <button className="branch-toggle" disabled={disabled} aria-label={(expanded.has('unfiled')?uiText('Collapse '):uiText('Expand '))+uiText('Unfiled pages')} aria-expanded={expanded.has('unfiled')} onClick={()=>toggle('unfiled')}><span className="branch-container-icon"><Icon name="inbox"/></span><span className="branch-chevron"><Icon name="chevron"/></span></button>
        <button className={"nav container-link " + (unfiledActive?"active":"")} disabled={disabled} aria-label={uiText('Open ')+uiText('Unfiled pages')} title={uiText('Unfiled pages')} onClick={onOpenUnfiled}><span>{uiText('Unfiled pages')}</span></button>
        <ActionMenu label={'Options for '+uiText('Unfiled pages')} disabled={disabled} actions={[
          {label:uiText('Open'),icon:'inbox',onSelect:onOpenUnfiled},
          {label:(expanded.has('unfiled')?uiText('Collapse '):uiText('Expand '))+uiText('Unfiled pages'),icon:'chevron',onSelect:()=>toggle('unfiled')},
        ]}/>
      </div>
      {expanded.has('unfiled') && <div className="sidebar-branch-children">{pageLinks('', null, 1)}</div>}
    </div>}{!data.folders.length && <button className="sidebar-create" disabled={disabled} onClick={() => newFolder('')}><Icon name="plus"/>{uiText("Create a folder")}</button>}<div className="organization-sidebar-label">{uiText("Collections")}<ActionMenu icon="plus" label={uiText("Collection actions")} disabled={disabled} actions={[
      {get label(){return uiText("New collection")}, icon: 'collection', onSelect: () => setEdit({type: 'collections', name: '', collection: '', parent: ''})},
    ]}/></div>{data.collections.map(collection => <div key={collection.id}>
      {item({type: 'collections', id: collection.id, name: collection.name, collection: collection.id, parent: ''})}
      {expanded.has('collection:' + collection.id) && <div className="sidebar-branch-children">{(data.folderLinks ?? []).filter(link=>link.collection_id===collection.id).map(link=>{
        const folder=data.folders.find(folder=>folder.id===link.folder_id);
        return folder ? <div key={folder.id}>{item({type:'folders',id:folder.id,name:folder.name,collection:'',parent:folder.parent_id||'',linkedCollection:collection.id,scope:'collection:' + collection.id + '/'},1)}{expanded.has('collection:' + collection.id + '/folder:' + folder.id)&&<div className="sidebar-branch-children">{folders('',folder.id,2,'collection:' + collection.id + '/')}{pageLinks('',folder.id,2,'collection:' + collection.id + '/')}</div>}</div> : null;
      })}{pageLinks(collection.id, null, 1)}</div>}
    </div>)}{!data.collections.length && <button className="sidebar-create" disabled={disabled} onClick={() => setEdit({type: 'collections', name: '', collection: '', parent: ''})}><Icon name="plus"/>{uiText("Create a collection")}</button>}</>}
    <span className="sr-only" role="status">{dropStatus}</span>
    {organizePage && <PageOrganizationDialog page={organizePage} data={data} onMove={(collection,folder,remove)=>onMovePage(organizePage.id,collection,folder,remove)} onClose={()=>setOrganizePage(null)}/>}
    {addFolder && vaultId && <FolderCollectionDialog vaultId={vaultId} data={data} {...addFolder} onChanged={onChanged} onClose={()=>setAddFolder(null)}/>}
    {edit && <NameDialog title={(edit.id ? uiText("Rename ") : uiText("New ")) + (edit.type === 'collections' ? uiText("collection") : uiText("folder"))} value={edit.name} onClose={() => setEdit(null)} onSave={async name => {
      const updated = await api.organize(vaultId!, edit.type + (edit.id ? '/' + edit.id : ''), {name, ...(edit.type === 'folders' ? {parent_id: edit.parent || null} : {})}, edit.id ? 'PUT' : 'POST');
      onChanged(updated);
    }}/>}
    {remove && <ConfirmDialog danger title={uiText("Remove ") + (remove.type === 'folders' ? uiText("folder?") : uiText("collection?"))} description={remove.type === 'folders' ? `Remove “${remove.name}” and its subfolders? Their contents return to Inbox. Collection memberships and note favourites are kept.` : `Remove “${remove.name}”? Only its memberships are removed. Notes keep their folder locations.`} action={uiText("Remove")} onClose={() => setRemove(null)} onConfirm={async () => {
      onChanged(await api.organize(vaultId!, remove.type + '/' + remove.id, undefined, 'DELETE'));
    }}/>}
  </nav>;
}
