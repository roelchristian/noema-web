import {TitleText} from './components/TitleText';
import {highlightPagePassage} from './search/page-passage-highlight';
import {projectPageText} from '../shared/page-text';
import type {PageReference} from '../shared/embeddings';
import {SourceViewer} from './sources/SourceViewer';
import {SourceReferencePreview} from './sources/SourceReferencePreview';
import type {SourceReference} from '../shared/domain';
import {hasUnsavedEntityDrafts} from './knowledge/entity-drafts';
import { animateSidebarClick } from './components/sidebar-motion';
import { folderBreadcrumbs, pageBreadcrumbs } from './organization/breadcrumbs';
import { inboxPages } from './organization/inbox';
import { AIActivityNotifications } from './intelligence/AIActivityNotifications';
import { SearchPanel } from './search/SearchPanel';
import { IntelligencePanel } from './intelligence/IntelligencePanel';
import { ActionMenu } from './components/ActionMenu';
import { NameDialog } from './components/NameDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { TrashLibrary } from './trash/TrashLibrary';
import {entityLabels, entityTypes, entityMentionName, type Entity, type EntityType, type PageSummary} from '../shared/domain';
import { Select } from './components/Select';
import { WorkspaceNavigation, useMobileViewport } from './components/WorkspaceNavigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SettingsDialog } from './settings/SettingsDialog';
import { useAppearance } from './settings/useAppearance';
import { RecentLibrary } from './organization/RecentLibrary';
import { SidebarOrganization } from './organization/SidebarOrganization';
import { OrganizationLibrary } from './organization/OrganizationLibrary';
import { Workspace } from './state/workspace';
import { usePageScroll } from './state/use-page-scroll';
import {captureLibraryView, useLibraryScroll} from './state/use-library-scroll';
import {useLibraryViewState} from './state/library-view-state';
import { Icon } from './components/Icon';
import { EntityPreview } from './components/EntityPreview';
import { PageToolbar } from './editor/PageToolbar';
import { PageEditor } from './editor/PageEditor';
import {pageHeadings} from './editor/page-headings';
import { PageDraftRecoveryNotice } from './editor/PageDraftRecoveryNotice';
import { useDocumentHistory } from './editor/use-document-history';
import { EntityPanel } from './knowledge/EntityPanel';
import { KnowledgeLibrary } from './knowledge/KnowledgeLibrary';
import { CreatePageFromSourceDialog } from './knowledge/CreatePageFromSourceDialog';
import { CreateEntityDialog, type CreateEntityRequest } from './knowledge/CreateEntityDialog';
import {DeleteVaultDialog} from './vaults/DeleteVaultDialog';
import { VaultBackupDialog } from './vaults/VaultBackupDialog';
import { VaultDialog, type VaultAction } from './vaults/VaultDialog';
export function App() {
  const mobile = useMobileViewport();
  const [revealPageId, setRevealPageId] = useState<string | null>(null);
  const onRevealed = useCallback(() => setRevealPageId(null), []);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [tocVisible,setTocVisible]=useState(()=>{
    try{return localStorage.getItem('noema-table-of-contents-visible')!=='false';}catch{return true;}
  });
  useEffect(()=>{
    try{localStorage.setItem('noema-table-of-contents-visible',String(tocVisible));}catch{/* Keep the setting usable without browser storage. */}
  },[tocVisible]);
  useEffect(() => { if (!mobile) setNavigationOpen(false); }, [mobile]);
  const [aiOpen,setAiOpen]=useState(() => {
    try { return localStorage.getItem('noema-knowledge-panel-open') === 'true'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('noema-knowledge-panel-open', String(aiOpen)); }
    catch { /* Keep the panel usable when browser storage is unavailable. */ }
  }, [aiOpen]);
  const [pagePassage,setPagePassage]=useState<PageReference|null>(null);
  const [sourceReference,setSourceReference]=useState<SourceReference|null>(null);
  const sourceTrigger=useRef<HTMLElement|null>(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PageSummary | null>(null);
  const [renameTarget, setRenameTarget] = useState<PageSummary | null>(null);
  const {appearance, setAppearance, storageError} = useAppearance();
  const [workspace] = useState(() => new Workspace());
  useLibraryScroll(workspace);
  usePageScroll(workspace);
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const {vaults, vault, pages, entities, page, view, busy, loadingPageId, reviewing, error, saveStatus, organization, organizationContext, recent, trash, saveFailures, draftStorageFailures, draftRecoveries} = state;
  const headings=useMemo(()=>page? pageHeadings(page.blocks,entities.filter(entity=>entity.vault_id===page.vault_id)):[],[page?.blocks,page?.vault_id,entities]);
  const activePageId = view === 'pages' && !vault?.locked ? page?.id : undefined;
  const activeFolderPath = useMemo(() => {
    const location = organization.locations.find(item => item.kind === 'page' && item.item_id === activePageId);
    return folderBreadcrumbs(organization.folders, location?.folder_id).map(crumb => crumb.target!.folder);
  }, [organization, activePageId]);
  const [knowledgeBrowser, setKnowledgeBrowser] = useLibraryViewState(vault?.id ?? '', 'knowledge');
  const knowledgeType = entityTypes.includes(knowledgeBrowser.entityType as EntityType) ? knowledgeBrowser.entityType as EntityType : '';
  const editingHistory = useDocumentHistory(view === 'pages' && !busy && !vault?.locked ? page : null, patch => workspace.updatePage(patch), loadingPageId !== null || reviewing);
  // Keep every library view current while source work continues, independently
  // of whether its completion notification remains in the bell's recent items.
  const sourcesProcessing=entities.some(entity=>entity.type==='source'&&(entity.sourceStatus==='queued'||entity.sourceStatus==='processing'||entity.sourceStatus==='ready'&&(entity.sourceEnrichmentStatus==='pending'||entity.sourceEnrichmentStatus==='running')));
  useEffect(()=>{
    if(!vault||vault.locked||!sourcesProcessing)return;
    const controller=new AbortController();let refreshing=false;
    const refresh=async()=>{
      if(controller.signal.aborted||document.visibilityState!=='visible'||refreshing)return;
      refreshing=true;
      try{await workspace.refreshEntities(controller.signal);}
      catch{/* Transient failures retry on the next interval or window focus. */}
      finally{refreshing=false;}
    };
    void refresh();
    const timer=setInterval(()=>{void refresh();},1500);
    const resume=()=>{void refresh();};
    window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);};
  },[workspace,vault?.id,vault?.locked,sourcesProcessing]);
  const panelId = state.entityPanelId;
  useEffect(() => { setNavigationOpen(false); }, [view, page?.id, organizationContext.collection, organizationContext.folder, panelId, vault?.id]);
  const [sourcePage,setSourcePage]=useState<Entity|null>(null);
  const [create, setCreate] = useState<CreateEntityRequest | null>(null), [vaultAction, setVaultAction] = useState<VaultAction | null>(null);
  const [vaultDeletionOpen,setVaultDeletionOpen]=useState(false),[vaultNotice,setVaultNotice]=useState('');
  const [pendingInsert,setPendingInsert]=useState<{vaultId:string;pageId:string;entityId:string;name:string;insert:(id:string)=>void}|null>(null);
  const [insertNotice,setInsertNotice]=useState<{entityId:string;name:string}|null>(null);
  useEffect(()=>{setInsertNotice(null);},[vault?.id,vault?.locked,page?.id]);
  useEffect(()=>{
    if(create||!pendingInsert)return;
    // The creation dialog must release modal focus before the editor restores its saved range.
    const frame=requestAnimationFrame(()=>{
      const current=workspace.snapshot();
      if(current.vault?.id===pendingInsert.vaultId&&!current.vault.locked&&current.page?.id===pendingInsert.pageId) {
        try{pendingInsert.insert(pendingInsert.entityId);setInsertNotice({entityId:pendingInsert.entityId,name:pendingInsert.name});}catch(error){workspace.report(error);}
      }
      setPendingInsert(null);
    });
    return()=>cancelAnimationFrame(frame);
  },[create,pendingInsert,workspace]);
  const [backupAction,setBackupAction]=useState<'export'|'import'|null>(null);
  const knowledgeVisible = aiOpen && !searchOpen && !panelId && !sourceReference;
  const beginSourcePage=(source:Entity)=>{sourceTrigger.current=null;setSourceReference(null);workspace.closeEntity();setAiOpen(false);setSearchOpen(false);setNavigationOpen(false);setSourcePage(source);};
  const openEntity = (id: string) => { sourceTrigger.current=null;setSourceReference(null); setSearchOpen(false); workspace.openEntity(id); };
  const openSourceReference=(reference:SourceReference,trigger?:HTMLElement)=>{
    sourceTrigger.current=trigger??null;workspace.closeEntity();setSearchOpen(false);setNavigationOpen(false);setSourceReference(reference);
  };
  const closeSourceReference=()=>{setSourceReference(null);if(sourceTrigger.current?.isConnected)sourceTrigger.current.focus({preventScroll:true});sourceTrigger.current=null;};
  useEffect(()=>{setSourceReference(null);sourceTrigger.current=null;},[vault?.id,vault?.locked,page?.id,view]);
  useEffect(()=>{if(searchOpen||panelId)setSourceReference(null);},[searchOpen,panelId]);
  const run = (work: () => Promise<unknown>) => { void work().catch(workspace.report); };
  const openIndexedPage=async(id:string,reference?:PageReference)=>{
    setSearchOpen(false);setSettingsOpen(false);setPagePassage(null);
    await workspace.openPage(id);
    const current=workspace.snapshot();
    if(reference&&current.page?.id===reference.pageId&&current.page.revision===reference.revision) {
      const names=new Map(current.entities.map(entity=>[entity.id,entityMentionName(entity)]));
      const projection=projectPageText(current.page.blocks,id=>names.get(id));
      if(projection.text.slice(reference.startOffset,reference.endOffset)===reference.excerpt)setPagePassage(reference);
    }
  };
  // Expire the navigation target itself so background updates cannot reapply it.
  useEffect(()=>{
    if(!pagePassage)return;
    const timer=setTimeout(()=>setPagePassage(current=>current===pagePassage?null:current),5000);
    return()=>clearTimeout(timer);
  },[pagePassage]);
  useEffect(()=>{
    if(!pagePassage||page?.id!==pagePassage.pageId||page.revision!==pagePassage.revision||vault?.locked||busy||loadingPageId)return;
    let cleanup=()=>{};
    const frame=requestAnimationFrame(()=>{cleanup=highlightPagePassage(pagePassage,page,entities);});
    return()=>{cancelAnimationFrame(frame);cleanup();};
  },[pagePassage,page?.id,page?.revision,vault?.id,vault?.locked,busy,loadingPageId,entities]);

  useEffect(() => { const detachNavigation = workspace.attachBrowserNavigation(); void workspace.init(); return () => { detachNavigation(); workspace.saver.dispose(); workspace.titler.dispose(); }; }, [workspace]);
  useEffect(()=>{setSearchOpen(false);},[vault?.id,vault?.locked]);
  useEffect(() => { setCreate(null); setSourcePage(null); setDeleteTarget(null); setRenameTarget(null); setVaultDeletionOpen(false); }, [vault?.id, vault?.locked]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (workspace.saver.hasPending || hasUnsavedEntityDrafts()) { e.preventDefault(); e.returnValue = ''; } };
    const keyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]') && workspace.snapshot().vault && !workspace.snapshot().vault?.locked) { e.preventDefault(); workspace.closeEntity(); setSearchOpen(value=>!value); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void workspace.saver.flush().catch(workspace.report); }
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) {workspace.closeEntity();setSourceReference(null);if(sourceTrigger.current?.isConnected)sourceTrigger.current.focus({preventScroll:true});sourceTrigger.current=null;}
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('keydown', keyDown);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', keyDown); };
  }, [workspace]);
  const pageLinksDisabled = busy || reviewing || !vault || vault.locked;
  const disabled = pageLinksDisabled || loadingPageId !== null;
  const pageStatus = page ? workspace.pageSaveStatus(page.vault_id,page.id) : saveStatus;
  const activeRecovery = page && draftRecoveries.find(item=>item.vaultId===page.vault_id&&item.pageId===page.id);
  const vaultSaveFailures = saveFailures.filter(issue=>issue.vaultId===vault?.id);
  const vaultStorageFailures = draftStorageFailures.filter(issue=>issue.vaultId===vault?.id);
  const status = vault?.locked ? 'Vault locked' : {saved: 'All changes saved', pending: 'Unsaved changes', identifying: 'Identifying entities…', saving: 'Saving…', error: 'Save failed · click to retry'}[saveStatus];
  const breadcrumbs: {key: string; label: string; icon?: string; onClick?: () => void}[] = [
    {key: 'vault', label: vault?.name || 'Noema', icon: 'vault'},
  ];
  if (vault && !vault.locked) {
    if (view === 'pages') {
      for (const crumb of pageBreadcrumbs(organization, page)) {
        const target = crumb.target;
        breadcrumbs.push({...crumb, onClick: target ? () => workspace.openOrganization(target.collection, target.folder) : undefined});
      }
    } else {
      const label = view === 'inbox' ? 'Inbox' : view === 'trash' ? 'Trash' : view === 'entities' ? 'Knowledge entities' : view === 'organization' ? 'Pages' : view === 'favourites' ? 'Favourites' : 'Recent items';
      const icon = view === 'inbox' ? 'inbox' : view === 'trash' ? 'trash' : view === 'entities' ? 'knowledge' : view === 'organization' ? 'page' : view === 'favourites' ? 'star' : 'recent';
      breadcrumbs.push({key: 'view', label, icon, onClick: view === 'organization' ? () => workspace.openOrganization() : view === 'entities' && knowledgeType ? () => {captureLibraryView(); setKnowledgeBrowser({entityType: ''});} : undefined});
      if (view === 'entities' && knowledgeType) {
        breadcrumbs.push({key: 'entity-type:' + knowledgeType, label: entityLabels[knowledgeType], icon: knowledgeType});
      }
      if (view === 'organization') {
        const collection = organization.collections.find(item => item.id === organizationContext.collection);
        if (collection) breadcrumbs.push({key: 'collection:' + collection.id, label: collection.name, onClick: () => workspace.openOrganization(collection.id)});
        else for (const crumb of folderBreadcrumbs(organization.folders, organizationContext.folder)) {
          breadcrumbs.push({...crumb, onClick: () => workspace.openOrganization('', crumb.target!.folder)});
        }
      }
    }
  }
  return <>
    <WorkspaceNavigation mobile={mobile} open={navigationOpen} onClose={() => setNavigationOpen(false)}>
    <aside className="sidebar" onClickCapture={animateSidebarClick} data-navigating={loadingPageId !== null}><div className="sidebar-heading"><a className="brand" href="/" aria-label="Noema home"><img className="brand-mark" src="/noema-mark.svg" alt="" width="38" height="38"/><span>noema</span></a>
      <button className="mobile-navigation-close" type="button" aria-label="Close navigation" onClick={() => setNavigationOpen(false)}><Icon name="close"/></button>
      <button className="sidebar-new-note" type="button" aria-label="New Note" title="New Note" disabled={disabled || reviewing} onClick={() => { workspace.closeEntity(); setSearchOpen(false); run(() => workspace.newPage()); }}><Icon name="compose"/></button></div>
      <div className="sidebar-scroll-region">
      <nav className="sidebar-group" aria-label="Quick access">
        <button className={'nav '+(searchOpen?'active':'')} disabled={disabled} onClick={()=>{workspace.closeEntity();setSearchOpen(value=>!value);}} aria-label="Search vault" aria-haspopup="dialog" aria-expanded={searchOpen}><span><Icon name="search"/></span><span>Search</span><kbd>⌘K</kbd></button>
        <button className={'nav ' + (view === 'favourites' ? 'active' : '')} disabled={disabled} aria-label="Favourites" title="Favourites" onClick={() => workspace.showOrganization(true)}><span data-icon="star"><Icon name="star"/></span><span>Favourites</span></button>
        <button className={'nav ' + (view === 'recent' ? 'active' : '')} disabled={disabled} aria-label="Recent items" title="Recent items" onClick={() => workspace.showRecent()}><span data-icon="recent"><Icon name="recent"/></span><span>Recent items</span></button>
      </nav>
      <nav className="sidebar-group" aria-label="Vault library">
        <div className="workspace-label">Workspace</div>
        <button className={'nav ' + (view === 'pages' || view === 'organization' && !organizationContext.collection && !organizationContext.folder ? 'active' : '')} disabled={disabled} aria-label="Library" title="Library" onClick={() => run(() => workspace.showPages())}><span data-icon="page"><Icon name="page"/></span><span>Library</span><kbd>P</kbd></button>
        <button className={'nav ' + (view === 'inbox' ? 'active' : '')} disabled={disabled} aria-label="Inbox" title="Inbox" onClick={() => workspace.showInbox()}><span data-icon="inbox"><Icon name="inbox"/></span><span>Inbox</span><span className="count">{inboxPages(pages, organization).length}</span></button>
        <button className={'nav ' + (view === 'entities' ? 'active' : '')} disabled={disabled} aria-label="Knowledge entities" title="Knowledge entities" onClick={() => workspace.showEntities()}><span data-icon="knowledge"><Icon name="knowledge"/></span><span>Knowledge entities</span><span className="count">{entities.length}</span></button>
      </nav>
      <SidebarOrganization activePageId={activePageId} activeFolderPath={activeFolderPath} revealPageId={revealPageId} onRevealed={onRevealed} available={!!vault && !vault.locked} onOpenPage={id => run(() => workspace.openPage(id))} pages={pages} onMovePage={(id, collection, folder) => workspace.locatePage(id, collection, folder)} onError={workspace.report} key={vault?.id} vaultId={vault?.id} onChanged={workspace.setOrganization} data={organization} context={organizationContext} active={view === 'organization'} disabled={disabled} onOpen={(collection, folder) => workspace.openOrganization(collection, folder)}/>
      </div>
      <div id="page-section-guide"/>
      <div className="vault-controls"><label htmlFor="vault-select">VAULT</label><div className="vault-picker"><Select id="vault-select" aria-label="Current vault" value={vault?.id || ''} disabled={busy || !vaults.length} onChange={e => run(() => workspace.selectVault(e.target.value))}>{!vault && <option value="">{busy?'Loading vaults…':vaults.length?'Choose a vault':'No vaults'}</option>}{vaults.map(v => <option key={v.id} value={v.id}>{v.locked ? 'Locked · ' : ''}{v.name}</option>)}</Select><ActionMenu label="Vault options" disabled={busy} actions={[
        {label: 'New vault', icon: 'plus', onSelect: () => setVaultAction('create')},
        {label: 'Import vault…', icon: 'upload', disabled: reviewing, onSelect: () => setBackupAction('import')},
        {label: 'Export vault backup…', icon: 'download', disabled: !vault || vault.locked || reviewing, onSelect: () => setBackupAction('export')},
        {label: vault?.locked ? 'Unlock vault' : 'Lock vault', icon: 'vault', disabled: !vault, onSelect: () => { if (vault?.locked) setVaultAction('unlock'); else if (vault?.protected) run(() => workspace.lock()); else setVaultAction('lock'); }},
        {label: 'Trash', icon: 'trash', disabled, onSelect: () => { workspace.closeEntity(); run(() => workspace.showTrash()); }},
        {label: 'Settings', icon: 'settings', onSelect: () => setSettingsOpen(true)},
        {label: vault?.locked?'Delete vault… (unlock first)':'Delete vault…',icon:'trash',danger:true,disabled:!vault||vault.locked||reviewing,onSelect:()=>setVaultDeletionOpen(true)},
      ]}/></div></div>
    </aside>
    </WorkspaceNavigation>
    <main><header className="topbar"><button type="button" className="mobile-navigation-toggle" aria-label="Open navigation" aria-haspopup="dialog" aria-controls="workspace-navigation" aria-expanded={mobile && navigationOpen} onClick={() => setNavigationOpen(true)}><Icon name="menu"/></button><nav className="workspace-history" aria-label="Navigation history">
      <button type="button" className="history-back" aria-label="Go back" title="Go back" disabled={disabled || !state.canGoBack} onClick={() => { setSearchOpen(false); run(() => workspace.goHistory(-1)); }}><Icon name="chevron"/></button>
      <button type="button" aria-label="Go forward" title="Go forward" disabled={disabled || !state.canGoForward} onClick={() => { setSearchOpen(false); run(() => workspace.goHistory(1)); }}><Icon name="chevron"/></button>
    </nav><nav id="breadcrumb" className="breadcrumbs" aria-label="Breadcrumb">{breadcrumbs.map((crumb, index) => <span key={crumb.key}>{index > 0 && <Icon name="chevron"/>}{crumb.onClick ? <button onClick={crumb.onClick} disabled={busy || reviewing} aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.icon && <Icon name={crumb.icon}/>}<span>{crumb.key.startsWith('page:')?<TitleText text={crumb.label}/>:crumb.label}</span></button> : <span className="breadcrumb-label" aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.icon && <Icon name={crumb.icon}/>}<span>{crumb.key.startsWith('page:')?<TitleText text={crumb.label}/>:crumb.label}</span></span>}</span>)}</nav><div className="top-actions">{view === 'pages' && page && vault && !busy && !vault.locked && <PageToolbar tocAvailable={headings.length>0} tocVisible={tocVisible} onToggleToc={()=>setTocVisible(value=>!value)} onRevealInSidebar={() => { setNavigationOpen(true); setRevealPageId(page.id); }} onEditLockChange={(locked,password)=>workspace.setPageEditLock(locked,password)} onUndo={editingHistory.undo} onRedo={editingHistory.redo} canUndo={editingHistory.canUndo} canRedo={editingHistory.canRedo} onFeaturedImageChange={featuredImageId => editingHistory.change({featuredImageId})} onChangeBlocks={blocks => editingHistory.change({blocks})} onForward={mobile ? () => { setSearchOpen(false); run(() => workspace.goHistory(1)); } : undefined} forwardDisabled={disabled || !state.canGoForward} inactive={loadingPageId !== null} focusedReading={appearance.focusedReading} onToggleFocusedReading={() => setAppearance(current => ({...current, focusedReading: !current.focusedReading}))} aiOpen={knowledgeVisible} onAI={()=>{setSourceReference(null);setSearchOpen(false);workspace.closeEntity();setAiOpen(!knowledgeVisible);}} favourite={organization.favourites.some(item => item.kind === 'page' && item.item_id === page.id)} onOrganizationChange={data => { if (workspace.snapshot().vault?.id === vault.id) workspace.setOrganization(data); }} onDelete={() => workspace.deletePage(page.id)} key={vault.id + '/' + page.id} page={page} onError={workspace.report}/>}{view!=='pages'&&saveStatus!=='saved'&&!vault?.locked&&<button className={'save-state-indicator '+(saveStatus==='error'?'is-error':'')} aria-label={status} disabled={disabled} onClick={()=>run(()=>workspace.saver.flush())}><Icon name={saveStatus==='error'?'alert':'save'}/><span role="status">{status}</span></button>}<AIActivityNotifications onSourceUpdates={async()=>{if(workspace.snapshot().vault&&!workspace.snapshot().vault?.locked)await workspace.refreshEntities();}} onOpenEntity={async(vaultId,entityId)=>{if(workspace.snapshot().vault?.id!==vaultId)await workspace.selectVault(vaultId);await workspace.refreshEntities();openEntity(entityId);}} key={vaults.map(item=>item.id+':'+item.locked).join(',')} refreshKey={saveStatus+':'+(page?.revision??'')} onOpenPage={async(vaultId,pageId)=>{if(workspace.snapshot().vault?.id!==vaultId)await workspace.selectVault(vaultId);await workspace.openPage(pageId);}}/></div>{vault&&!vault.locked&&!busy&&(vaultSaveFailures.length>0||vaultStorageFailures.length>0||activeRecovery)&&<div className="page-persistence-notices" aria-label="Unfinished work">
      {vaultSaveFailures.map(issue=><div className="page-persistence-notice is-error" key={issue.pageId} role="alert"><span>Couldn’t save “{issue.title||'Untitled'}”. <small>{issue.message}</small></span>{page?.id!==issue.pageId&&<button type="button" disabled={disabled} onClick={()=>run(()=>workspace.openPage(issue.pageId))}>Open page</button>}<button type="button" disabled={disabled} onClick={()=>run(()=>workspace.retryPageSave(issue.vaultId,issue.pageId))}>Retry</button></div>)}
      {vaultStorageFailures.map(issue=><div className="page-persistence-notice is-error" key={'storage-'+issue.pageId} role="alert"><span>“{issue.title||'Untitled'}” has no recoverable browser copy. Keep this tab open until it saves. <small>{issue.message}</small></span><button type="button" disabled={disabled} onClick={()=>run(()=>workspace.retryPageSave(issue.vaultId,issue.pageId))}>Retry</button></div>)}
      {activeRecovery&&page&&<PageDraftRecoveryNotice key={activeRecovery.vaultId+'/'+activeRecovery.pageId} recovery={activeRecovery} page={page} entities={entities} pages={pages} onRestore={entry=>workspace.restorePageDraft(entry)} onDiscard={()=>workspace.discardPageDrafts(activeRecovery.vaultId,activeRecovery.pageId)}/>}
    </div>}</header>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{loadingPageId !== null ? `Opening ${pages.find(item=>item.id===loadingPageId)?.title || 'note'}…` : ''}</div>
      <div id="content" inert={busy||reviewing||loadingPageId !== null} aria-busy={busy||reviewing||loadingPageId !== null}>
        {busy && view !== 'trash' ? <p className="loading-state" role="status">Loading workspace…</p> : !vault ? <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1 className="page-heading">{vaults.length?'Choose a vault':'No vaults yet'}</h1><p>{vaults.length?'Choose a vault from the sidebar, or create or import one.':'Create a vault or import a backup whenever you’re ready.'}</p><div className="empty-vault-actions"><button type="button" className="button primary" onClick={()=>setVaultAction('create')}>Create a vault</button><button type="button" className="button" onClick={()=>setBackupAction('import')}>Import backup</button></div></section> : vault?.locked ? <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1 className="page-heading">{vault.name}</h1><button className="button primary" onClick={() => setVaultAction('unlock')}>Unlock vault</button></section> : vault && view === 'trash' ? <TrashLibrary vaultId={vault.id} notes={trash} onRestore={id => workspace.restorePage(id)} onDelete={id => workspace.permanentlyDeletePage(id)} onRefresh={workspace.refreshTrash} onError={workspace.report}/> : vault && view === 'recent' ? <RecentLibrary vaultId={vault.id} recent={recent} pages={pages} entities={entities} onOpenPage={id => run(() => workspace.openPage(id))} onOpenEntity={openEntity}/> : vault && (view === 'organization' || view === 'favourites' || view === 'inbox') ? <OrganizationLibrary onOpenPassage={openSourceReference} onOpenFolder={id => workspace.openOrganization('', id)} onNewNote={() => { workspace.closeEntity(); setSearchOpen(false); run(() => workspace.newPage()); }} inboxOnly={view === 'inbox'} onRenamePage={setRenameTarget} onDeletePage={setDeleteTarget} data={organization} key={vault.id + view} vaultId={vault.id} pages={pages} entities={entities} favouritesOnly={view === 'favourites'} context={organizationContext} onContextChange={workspace.setOrganizationContext} onChanged={workspace.setOrganization} onOpenPage={(id,reference) => run(() => openIndexedPage(id,reference))} onOpenEntity={openEntity} onError={workspace.report}/> : vault && view === 'entities' ? <KnowledgeLibrary onOpenPassage={openSourceReference} onCreatePageFromSource={beginSourcePage} onCreate={() => setCreate({})} vaultId={vault.id} key={vault.id} entities={entities} onOpen={openEntity}/> : vault && page ? <PageEditor tocVisible={tocVisible} headings={headings} subjectsSaving={state.domainSavingPageId===page.id} citationStyle={appearance.citationStyle} pages={pages} onOpenPage={id=>run(()=>workspace.openPage(id))} onAddAlias={workspace.addEntityAlias} saveStatus={pageStatus} onIdentify={workspace.identifyEntities} key={page.id} page={page} entities={entities} onChange={editingHistory.change} onOpenEntity={openEntity} onCreateEntity={setCreate} onSave={() => run(() => workspace.saver.flush())}/> : <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1 className="page-heading">Your space to think</h1><button className="button primary" disabled={!vault} onClick={() => run(() => workspace.newPage())}>Create your first page</button></section>}
      </div>
    </main>
    {knowledgeVisible && view==='pages' && page && vault && !vault.locked && !busy && <IntelligencePanel onDomainsChange={(primary,secondary)=>workspace.setPageDomains(primary,secondary)} pages={pages} onOpenPage={id=>run(()=>workspace.openPage(id))} inactive={loadingPageId !== null} onReview={(scanId,id,decision,edits)=>workspace.reviewEntity(scanId,id,decision,edits)} onSourcesChange={sourceIds => workspace.updatePage({sourceIds})} onCreateEntity={setCreate} entities={entities} onOpenEntity={openEntity} key={vault.id} page={page} onClose={()=>setAiOpen(false)} onSettings={()=>setSettingsOpen(true)} onFlush={async()=>{await workspace.saver.flush();return workspace.snapshot().page;}}/>}
    {searchOpen && vault && !vault.locked && !busy && <SearchPanel onOpenPassage={openSourceReference} key={vault.id} vaultId={vault.id} pages={pages} entities={entities} onOpenPage={(id,reference)=>run(()=>openIndexedPage(id,reference))} onOpenEntity={openEntity} onClose={()=>setSearchOpen(false)}/>}
    {panelId && !sourcePage && !sourceReference && vault && !vault.locked && !busy && <EntityPanel onCreatePageFromSource={beginSourcePage} onOpenPage={id => run(() => workspace.openPage(id))} refreshKey={JSON.stringify([pages.map(page => [page.id, page.title, page.updated_at]),entities.filter(entity=>entity.id===panelId).map(entity=>[entity.updated_at,entity.sourceStatus,entity.sourceEnrichmentStatus])])} key={vault.id + '/' + panelId} vaultId={vault.id} id={panelId} entities={entities} onOpen={openEntity} onClose={() => workspace.closeEntity()} onUpdated={() => workspace.refreshEntities()} onError={workspace.report}/>}
    {sourceReference && vault && !vault.locked && !busy && <SourceViewer key={vault.id+'/'+sourceReference.id} vaultId={vault.id} reference={sourceReference} entities={entities} onClose={closeSourceReference} onOpenEntity={openEntity}/>}
    {vault && !vault.locked && !busy && !reviewing && !settingsOpen && !create && !sourcePage && <SourceReferencePreview key={[vault.id,view,page?.id].join('/')} entities={entities} onOpen={openSourceReference}/>}
    {vault && !vault.locked && !busy && !reviewing && !settingsOpen && !create && !sourcePage && <EntityPreview key={[vault.id, view, page?.id, panelId].join('/')} entities={entities} onOpen={openEntity}/>}
    {sourcePage&&vault&&!vault.locked&&<CreatePageFromSourceDialog key={vault.id+'/'+sourcePage.id} vaultId={vault.id} source={sourcePage} onClose={()=>setSourcePage(null)} onCreated={page=>workspace.registerGeneratedPage(page)} onOpenPage={async id=>{workspace.closeEntity();await workspace.openPage(id);}} onSettings={()=>{setSourcePage(null);setSettingsOpen(true);}}/>}
    {create && vault && <CreateEntityDialog vaultId={vault.id} initial={create} onClose={() => setCreate(null)} onSubmit={async input => {
      const result = await workspace.createEntity(input);
      if (create.source && workspace.snapshot().page) workspace.updatePage({sourceIds: [...new Set([...workspace.snapshot().page!.sourceIds, result.id])]});
      if(create.intent==='insert'&&create.onCreated) {
        const current=workspace.snapshot();
        if(current.vault?.id===vault.id&&current.page)setPendingInsert({vaultId:vault.id,pageId:current.page.id,entityId:result.id,name:result.name,insert:create.onCreated});
      }else{create.onCreated?.(result.id);openEntity(result.id);}
    }}/>}
    {renameTarget && <NameDialog maxLength={500} title="Rename page" value={renameTarget.title} onSave={name => workspace.renamePage(renameTarget.id,name)} onClose={() => setRenameTarget(null)}/>}
    {deleteTarget && <ConfirmDialog danger title="Move note to Trash?" description={`“${deleteTarget.title || 'Untitled'}” will be kept in Trash for 30 days. You can restore it until then.`} action="Move to Trash" onConfirm={() => workspace.deletePage(deleteTarget.id)} onClose={() => setDeleteTarget(null)}/>}
    {settingsOpen && <SettingsDialog onOpenPassage={async(vaultId,reference)=>{if(workspace.snapshot().vault?.id!==vaultId)await workspace.selectVault(vaultId);setSettingsOpen(false);openSourceReference(reference);}} onOpenEntity={async(vaultId,entityId)=>{if(vault?.id!==vaultId)await workspace.selectVault(vaultId);await workspace.refreshEntities();openEntity(entityId);setSettingsOpen(false);}} onBeforeNetworkChange={() => workspace.saver.flush()} onChangePassphrase={(current, next) => workspace.setPassphrase(current, next)} vault={vault} onOpenPage={async(vaultId,pageId,reference)=>{if(vault?.id!==vaultId)await workspace.selectVault(vaultId);await openIndexedPage(pageId,reference);}} appearance={appearance} onChange={setAppearance} storageError={storageError} onClose={() => setSettingsOpen(false)}/>}
    {backupAction && <VaultBackupDialog action={backupAction} vaultName={vault?.name} onClose={() => setBackupAction(null)} onExport={() => workspace.exportVault()} onImport={(file,name) => workspace.importVault(file,name)}/>}
    {vaultDeletionOpen&&vault&&<DeleteVaultDialog key={vault.id} vault={vault} onPreview={()=>workspace.previewVaultDeletion(vault.id)} onExport={()=>workspace.exportVault()} onClose={()=>setVaultDeletionOpen(false)} onDelete={async confirmation=>{
      const name=vault.name,result=await workspace.deleteVault(vault.id,confirmation);
      setVaultNotice('Vault “'+name+'” deleted.'+(result.cleanupPending?' Local attachment cleanup is queued and will retry.':''));
    }}/>}
    {!error&&vaultNotice&&<div id="toast" role="status">{vaultNotice}<button className="toast-close" aria-label="Dismiss notification" onClick={()=>setVaultNotice('')}>×</button></div>}
    {vaultAction && <VaultDialog onImport={() => { setVaultAction(null); setBackupAction('import'); }} action={vaultAction} onClose={() => setVaultAction(null)} onSubmit={value => vaultAction === 'create' ? workspace.createVault(value) : vaultAction === 'lock' ? workspace.lock(value) : workspace.unlock(value)}/>}
    {!error&&!vaultNotice&&insertNotice&&vault&&!vault.locked&&<div id="toast" className="entity-insert-notice" role="status"><span>Created “{insertNotice.name}”.</span><button type="button" className="toast-action" onClick={()=>{openEntity(insertNotice.entityId);setInsertNotice(null);}}>View</button><button type="button" className="toast-close" aria-label="Dismiss notification" onMouseDown={event=>event.preventDefault()} onClick={()=>setInsertNotice(null)}>×</button></div>}
    {error && <div id="toast" role="alert">{error}<button className="toast-close" aria-label="Dismiss error" onClick={workspace.dismissError}>×</button></div>}
  </>;
}
