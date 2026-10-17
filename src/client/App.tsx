import { folderBreadcrumbs, pageBreadcrumbs } from './organization/breadcrumbs';
import { inboxPages } from './organization/inbox';
import { AIActivityNotifications } from './intelligence/AIActivityNotifications';
import { SearchPanel } from './search/SearchPanel';
import { startPageDrag } from './organization/page-drag';
import { PageIcon } from './components/PageIcon';
import { PageOrganizationDialog } from './organization/PageOrganizationDialog';
import { IntelligencePanel } from './intelligence/IntelligencePanel';
import { ActionMenu } from './components/ActionMenu';
import { NameDialog } from './components/NameDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { TrashLibrary } from './trash/TrashLibrary';
import type { PageSummary } from '../shared/domain';
import { Select } from './components/Select';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { SettingsDialog } from './settings/SettingsDialog';
import { useAppearance } from './settings/useAppearance';
import { RecentLibrary } from './organization/RecentLibrary';
import { SidebarOrganization } from './organization/SidebarOrganization';
import { CurrentPageScope } from './organization/CurrentPageScope';
import { OrganizationLibrary } from './organization/OrganizationLibrary';
import { Workspace } from './state/workspace';
import { usePageScroll } from './state/use-page-scroll';
import { Icon } from './components/Icon';
import { EntityPreview } from './components/EntityPreview';
import { PageToolbar } from './editor/PageToolbar';
import { PageEditor } from './editor/PageEditor';
import { EntityPanel } from './knowledge/EntityPanel';
import { KnowledgeLibrary } from './knowledge/KnowledgeLibrary';
import { CreateEntityDialog, type CreateEntityRequest } from './knowledge/CreateEntityDialog';
import {DeleteVaultDialog} from './vaults/DeleteVaultDialog';
import { VaultBackupDialog } from './vaults/VaultBackupDialog';
import { VaultDialog, type VaultAction } from './vaults/VaultDialog';
export function App() {
  const [aiOpen,setAiOpen]=useState(() => {
    try { return localStorage.getItem('noema-knowledge-panel-open') === 'true'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('noema-knowledge-panel-open', String(aiOpen)); }
    catch { /* Keep the panel usable when browser storage is unavailable. */ }
  }, [aiOpen]);
  const [searchOpen,setSearchOpen]=useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PageSummary | null>(null);
  const [organizeTarget, setOrganizeTarget] = useState<PageSummary | null>(null);
  const [renameTarget, setRenameTarget] = useState<PageSummary | null>(null);
  const {appearance, setAppearance, storageError} = useAppearance();
  const [workspace] = useState(() => new Workspace());
  usePageScroll(workspace);
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const {vaults, vault, pages, entities, page, view, busy, loadingPageId, reviewing, error, saveStatus, organization, organizationContext, recent, trash} = state;
  const [panelId, setPanelId] = useState<string | null>(null), [create, setCreate] = useState<CreateEntityRequest | null>(null), [vaultAction, setVaultAction] = useState<VaultAction | null>(null);
  const [vaultDeletionOpen,setVaultDeletionOpen]=useState(false),[vaultNotice,setVaultNotice]=useState('');
  const [backupAction,setBackupAction]=useState<'export'|'import'|null>(null);
  const knowledgeVisible = aiOpen && !searchOpen && !panelId;
  const openEntity = (id: string) => { setSearchOpen(false); workspace.recordRecent('entity', id); setPanelId(id); };
  const run = (work: () => Promise<unknown>) => { void work().catch(workspace.report); };
  useEffect(() => { void workspace.init(); return () => { workspace.saver.dispose(); workspace.titler.dispose(); }; }, [workspace]);
  useEffect(()=>{setSearchOpen(false);},[vault?.id,vault?.locked]);
  useEffect(() => { setPanelId(null); setCreate(null); setDeleteTarget(null); setRenameTarget(null); setOrganizeTarget(null); setVaultDeletionOpen(false); }, [vault?.id, vault?.locked]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (workspace.saver.hasPending) { e.preventDefault(); e.returnValue = ''; } };
    const keyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]') && workspace.snapshot().vault && !workspace.snapshot().vault?.locked) { e.preventDefault(); setPanelId(null); setSearchOpen(value=>!value); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void workspace.saver.flush().catch(workspace.report); }
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) setPanelId(null);
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('keydown', keyDown);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', keyDown); };
  }, [workspace]);
  const pageLinksDisabled = busy || reviewing || !vault || vault.locked;
  const disabled = pageLinksDisabled || loadingPageId !== null;
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
      breadcrumbs.push({key: 'view', label, icon, onClick: view === 'organization' ? () => workspace.openOrganization() : undefined});
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
    <aside className="sidebar" data-navigating={loadingPageId !== null}><div className="sidebar-heading"><a className="brand" href="/" aria-label="Noema home"><img className="brand-mark" src="/noema-mark.svg" alt="" width="38" height="38"/><span>noema</span></a>
      <button className="sidebar-new-note" type="button" aria-label="New Note" title="New Note" disabled={disabled || reviewing} onClick={() => { setPanelId(null); setSearchOpen(false); run(() => workspace.newPage()); }}><Icon name="compose"/></button></div>
      <div className="sidebar-scroll-region">
      <nav className="sidebar-group" aria-label="Quick access">
        <button className={'nav '+(searchOpen?'active':'')} disabled={disabled} onClick={()=>{setPanelId(null);setSearchOpen(value=>!value);}} aria-label="Search vault" aria-haspopup="dialog" aria-expanded={searchOpen}><span><Icon name="search"/></span><span>Search</span><kbd>⌘K</kbd></button>
        <button className={'nav ' + (view === 'favourites' ? 'active' : '')} disabled={disabled} aria-label="Favourites" title="Favourites" onClick={() => workspace.showOrganization(true)}><span data-icon="star"><Icon name="star"/></span><span>Favourites</span></button>
        <button className={'nav ' + (view === 'recent' ? 'active' : '')} disabled={disabled} aria-label="Recent items" title="Recent items" onClick={() => workspace.showRecent()}><span data-icon="recent"><Icon name="recent"/></span><span>Recent items</span></button>
      </nav>
      <nav className="sidebar-group" aria-label="Vault library">
        <div className="workspace-label">Workspace</div>
        <button className={'nav ' + (view === 'pages' || view === 'organization' && !organizationContext.collection && !organizationContext.folder ? 'active' : '')} disabled={disabled} aria-label="Library" title="Library" onClick={() => run(() => workspace.showPages())}><span data-icon="page"><Icon name="page"/></span><span>Library</span><kbd>P</kbd></button>
        <button className={'nav ' + (view === 'inbox' ? 'active' : '')} disabled={disabled} aria-label="Inbox" title="Inbox" onClick={() => workspace.showInbox()}><span data-icon="inbox"><Icon name="inbox"/></span><span>Inbox</span><span className="count">{inboxPages(pages, organization).length}</span></button>
        <button className={'nav ' + (view === 'entities' ? 'active' : '')} disabled={disabled} aria-label="Knowledge entities" title="Knowledge entities" onClick={() => workspace.showEntities()}><span data-icon="knowledge"><Icon name="knowledge"/></span><span>Knowledge entities</span><span className="count">{entities.length}</span></button>
      </nav>
      <SidebarOrganization available={!!vault && !vault.locked} onOpenPage={id => run(() => workspace.openPage(id))} pages={pages} onMovePage={(id, collection, folder) => workspace.locatePage(id, collection, folder)} onError={workspace.report} key={vault?.id} vaultId={vault?.id} onChanged={workspace.setOrganization} data={organization} context={organizationContext} active={view === 'organization'} disabled={disabled} onOpen={(collection, folder) => workspace.openOrganization(collection, folder)}/>
      {view === 'pages' && page && vault && !vault.locked && <CurrentPageScope page={page} pages={pages} data={organization} disabled={disabled} onOpenFolder={id => workspace.openOrganization('', id)} renderPage={p => {
        const selected = page?.id === p.id && view === 'pages';
        const favourite = organization.favourites.some(item => item.kind === 'page' && item.item_id === p.id);
        return <div key={p.id} className={'sidebar-item-row ' + (selected ? 'is-selected' : '')}>
          <button draggable={!disabled} onDragStart={event => { if (vault) startPageDrag(event, vault.id, p.id); }} className={'page-link ' + (selected ? 'selected' : '')} aria-current={selected ? 'page' : undefined} aria-busy={loadingPageId === p.id} disabled={pageLinksDisabled} title={p.title || 'Untitled'} onClick={() => run(() => workspace.openPage(p.id))}><span><PageIcon icon={p.icon}/></span><span className="page-link-title">{p.title || 'Untitled'}</span></button>
          <ActionMenu label={'Options for page: ' + (p.title || 'Untitled')} disabled={disabled} actions={[
            {label: 'Open', icon: 'page', onSelect: () => run(() => workspace.openPage(p.id))},
            {label: 'Rename', icon: 'edit', onSelect: () => setRenameTarget(p)},
            {label: 'Organize page…', icon: 'folder', onSelect: () => setOrganizeTarget(p)},
            {label: favourite ? 'Remove from favourites' : 'Add to favourites', icon: 'star', onSelect: () => run(() => workspace.togglePageFavourite(p.id))},
            {label: 'Move to Trash', icon: 'trash', danger: true, onSelect: () => setDeleteTarget(p)},
          ]}/>
        </div>;
      }}/>}
      </div>
      <div className="vault-controls"><label htmlFor="vault-select">VAULT</label><div className="vault-picker"><Select id="vault-select" aria-label="Current vault" value={vault?.id || ''} disabled={busy || !vaults.length} onChange={e => run(() => workspace.selectVault(e.target.value))}>{!vault && <option value="">{busy?'Loading vaults…':vaults.length?'Choose a vault':'No vaults'}</option>}{vaults.map(v => <option key={v.id} value={v.id}>{v.locked ? 'Locked · ' : ''}{v.name}</option>)}</Select><ActionMenu label="Vault options" disabled={busy} actions={[
        {label: 'New vault', icon: 'plus', onSelect: () => setVaultAction('create')},
        {label: 'Import vault…', icon: 'upload', disabled: reviewing, onSelect: () => setBackupAction('import')},
        {label: 'Export vault backup…', icon: 'download', disabled: !vault || vault.locked || reviewing, onSelect: () => setBackupAction('export')},
        {label: vault?.locked ? 'Unlock vault' : 'Lock vault', icon: 'vault', disabled: !vault, onSelect: () => { if (vault?.locked) setVaultAction('unlock'); else if (vault?.protected) run(() => workspace.lock()); else setVaultAction('lock'); }},
        {label: 'Trash', icon: 'trash', disabled, onSelect: () => { setPanelId(null); run(() => workspace.showTrash()); }},
        {label: 'Settings', icon: 'settings', onSelect: () => setSettingsOpen(true)},
        {label: vault?.locked?'Delete vault… (unlock first)':'Delete vault…',icon:'trash',danger:true,disabled:!vault||vault.locked||reviewing,onSelect:()=>setVaultDeletionOpen(true)},
      ]}/></div></div>
    </aside>
    <main><header className="topbar"><nav id="breadcrumb" className="breadcrumbs" aria-label="Breadcrumb">{breadcrumbs.map((crumb, index) => <span key={crumb.key}>{index > 0 && <Icon name="chevron"/>}{crumb.onClick ? <button onClick={crumb.onClick} disabled={busy || reviewing} aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.icon && <Icon name={crumb.icon}/>}<span>{crumb.label}</span></button> : <span className="breadcrumb-label" aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{crumb.icon && <Icon name={crumb.icon}/>}<span>{crumb.label}</span></span>}</span>)}</nav><div className="top-actions">{view === 'pages' && page && vault && !busy && !vault.locked && <PageToolbar inactive={loadingPageId !== null} focusedReading={appearance.focusedReading} onToggleFocusedReading={() => setAppearance(current => ({...current, focusedReading: !current.focusedReading}))} aiOpen={knowledgeVisible} onAI={()=>{setSearchOpen(false);setPanelId(null);setAiOpen(!knowledgeVisible);}} favourite={organization.favourites.some(item => item.kind === 'page' && item.item_id === page.id)} onOrganizationChange={data => { if (workspace.snapshot().vault?.id === vault.id) workspace.setOrganization(data); }} onDelete={() => setDeleteTarget(page)} key={vault.id + '/' + page.id} page={page} onError={workspace.report}/>}{view!=='pages'&&saveStatus!=='saved'&&!vault?.locked&&<button className={'save-state-indicator '+(saveStatus==='error'?'is-error':'')} aria-label={status} disabled={disabled} onClick={()=>run(()=>workspace.saver.flush())}><Icon name={saveStatus==='error'?'alert':'save'}/><span role="status">{status}</span></button>}<AIActivityNotifications key={vaults.map(item=>item.id+':'+item.locked).join(',')} refreshKey={saveStatus+':'+(page?.revision??'')} onOpenPage={async(vaultId,pageId)=>{if(workspace.snapshot().vault?.id!==vaultId)await workspace.selectVault(vaultId);await workspace.openPage(pageId);}}/></div></header>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{loadingPageId !== null ? `Opening ${pages.find(item=>item.id===loadingPageId)?.title || 'note'}…` : ''}</div>
      <div id="content" inert={busy||reviewing||loadingPageId !== null} aria-busy={busy||reviewing||loadingPageId !== null}>
        {busy && view !== 'trash' ? <p className="loading-state" role="status">Loading workspace…</p> : !vault ? <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1>{vaults.length?'Choose a vault':'No vaults yet'}</h1><p>{vaults.length?'Choose a vault from the sidebar, or create or import one.':'Create a vault or import a backup whenever you’re ready.'}</p><div className="empty-vault-actions"><button type="button" className="button primary" onClick={()=>setVaultAction('create')}>Create a vault</button><button type="button" className="button" onClick={()=>setBackupAction('import')}>Import backup</button></div></section> : vault?.locked ? <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1>{vault.name}</h1><button className="button primary" onClick={() => setVaultAction('unlock')}>Unlock vault</button></section> : vault && view === 'trash' ? <TrashLibrary notes={trash} onRestore={id => workspace.restorePage(id)} onDelete={id => workspace.permanentlyDeletePage(id)} onRefresh={workspace.refreshTrash} onError={workspace.report}/> : vault && view === 'recent' ? <RecentLibrary recent={recent} pages={pages} entities={entities} onOpenPage={id => run(() => workspace.openPage(id))} onOpenEntity={openEntity}/> : vault && (view === 'organization' || view === 'favourites' || view === 'inbox') ? <OrganizationLibrary onOpenFolder={id => workspace.openOrganization('', id)} onNewNote={() => { setPanelId(null); setSearchOpen(false); run(() => workspace.newPage()); }} inboxOnly={view === 'inbox'} onRenamePage={setRenameTarget} onDeletePage={setDeleteTarget} data={organization} key={vault.id + view} vaultId={vault.id} pages={pages} entities={entities} favouritesOnly={view === 'favourites'} context={organizationContext} onContextChange={workspace.setOrganizationContext} onChanged={workspace.setOrganization} onOpenPage={id => run(() => workspace.openPage(id))} onOpenEntity={openEntity} onError={workspace.report}/> : vault && view === 'entities' ? <KnowledgeLibrary onCreate={() => setCreate({})} vaultId={vault.id} key={vault.id} entities={entities} onOpen={openEntity}/> : vault && page ? <PageEditor pages={pages} onOpenPage={id=>run(()=>workspace.openPage(id))} onAddAlias={workspace.addEntityAlias} saveStatus={saveStatus} onIdentify={workspace.identifyEntities} key={page.id} page={page} entities={entities} onChange={patch => workspace.updatePage(patch)} onOpenEntity={openEntity} onCreateEntity={setCreate} onSave={() => run(() => workspace.saver.flush())}/> : <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1>Your space to think</h1><button className="button primary" disabled={!vault} onClick={() => run(() => workspace.newPage())}>Create your first page</button></section>}
      </div>
    </main>
    {knowledgeVisible && view==='pages' && page && vault && !vault.locked && !busy && <IntelligencePanel pages={pages} onOpenPage={id=>run(()=>workspace.openPage(id))} inactive={loadingPageId !== null} onReview={(scanId,id,decision,edits)=>workspace.reviewEntity(scanId,id,decision,edits)} onSourcesChange={sourceIds => workspace.updatePage({sourceIds})} onCreateEntity={setCreate} entities={entities} onOpenEntity={openEntity} key={vault.id} page={page} onClose={()=>setAiOpen(false)} onSettings={()=>setSettingsOpen(true)} onFlush={async()=>{await workspace.saver.flush();return workspace.snapshot().page;}}/>}
    {searchOpen && vault && !vault.locked && !busy && <SearchPanel key={vault.id} vaultId={vault.id} pages={pages} entities={entities} onOpenPage={id=>{setSearchOpen(false);run(()=>workspace.openPage(id));}} onOpenEntity={openEntity} onClose={()=>setSearchOpen(false)}/>}
    {panelId && vault && !vault.locked && !busy && <EntityPanel key={vault.id + '/' + panelId} vaultId={vault.id} id={panelId} entities={entities} onOpen={openEntity} onClose={() => setPanelId(null)} onUpdated={() => workspace.refreshEntities()} onError={workspace.report}/>}
    {vault && !vault.locked && !busy && !reviewing && !settingsOpen && !create && <EntityPreview key={[vault.id, view, page?.id, panelId].join('/')} entities={entities} onOpen={openEntity}/>}
    {create && vault && <CreateEntityDialog vaultId={vault.id} initial={create} onClose={() => setCreate(null)} onSubmit={async input => {
      const result = await workspace.createEntity(input);
      if (create.source && workspace.snapshot().page) workspace.updatePage({sourceIds: [...new Set([...workspace.snapshot().page!.sourceIds, result.id])]});
      create.onCreated?.(result.id); openEntity(result.id);
    }}/>}
    {organizeTarget && vault && !vault.locked && <PageOrganizationDialog key={vault.id + organizeTarget.id} page={organizeTarget} data={organization} onMove={(collection, folder, remove) => workspace.locatePage(organizeTarget.id, collection, folder, remove)} onClose={() => setOrganizeTarget(null)}/>}
    {renameTarget && <NameDialog maxLength={500} title="Rename page" value={renameTarget.title} onSave={name => workspace.renamePage(renameTarget.id,name)} onClose={() => setRenameTarget(null)}/>}
    {deleteTarget && <ConfirmDialog title="Move note to Trash?" description={`“${deleteTarget.title || 'Untitled'}” will be kept in Trash for 30 days. You can restore it until then.`} action="Move to Trash" onConfirm={() => workspace.deletePage(deleteTarget.id)} onClose={() => setDeleteTarget(null)}/>}
    {settingsOpen && <SettingsDialog vault={vault} onOpenPage={async(vaultId,pageId)=>{if(vault?.id!==vaultId)await workspace.selectVault(vaultId);await workspace.openPage(pageId);setSettingsOpen(false);}} appearance={appearance} onChange={setAppearance} storageError={storageError} onClose={() => setSettingsOpen(false)}/>}
    {backupAction && <VaultBackupDialog action={backupAction} vaultName={vault?.name} onClose={() => setBackupAction(null)} onExport={() => workspace.exportVault()} onImport={(file,name) => workspace.importVault(file,name)}/>}
    {vaultDeletionOpen&&vault&&<DeleteVaultDialog key={vault.id} vault={vault} onPreview={()=>workspace.previewVaultDeletion(vault.id)} onExport={()=>workspace.exportVault()} onClose={()=>setVaultDeletionOpen(false)} onDelete={async confirmation=>{
      const name=vault.name,result=await workspace.deleteVault(vault.id,confirmation);
      setVaultNotice('Vault “'+name+'” deleted.'+(result.cleanupPending?' Local attachment cleanup is queued and will retry.':''));
    }}/>}
    {!error&&vaultNotice&&<div id="toast" role="status">{vaultNotice}<button className="toast-close" aria-label="Dismiss notification" onClick={()=>setVaultNotice('')}>×</button></div>}
    {vaultAction && <VaultDialog onImport={() => { setVaultAction(null); setBackupAction('import'); }} action={vaultAction} onClose={() => setVaultAction(null)} onSubmit={value => vaultAction === 'create' ? workspace.createVault(value) : vaultAction === 'lock' ? workspace.lock(value) : workspace.unlock(value)}/>}
    {error && <div id="toast" role="alert">{error}<button className="toast-close" aria-label="Dismiss error" onClick={workspace.dismissError}>×</button></div>}
  </>;
}
