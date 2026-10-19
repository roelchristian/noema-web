import {t as uiText} from './i18n';
import {useInterfaceLanguage} from './i18n';
import {SourceReader} from './sources/SourceReader';
import {SourcePassageDialog} from './sources/SourcePassageDialog';
import {randomUUID} from '../shared/uuid';
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
  useInterfaceLanguage();
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
  const [deleteTarget, setDeleteTarget] = useState<Pick<PageSummary,'id'|'title'> | null>(null);
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
  const activeSource = view === 'source' ? entities.find(entity=>entity.id===state.sourceId&&entity.type==='source') : undefined;
  const [sourceInspectorOpen,setSourceInspectorOpen]=useState(!mobile);
  const [passageAction,setPassageAction]=useState<{reference:SourceReference;annotate:boolean;destinationId?:string}|null>(null);
  const inspectorToggle=useRef<HTMLButtonElement>(null);
  const [inspectorTab,setInspectorTab]=useState<'overview'|'connections'|'edit'>('overview');
  const [activeAttachment,setActiveAttachment]=useState<{key:string;id:string}|null>(null);
  const [sourceRefresh,setSourceRefresh]=useState(0);
  const sourceKey=JSON.stringify([vault?.id,activeSource?.id]);
  const activeAttachmentChanged=useCallback((id:string)=>setActiveAttachment(current=>current?.key===sourceKey&&current.id===id?current:{key:sourceKey,id}),[sourceKey]);
  const closeInspector=useCallback(()=>{
    workspace.closeEntity();setSourceInspectorOpen(false);
    inspectorToggle.current?.focus({preventScroll:true});
  },[workspace]);
  useEffect(()=>{setPassageAction(null);},[vault?.id,vault?.locked]);
  const panelId = state.entityPanelId ?? (activeSource&&sourceInspectorOpen ? activeSource.id : null);
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
  const openEntity = (id: string) => { sourceTrigger.current=null;setSourceReference(null); setSearchOpen(false); if(workspace.snapshot().entities.some(entity=>entity.id===id&&entity.type==='source')) {void workspace.openSource(id).catch(workspace.report);} else workspace.openEntity(id); };
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
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) {if(document.getElementById('entity-panel'))closeInspector();else workspace.closeEntity();setSourceReference(null);if(sourceTrigger.current?.isConnected)sourceTrigger.current.focus({preventScroll:true});sourceTrigger.current=null;}
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('keydown', keyDown);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', keyDown); };
  }, [workspace,closeInspector]);
  const pageLinksDisabled = busy || reviewing || !vault || vault.locked;
  const disabled = pageLinksDisabled || loadingPageId !== null;
  const pageStatus = page ? workspace.pageSaveStatus(page.vault_id,page.id) : saveStatus;
  const activeRecovery = page && draftRecoveries.find(item=>item.vaultId===page.vault_id&&item.pageId===page.id);
  const vaultSaveFailures = saveFailures.filter(issue=>issue.vaultId===vault?.id);
  const vaultStorageFailures = draftStorageFailures.filter(issue=>issue.vaultId===vault?.id);
  const status = vault?.locked ? 'Vault locked' : {saved: 'All changes saved', pending: 'Unsaved changes', identifying: 'Identifying entities…', saving: 'Saving…', error: 'Save failed · click to retry'}[saveStatus];
  const breadcrumbs: {key: string; label: string; icon?: string; onClick?: () => void}[] = [
    {key: 'vault', label: vault?.name || uiText("Noema"), icon: 'vault'},
  ];
  if (vault && !vault.locked) {
    if (view === 'source') {
      breadcrumbs.push({key:'sources',get label(){return uiText("Sources")},icon:'source',onClick:()=>{setKnowledgeBrowser({entityType:'source'});workspace.showEntities();}});
      breadcrumbs.push({key:'source:'+state.sourceId,label:activeSource?.name??uiText("Source"),icon:'source'});
    } else if (view === 'pages') {
      for (const crumb of pageBreadcrumbs(organization, page)) {
        const target = crumb.target;
        breadcrumbs.push({...crumb, onClick: target ? () => workspace.openOrganization(target.collection, target.folder) : undefined});
      }
    } else {
      const label = view==='entities'&&knowledgeType==='source'?'Sources':view === 'inbox' ? 'Inbox' : view === 'trash' ? 'Trash' : view === 'entities' ? 'Knowledge entities' : view === 'organization' ? 'Pages' : view === 'favourites' ? 'Favourites' : 'Recent items';
      const icon = view==='entities'&&knowledgeType==='source'?'source':view === 'inbox' ? 'inbox' : view === 'trash' ? 'trash' : view === 'entities' ? 'knowledge' : view === 'organization' ? 'pages' : view === 'favourites' ? 'star' : 'recent';
      breadcrumbs.push({key: 'view', label, icon, onClick: view === 'organization' ? () => workspace.openOrganization() : view === 'entities' && knowledgeType && knowledgeType!=='source' ? () => {captureLibraryView(); setKnowledgeBrowser({entityType: ''});} : undefined});
      if (view === 'entities' && knowledgeType && knowledgeType!=='source') {
        breadcrumbs.push({key: 'entity-type:' + knowledgeType, label: uiText(entityLabels[knowledgeType]), icon: knowledgeType});
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
    <aside className="sidebar" onClickCapture={animateSidebarClick} data-navigating={loadingPageId !== null}><div className="sidebar-heading"><a className="brand" href="/" aria-label={uiText("Noema home")}><img className="brand-mark" src="/noema-mark.svg" alt="" width="38" height="38"/><span>noema</span></a>
      <button className="mobile-navigation-close" type="button" aria-label={uiText("Close navigation")} onClick={() => setNavigationOpen(false)}><Icon name="close"/></button>
      <button className="sidebar-new-note" type="button" aria-label={uiText("New Note")} title={uiText("New Note")} disabled={disabled || reviewing} onClick={() => { workspace.closeEntity(); setSearchOpen(false); run(() => workspace.newPage()); }}><Icon name="compose"/></button></div>
      <div className="sidebar-scroll-region">
      <nav className="sidebar-group" aria-label={uiText("Quick access")}>
        <button data-navigation-search className={'nav '+(searchOpen?'active':'')} disabled={disabled} onClick={()=>{workspace.closeEntity();setSearchOpen(value=>!value);}} aria-label={uiText("Search vault")} aria-haspopup="dialog" aria-expanded={searchOpen}><span><Icon name="search"/></span><span>{uiText("Search")}</span><kbd>⌘K</kbd></button>
        <button className={'nav ' + (view === 'favourites' ? 'active' : '')} disabled={disabled} aria-label={uiText("Favourites")} title={uiText("Favourites")} onClick={() => workspace.showOrganization(true)}><span data-icon="star"><Icon name="star"/></span><span>{uiText("Favourites")}</span></button>
        <button className={'nav ' + (view === 'recent' ? 'active' : '')} disabled={disabled} aria-label={uiText("Recent items")} title={uiText("Recent items")} onClick={() => workspace.showRecent()}><span data-icon="recent"><Icon name="recent"/></span><span>{uiText("Recent items")}</span></button>
      </nav>
      <nav className="sidebar-group" aria-label={uiText("Vault library")}>
        <div className="workspace-label">{uiText("Workspace")}</div>
        <button className={'nav ' + (view === 'pages' || view === 'organization' && !organizationContext.collection && !organizationContext.folder ? 'active' : '')} disabled={disabled} aria-label={uiText("Pages")} title={uiText("Pages")} onClick={() => run(() => workspace.showPages())}><span data-icon="pages"><Icon name="pages"/></span><span>{uiText("Pages")}</span><kbd>P</kbd></button>
        <button className={'nav ' + (view === 'inbox' ? 'active' : '')} disabled={disabled} aria-label={uiText("Inbox")} title={uiText("Inbox")} onClick={() => workspace.showInbox()}><span data-icon="inbox"><Icon name="inbox"/></span><span>{uiText("Inbox")}</span><span className="count">{inboxPages(pages, organization).length}</span></button>
        <button className={'nav ' + (view === 'source' || view === 'entities' && knowledgeType === 'source' ? 'active' : '')} disabled={disabled} aria-label={uiText("Sources")} title={uiText("Sources")} onClick={() => {captureLibraryView();setKnowledgeBrowser({entityType:'source'});workspace.showEntities();}}><span data-icon="source"><Icon name="source"/></span><span>{uiText("Sources")}</span><span className="count">{entities.filter(entity=>entity.type==='source').length}</span></button>
        <button className={'nav ' + (view === 'entities' && knowledgeType !== 'source' ? 'active' : '')} disabled={disabled} aria-label={uiText("Knowledge entities")} title={uiText("Knowledge entities")} onClick={() => {if(knowledgeType==='source'){captureLibraryView();setKnowledgeBrowser({entityType:''});}workspace.showEntities();}}><span data-icon="knowledge"><Icon name="knowledge"/></span><span>{uiText("Knowledge entities")}</span><span className="count">{entities.filter(entity=>entity.type!=='source').length}</span></button>
      </nav>
      <SidebarOrganization activePageId={activePageId} activeFolderPath={activeFolderPath} revealPageId={revealPageId} onRevealed={onRevealed} available={!!vault && !vault.locked} onOpenPage={id => run(() => workspace.openPage(id))} pages={pages} onMovePage={(id, collection, folder) => workspace.locatePage(id, collection, folder)} onError={workspace.report} key={vault?.id} vaultId={vault?.id} onChanged={workspace.setOrganization} data={organization} context={organizationContext} active={view === 'organization'} disabled={disabled} onOpen={(collection, folder) => workspace.openOrganization(collection, folder)}/>
      </div>
      <div id="page-section-guide"/>
      <div className="vault-controls"><label htmlFor="vault-select">{uiText("VAULT")}</label><div className="vault-picker"><Select id="vault-select" aria-label={uiText("Current vault")} value={vault?.id || ''} disabled={busy || !vaults.length} onChange={e => run(() => workspace.selectVault(e.target.value))}>{!vault && <option value="">{busy?uiText("Loading vaults…"):vaults.length?uiText("Choose a vault"):uiText("No vaults")}</option>}{vaults.map(v => <option key={v.id} value={v.id}>{v.locked ? uiText("Locked · ") : ''}{v.name}</option>)}</Select><ActionMenu label={uiText("Vault options")} disabled={busy} actions={[
        {get label(){return uiText("New vault")}, icon: 'plus', onSelect: () => setVaultAction('create')},
        {label: uiText("Import vault…"), icon: 'upload', disabled: reviewing, onSelect: () => setBackupAction('import')},
        {get label(){return uiText("Export vault backup…")}, icon: 'download', disabled: !vault || vault.locked || reviewing, onSelect: () => setBackupAction('export')},
        {label: vault?.locked ? uiText("Unlock vault") : uiText("Lock vault"), icon: 'vault', disabled: !vault, onSelect: () => { if (vault?.locked) setVaultAction('unlock'); else if (vault?.protected) run(() => workspace.lock()); else setVaultAction('lock'); }},
        {get label(){return uiText("Trash")}, icon: 'trash', disabled, onSelect: () => { workspace.closeEntity(); run(() => workspace.showTrash()); }},
        {get label(){return uiText("Settings")}, icon: 'settings', onSelect: () => setSettingsOpen(true)},
        {label: vault?.locked?uiText("Delete vault… (unlock first)"):uiText("Delete vault…"),icon:'trash',danger:true,disabled:!vault||vault.locked||reviewing,onSelect:()=>setVaultDeletionOpen(true)},
      ]}/></div></div>
    </aside>
    </WorkspaceNavigation>
    <main className={activeSource?'source-workspace':undefined}><header className="topbar"><button type="button" className="mobile-navigation-toggle" aria-label={uiText("Open navigation")} aria-haspopup="dialog" aria-controls="workspace-navigation" aria-expanded={mobile && navigationOpen} onClick={() => setNavigationOpen(true)}><Icon name="menu"/></button><nav className="workspace-history" aria-label={uiText("Navigation history")}>
      <button type="button" className="history-back" aria-label={uiText("Go back")} title={uiText("Go back")} disabled={disabled || !state.canGoBack} onClick={() => { setSearchOpen(false); run(() => workspace.goHistory(-1)); }}><Icon name="chevron"/></button>
      <button type="button" aria-label={uiText("Go forward")} title={uiText("Go forward")} disabled={disabled || !state.canGoForward} onClick={() => { setSearchOpen(false); run(() => workspace.goHistory(1)); }}><Icon name="chevron"/></button>
    </nav><nav id="breadcrumb" className="breadcrumbs" aria-label={uiText("Breadcrumb")}>{breadcrumbs.map((crumb, index) => <span key={crumb.key}>{index > 0 && <Icon name="chevron"/>}{crumb.onClick ? <button onClick={crumb.onClick} disabled={busy || reviewing} aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.icon && <Icon name={crumb.icon}/>}<span>{crumb.key.startsWith('page:')?<TitleText text={crumb.label}/>:crumb.label}</span></button> : <span className="breadcrumb-label" aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.icon && <Icon name={crumb.icon}/>}<span>{crumb.key.startsWith('page:')?<TitleText text={crumb.label}/>:crumb.label}</span></span>}</span>)}</nav><div className="top-actions">{activeSource&&<button type="button" ref={inspectorToggle} className="source-inspector-toggle" aria-controls="entity-panel" aria-label={uiText("Source inspector")} title={uiText("Source inspector")} aria-expanded={!!panelId} onClick={()=>{if(panelId)closeInspector();else setSourceInspectorOpen(true);}}><Icon name="knowledge"/></button>}{view === 'pages' && page && vault && !busy && !vault.locked && <PageToolbar tocAvailable={headings.length>0} tocVisible={tocVisible} onToggleToc={()=>setTocVisible(value=>!value)} onRevealInSidebar={() => { setNavigationOpen(true); setRevealPageId(page.id); }} onEditLockChange={(locked,password)=>workspace.setPageEditLock(locked,password)} onUndo={editingHistory.undo} onRedo={editingHistory.redo} canUndo={editingHistory.canUndo} canRedo={editingHistory.canRedo} onFeaturedImageChange={featuredImageId => editingHistory.change({featuredImageId})} onChangeBlocks={blocks => editingHistory.change({blocks})} onForward={mobile ? () => { setSearchOpen(false); run(() => workspace.goHistory(1)); } : undefined} forwardDisabled={disabled || !state.canGoForward} inactive={loadingPageId !== null} focusedReading={appearance.focusedReading} onToggleFocusedReading={() => setAppearance(current => ({...current, focusedReading: !current.focusedReading}))} aiOpen={knowledgeVisible} onAI={()=>{setSourceReference(null);setSearchOpen(false);workspace.closeEntity();setAiOpen(!knowledgeVisible);}} favourite={organization.favourites.some(item => item.kind === 'page' && item.item_id === page.id)} onOrganizationChange={data => { if (workspace.snapshot().vault?.id === vault.id) workspace.setOrganization(data); }} onDelete={() => workspace.deletePage(page.id)} key={vault.id + '/' + page.id} page={page} onError={workspace.report}/>}{view!=='pages'&&saveStatus!=='saved'&&!vault?.locked&&<button className={'save-state-indicator '+(saveStatus==='error'?'is-error':'')} aria-label={status} disabled={disabled} onClick={()=>run(()=>workspace.saver.flush())}><Icon name={saveStatus==='error'?'alert':'save'}/><span role="status">{status}</span></button>}<AIActivityNotifications onSourceUpdates={async()=>{if(workspace.snapshot().vault&&!workspace.snapshot().vault?.locked)await workspace.refreshEntities();}} onOpenEntity={async(vaultId,entityId)=>{if(workspace.snapshot().vault?.id!==vaultId)await workspace.selectVault(vaultId);await workspace.refreshEntities();openEntity(entityId);}} key={vaults.map(item=>item.id+':'+item.locked).join(',')} refreshKey={saveStatus+':'+(page?.revision??'')} onOpenPage={async(vaultId,pageId)=>{if(workspace.snapshot().vault?.id!==vaultId)await workspace.selectVault(vaultId);await workspace.openPage(pageId);}}/></div>{vault&&!vault.locked&&!busy&&(vaultSaveFailures.length>0||vaultStorageFailures.length>0||activeRecovery)&&<div className="page-persistence-notices" aria-label={uiText("Unfinished work")}>
      {vaultSaveFailures.map(issue=><div className="page-persistence-notice is-error" key={issue.pageId} role="alert"><span>{uiText("Couldn’t save “")}{issue.title||uiText("Untitled")}”. <small>{issue.message}</small></span>{page?.id!==issue.pageId&&<button type="button" disabled={disabled} onClick={()=>run(()=>workspace.openPage(issue.pageId))}>{uiText("Open page")}</button>}<button type="button" disabled={disabled} onClick={()=>run(()=>workspace.retryPageSave(issue.vaultId,issue.pageId))}>{uiText("Retry")}</button></div>)}
      {vaultStorageFailures.map(issue=><div className="page-persistence-notice is-error" key={'storage-'+issue.pageId} role="alert"><span>“{issue.title||uiText("Untitled")}{uiText("” has no recoverable browser copy. Keep this tab open until it saves.") + " "}<small>{issue.message}</small></span><button type="button" disabled={disabled} onClick={()=>run(()=>workspace.retryPageSave(issue.vaultId,issue.pageId))}>{uiText("Retry")}</button></div>)}
      {activeRecovery&&page&&<PageDraftRecoveryNotice key={activeRecovery.vaultId+'/'+activeRecovery.pageId} recovery={activeRecovery} page={page} entities={entities} pages={pages} onRestore={entry=>workspace.restorePageDraft(entry)} onDiscard={()=>workspace.discardPageDrafts(activeRecovery.vaultId,activeRecovery.pageId)}/>}
    </div>}</header>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{loadingPageId !== null ? uiText("Opening {value0}…",{value0: pages.find(item=>item.id===loadingPageId)?.title || 'note'}) : ''}</div>
      <div id="content" inert={busy||reviewing||loadingPageId !== null} aria-busy={busy||reviewing||loadingPageId !== null}>
        {busy && view !== 'trash' ? <p className="loading-state" role="status">{uiText("Loading workspace…")}</p> : !vault ? <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1 className="page-heading">{vaults.length?uiText("Choose a vault"):uiText("No vaults yet")}</h1><p>{vaults.length?uiText("Choose a vault from the sidebar, or create or import one."):uiText("Create a vault or import a backup whenever you’re ready.")}</p><div className="empty-vault-actions"><button type="button" className="button primary" onClick={()=>setVaultAction('create')}>{uiText("Create a vault")}</button><button type="button" className="button" onClick={()=>setBackupAction('import')}>{uiText("Import backup")}</button></div></section> : vault?.locked ? <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1 className="page-heading">{vault.name}</h1><button className="button primary" onClick={() => setVaultAction('unlock')}>{uiText("Unlock vault")}</button></section> : vault && view === 'trash' ? <TrashLibrary vaultId={vault.id} notes={trash} onRestore={id => workspace.restorePage(id)} onDelete={id => workspace.permanentlyDeletePage(id)} onRefresh={workspace.refreshTrash} onError={workspace.report}/> : vault && view === 'recent' ? <RecentLibrary vaultId={vault.id} recent={recent} pages={pages} entities={entities} onOpenPage={id => run(() => workspace.openPage(id))} onOpenEntity={openEntity}/> : vault && (view === 'organization' || view === 'favourites' || view === 'inbox') ? <OrganizationLibrary onOpenPassage={openSourceReference} onOpenFolder={id => workspace.openOrganization('', id)} onNewNote={() => { workspace.closeEntity(); setSearchOpen(false); run(() => workspace.newPage()); }} inboxOnly={view === 'inbox'} onRenamePage={setRenameTarget} onDeletePage={setDeleteTarget} data={organization} key={vault.id + view} vaultId={vault.id} pages={pages} entities={entities} favouritesOnly={view === 'favourites'} context={organizationContext} onContextChange={workspace.setOrganizationContext} onChanged={workspace.setOrganization} onOpenPage={(id,reference) => run(() => openIndexedPage(id,reference))} onOpenEntity={openEntity} onError={workspace.report}/> : vault && view === 'entities' ? <KnowledgeLibrary onUpdated={workspace.refreshEntities} onOpenPassage={openSourceReference} onCreatePageFromSource={beginSourcePage} onCreate={() => setCreate(knowledgeType==='source'?{source:true}:{excludeSources:true})} vaultId={vault.id} key={vault.id} entities={entities} onOpen={openEntity}/> : vault && activeSource ? <SourceReader refreshKey={sourceRefresh} onActiveAttachmentChange={activeAttachmentChanged} inspectorOpen={!!panelId} onRemoveReadingNote={note=>setDeleteTarget({id:note.pageId,title:note.title})} onOpenReadingNote={id=>run(()=>workspace.openPage(id))} onReadingNoteCreated={page=>workspace.registerGeneratedPage(page)} key={vault.id+'/'+activeSource.id} vaultId={vault.id} source={activeSource} entities={entities} onOpenEntity={openEntity} onCreatePageFromSource={beginSourcePage} onError={workspace.report} onAddPassage={reference=>setPassageAction({reference,annotate:false})} onAnnotate={reference=>setPassageAction({reference,annotate:true})}/> : vault && view === 'pages' && page ? <PageEditor tocVisible={tocVisible} headings={headings} subjectsSaving={state.domainSavingPageId===page.id} citationStyle={appearance.citationStyle} pages={pages} onOpenPage={id=>run(()=>workspace.openPage(id))} onAddAlias={workspace.addEntityAlias} saveStatus={pageStatus} onIdentify={workspace.identifyEntities} key={page.id} page={page} entities={entities} onChange={editingHistory.change} onOpenEntity={openEntity} onCreateEntity={setCreate} onSave={() => run(() => workspace.saver.flush())}/> : <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1 className="page-heading">{uiText("Your space to think")}</h1><button className="button primary" disabled={!vault} onClick={() => run(() => workspace.newPage())}>{uiText("Create your first page")}</button></section>}
      </div>
    </main>
    {knowledgeVisible && view==='pages' && page && vault && !vault.locked && !busy && <IntelligencePanel onDomainsChange={(primary,secondary)=>workspace.setPageDomains(primary,secondary)} pages={pages} onOpenPage={id=>run(()=>workspace.openPage(id))} inactive={loadingPageId !== null} onReview={(scanId,id,decision,edits)=>workspace.reviewEntity(scanId,id,decision,edits)} onSourcesChange={sourceIds => workspace.updatePage({sourceIds})} onCreateEntity={setCreate} entities={entities} onOpenEntity={openEntity} key={vault.id} page={page} onClose={()=>setAiOpen(false)} onSettings={()=>setSettingsOpen(true)} onFlush={async()=>{await workspace.saver.flush();return workspace.snapshot().page;}}/>}
    {searchOpen && vault && !vault.locked && !busy && <SearchPanel onOpenPassage={openSourceReference} key={vault.id} vaultId={vault.id} pages={pages} entities={entities} onOpenPage={(id,reference)=>run(()=>openIndexedPage(id,reference))} onOpenEntity={openEntity} onClose={()=>setSearchOpen(false)}/>}
    {panelId && !searchOpen && !sourcePage && !sourceReference && vault && !vault.locked && !busy && <EntityPanel activeAttachmentId={activeAttachment?.key===sourceKey?activeAttachment.id:undefined} inspectorTab={inspectorTab} onInspectorTabChange={setInspectorTab} inspector={view==='source'&&panelId===activeSource?.id} onCreatePageFromSource={beginSourcePage} onOpenPage={id => run(() => workspace.openPage(id))} refreshKey={JSON.stringify([pages.map(page => [page.id, page.title, page.updated_at]),entities.filter(entity=>entity.id===panelId).map(entity=>[entity.updated_at,entity.sourceStatus,entity.sourceEnrichmentStatus])])} key={vault.id + '/' + panelId} vaultId={vault.id} id={panelId} entities={entities} onOpen={openEntity} onClose={closeInspector} onUpdated={async() => {setSourceRefresh(value=>value+1);await workspace.refreshEntities();}} onError={workspace.report}/>}
    {sourceReference && vault && !vault.locked && !busy && <SourceViewer key={vault.id+'/'+sourceReference.id} vaultId={vault.id} reference={sourceReference} entities={entities} onClose={closeSourceReference} onOpenEntity={openEntity}/>}
    {vault && !vault.locked && !busy && !reviewing && !settingsOpen && !create && !sourcePage && !passageAction && <SourceReferencePreview key={[vault.id,view,page?.id].join('/')} entities={entities} onOpen={openSourceReference}/>}
    {vault && !vault.locked && !busy && !reviewing && !settingsOpen && !create && !sourcePage && !passageAction && <EntityPreview key={[vault.id, view, page?.id, panelId].join('/')} entities={entities} onOpen={openEntity}/>}
    {passageAction&&vault&&!vault.locked&&<SourcePassageDialog reference={passageAction.reference} annotate={passageAction.annotate} pages={pages} onClose={()=>setPassageAction(null)} onSave={async(pageId,annotation)=>{
      const vaultId=vault.id,reference=passageAction.reference;
      await workspace.saver.flush();
      const destinationId=passageAction.destinationId??pageId;
      if(destinationId) await workspace.openPage(destinationId); else await workspace.newPage();
      const current=workspace.snapshot(),target=current.page;
      if(current.vault?.id!==vaultId||current.vault.locked||current.view!=='pages'||!target||(destinationId&&target.id!==destinationId))throw new Error('Could not open the destination note.');
      if(target.editLocked)throw new Error('Unlock the destination note before adding a passage.');
      setPassageAction(action=>action?{...action,destinationId:target.id}:null);
      const quoteId='source-passage-'+reference.id;
      if(target.blocks.some(block=>block.id===quoteId)){await workspace.saver.flush();return;}
      const quote={id:quoteId,type:'quote' as const,checked:false,content:[{text:reference.excerpt},{text:' [ref]',sourceReference:{...reference,id:randomUUID()}}]};
      const blocks=[...target.blocks,quote,...(annotation?[{id:randomUUID(),type:'paragraph' as const,checked:false,content:[{text:annotation}]}]:[])];
      workspace.updatePage({blocks,sourceIds:[...new Set([...target.sourceIds,reference.sourceId])],...(!pageId?{title:entities.find(entity=>entity.id===reference.sourceId)?.name??uiText("Source note")}:{})});
      await workspace.saver.flush();
    }}/>}
    {sourcePage&&vault&&!vault.locked&&<CreatePageFromSourceDialog key={vault.id+'/'+sourcePage.id} vaultId={vault.id} source={sourcePage} onClose={()=>setSourcePage(null)} onCreated={page=>workspace.registerGeneratedPage(page)} onOpenPage={async id=>{workspace.closeEntity();await workspace.openPage(id);}} onSettings={()=>{setSourcePage(null);setSettingsOpen(true);}}/>}
    {create && vault && <CreateEntityDialog vaultId={vault.id} initial={create} onClose={() => setCreate(null)} onSubmit={async input => {
      const result = await workspace.createEntity(input);
      if (create.source && workspace.snapshot().view==='pages' && workspace.snapshot().page) workspace.updatePage({sourceIds: [...new Set([...workspace.snapshot().page!.sourceIds, result.id])]});
      if(create.intent==='insert'&&create.onCreated) {
        const current=workspace.snapshot();
        if(current.vault?.id===vault.id&&current.page)setPendingInsert({vaultId:vault.id,pageId:current.page.id,entityId:result.id,name:result.name,insert:create.onCreated});
      }else{create.onCreated?.(result.id);openEntity(result.id);}
    }}/>}
    {renameTarget && <NameDialog maxLength={500} title={uiText("Rename page")} value={renameTarget.title} onSave={name => workspace.renamePage(renameTarget.id,name)} onClose={() => setRenameTarget(null)}/>}
    {deleteTarget && <ConfirmDialog danger title={uiText("Move note to Trash?")} description={`“${deleteTarget.title || 'Untitled'}” will be kept in Trash for 30 days. You can restore it until then.`} action={uiText("Move to Trash")} onConfirm={() => workspace.deletePage(deleteTarget.id)} onClose={() => setDeleteTarget(null)}/>}
    {settingsOpen && <SettingsDialog onOpenPassage={async(vaultId,reference)=>{if(workspace.snapshot().vault?.id!==vaultId)await workspace.selectVault(vaultId);setSettingsOpen(false);openSourceReference(reference);}} onOpenEntity={async(vaultId,entityId)=>{if(vault?.id!==vaultId)await workspace.selectVault(vaultId);await workspace.refreshEntities();openEntity(entityId);setSettingsOpen(false);}} onBeforeNetworkChange={() => workspace.saver.flush()} onChangePassphrase={(current, next) => workspace.setPassphrase(current, next)} vault={vault} onOpenPage={async(vaultId,pageId,reference)=>{if(vault?.id!==vaultId)await workspace.selectVault(vaultId);await openIndexedPage(pageId,reference);}} appearance={appearance} onChange={setAppearance} storageError={storageError} onClose={() => setSettingsOpen(false)}/>}
    {backupAction && <VaultBackupDialog action={backupAction} vaultName={vault?.name} onClose={() => setBackupAction(null)} onExport={() => workspace.exportVault()} onImport={(file,name) => workspace.importVault(file,name)}/>}
    {vaultDeletionOpen&&vault&&<DeleteVaultDialog key={vault.id} vault={vault} onPreview={()=>workspace.previewVaultDeletion(vault.id)} onExport={()=>workspace.exportVault()} onClose={()=>setVaultDeletionOpen(false)} onDelete={async confirmation=>{
      const name=vault.name,result=await workspace.deleteVault(vault.id,confirmation);
      setVaultNotice('Vault “'+name+'” deleted.'+(result.cleanupPending?' Local attachment cleanup is queued and will retry.':''));
    }}/>}
    {!error&&vaultNotice&&<div id="toast" role="status">{vaultNotice}<button className="toast-close" aria-label={uiText("Dismiss notification")} onClick={()=>setVaultNotice('')}>×</button></div>}
    {vaultAction && <VaultDialog onImport={() => { setVaultAction(null); setBackupAction('import'); }} action={vaultAction} onClose={() => setVaultAction(null)} onSubmit={value => vaultAction === 'create' ? workspace.createVault(value) : vaultAction === 'lock' ? workspace.lock(value) : workspace.unlock(value)}/>}
    {!error&&!vaultNotice&&insertNotice&&vault&&!vault.locked&&<div id="toast" className="entity-insert-notice" role="status"><span>{uiText("Created “")}{insertNotice.name}”.</span><button type="button" className="toast-action" onClick={()=>{openEntity(insertNotice.entityId);setInsertNotice(null);}}>{uiText("View")}</button><button type="button" className="toast-close" aria-label={uiText("Dismiss notification")} onMouseDown={event=>event.preventDefault()} onClick={()=>setInsertNotice(null)}>×</button></div>}
    {error && <div id="toast" role="alert">{error}<button className="toast-close" aria-label={uiText("Dismiss error")} onClick={workspace.dismissError}>×</button></div>}
  </>;
}
