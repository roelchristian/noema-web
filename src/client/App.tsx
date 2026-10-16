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
import { OrganizationLibrary } from './organization/OrganizationLibrary';
import { Workspace } from './state/workspace';
import { Icon } from './components/Icon';
import { PageToolbar } from './editor/PageToolbar';
import { PageEditor } from './editor/PageEditor';
import { EntityPanel } from './knowledge/EntityPanel';
import { KnowledgeLibrary } from './knowledge/KnowledgeLibrary';
import { CreateEntityDialog, type CreateEntityRequest } from './knowledge/CreateEntityDialog';
import { VaultDialog, type VaultAction } from './vaults/VaultDialog';
export function App() {
  const [aiOpen,setAiOpen]=useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PageSummary | null>(null);
  const [renameTarget, setRenameTarget] = useState<PageSummary | null>(null);
  const {appearance, setAppearance, storageError} = useAppearance();
  const [workspace] = useState(() => new Workspace());
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const {vaults, vault, pages, entities, page, view, busy, error, saveStatus, organization, organizationContext, recent, trash} = state;
  const [panelId, setPanelId] = useState<string | null>(null), [create, setCreate] = useState<CreateEntityRequest | null>(null), [vaultAction, setVaultAction] = useState<VaultAction | null>(null);
  const openEntity = (id: string) => { setAiOpen(false); workspace.recordRecent('entity', id); setPanelId(id); };
  const run = (work: () => Promise<unknown>) => { void work().catch(workspace.report); };
  useEffect(() => { void workspace.init(); return () => workspace.saver.dispose(); }, [workspace]);
  useEffect(()=>{setAiOpen(false);},[vault?.id,vault?.locked,page?.id,view]);
  useEffect(() => { setPanelId(null); setCreate(null); setDeleteTarget(null); setRenameTarget(null); }, [vault?.id, vault?.locked]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (workspace.saver.hasPending) { e.preventDefault(); e.returnValue = ''; } };
    const keyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void workspace.saver.flush().catch(workspace.report); }
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) setPanelId(null);
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('keydown', keyDown);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', keyDown); };
  }, [workspace]);
  const disabled = busy || !vault || vault.locked;
  const status = vault?.locked ? 'Vault locked' : {saved: 'All changes saved', pending: 'Unsaved changes', saving: 'Saving…', error: 'Save failed · click to retry'}[saveStatus];
  return <>
    <aside className="sidebar"><a className="brand" href="/" aria-label="Noema home"><img className="brand-mark" src="/noema-mark.svg" alt="" width="38" height="38"/><span>noema</span></a>
      <div className="vault-controls"><label htmlFor="vault-select">VAULT</label><div className="vault-picker"><Select id="vault-select" aria-label="Current vault" value={vault?.id || ''} disabled={busy || !vaults.length} onChange={e => run(() => workspace.selectVault(e.target.value))}>{!vault && <option value="">Loading vaults…</option>}{vaults.map(v => <option key={v.id} value={v.id}>{v.locked ? 'Locked · ' : ''}{v.name}</option>)}</Select><ActionMenu label="Vault options" disabled={busy} actions={[
        {label: 'New vault', icon: 'plus', onSelect: () => setVaultAction('create')},
        {label: vault?.locked ? 'Unlock vault' : 'Lock vault', icon: 'vault', disabled: !vault, onSelect: () => { if (vault?.locked) setVaultAction('unlock'); else if (vault?.protected) run(() => workspace.lock()); else setVaultAction('lock'); }},
        {label: 'Settings', icon: 'settings', onSelect: () => setSettingsOpen(true)},
      ]}/></div></div>
      <nav className="sidebar-group" aria-label="Quick access">
        <button className={'nav ' + (view === 'favourites' ? 'active' : '')} disabled={disabled} aria-label="Favourites" title="Favourites" onClick={() => workspace.showOrganization(true)}><span data-icon="star"><Icon name="star"/></span><span>Favourites</span></button>
        <button className={'nav ' + (view === 'recent' ? 'active' : '')} disabled={disabled} aria-label="Recent items" title="Recent items" onClick={() => workspace.showRecent()}><span data-icon="recent"><Icon name="recent"/></span><span>Recent items</span></button>
      </nav>
      <nav className="sidebar-group" aria-label="Vault library">
        <div className="workspace-label">Workspace</div>
        <button className={'nav ' + (view === 'pages' ? 'active' : '')} disabled={disabled} aria-label="Pages" title="Pages" onClick={() => run(() => workspace.showPages())}><span data-icon="page"><Icon name="page"/></span><span>Pages</span><kbd>P</kbd></button>
        <button className={'nav ' + (view === 'entities' ? 'active' : '')} disabled={disabled} aria-label="Knowledge entities" title="Knowledge entities" onClick={() => workspace.showEntities()}><span data-icon="knowledge"><Icon name="knowledge"/></span><span>Knowledge entities</span><span className="count">{entities.length}</span></button>
      </nav>
      <SidebarOrganization key={vault?.id} vaultId={vault?.id} onChanged={workspace.setOrganization} data={organization} context={organizationContext} active={view === 'organization'} disabled={disabled} onOpen={(collection, folder) => workspace.openOrganization(collection, folder)}/>
      <div className="section-label">Pages <button title="New page" aria-label="New page" disabled={disabled} onClick={() => run(() => workspace.newPage())}>+</button></div>
      <nav id="page-list">{pages.map(p => {
        const selected = page?.id === p.id && view === 'pages';
        const favourite = organization.favourites.some(item => item.kind === 'page' && item.item_id === p.id);
        return <div key={p.id} className={'sidebar-item-row ' + (selected ? 'is-selected' : '')}>
          <button className={'page-link ' + (selected ? 'selected' : '')} disabled={disabled} title={p.title || 'Untitled'} onClick={() => run(() => workspace.openPage(p.id))}><span><Icon name="page"/></span><span className="page-link-title">{p.title || 'Untitled'}</span></button>
          <ActionMenu label={'Options for page: ' + (p.title || 'Untitled')} disabled={disabled} actions={[
            {label: 'Open', icon: 'page', onSelect: () => run(() => workspace.openPage(p.id))},
            {label: 'Rename', icon: 'edit', onSelect: () => setRenameTarget(p)},
            {label: favourite ? 'Remove from favourites' : 'Add to favourites', icon: 'star', onSelect: () => run(() => workspace.togglePageFavourite(p.id))},
            {label: 'Move to Trash', icon: 'trash', danger: true, onSelect: () => setDeleteTarget(p)},
          ]}/>
        </div>;
      })}</nav>
      <div className="sidebar-settings"><button className={'nav ' + (view === 'trash' ? 'active' : '')} aria-label="Trash" title="Trash" disabled={disabled} onClick={() => { setPanelId(null); run(() => workspace.showTrash()); }}><span data-icon="trash"><Icon name="trash"/></span><span>Trash</span></button><button className="nav" aria-label="Settings" title="Settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}><span data-icon="settings"><Icon name="settings"/></span><span>Settings</span></button></div>
    </aside>
    <main><header className="topbar"><div id="breadcrumb"><span>{vault?.name || 'Noema'}</span>{vault && !vault.locked && <><b>/</b>{view === 'trash' ? 'Trash' : view === 'entities' ? 'Knowledge entities' : view === 'organization' ? 'Collections & folders' : view === 'favourites' ? 'Favourites' : view === 'recent' ? 'Recent items' : 'Pages'}{view === 'pages' && page && <><b>/</b>{page.title || 'Untitled'}</>}</>}</div><div className="top-actions">{view === 'pages' && page && vault && !disabled && <PageToolbar aiOpen={aiOpen} onAI={()=>{setPanelId(null);setAiOpen(value=>!value);}} favourite={organization.favourites.some(item => item.kind === 'page' && item.item_id === page.id)} onOrganizationChange={data => { if (workspace.snapshot().vault?.id === vault.id) workspace.setOrganization(data); }} onDelete={() => setDeleteTarget(page)} key={vault.id + '/' + page.id} page={page} entities={entities} onSourcesChange={sourceIds => workspace.updatePage({sourceIds})} onOpenEntity={openEntity} onCreateEntity={setCreate} onError={workspace.report}/>}<button id="save-status" role="status" onClick={() => run(() => workspace.saver.flush())}>{status}</button><button className="button small" disabled={disabled} onClick={() => setCreate({})}>+ New entity</button></div></header>
      <div id="content" inert={busy} aria-busy={busy}>
        {busy && view !== 'trash' ? <p className="loading-state" role="status">Loading workspace…</p> : vault?.locked ? <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1>{vault.name}</h1><p>This vault is locked. Unlock it to access its pages and knowledge.</p><button className="button primary" onClick={() => setVaultAction('unlock')}>Unlock vault</button><small>Export and import are planned.</small></section> : vault && view === 'trash' ? <TrashLibrary notes={trash} onRestore={id => workspace.restorePage(id)} onDelete={id => workspace.permanentlyDeletePage(id)} onRefresh={workspace.refreshTrash} onError={workspace.report}/> : vault && view === 'recent' ? <RecentLibrary recent={recent} pages={pages} entities={entities} onOpenPage={id => run(() => workspace.openPage(id))} onOpenEntity={openEntity}/> : vault && (view === 'organization' || view === 'favourites') ? <OrganizationLibrary data={organization} key={vault.id + view} vaultId={vault.id} pages={pages} entities={entities} favouritesOnly={view === 'favourites'} context={organizationContext} onContextChange={workspace.setOrganizationContext} onChanged={workspace.setOrganization} onOpenPage={id => run(() => workspace.openPage(id))} onOpenEntity={openEntity} onError={workspace.report}/> : vault && view === 'entities' ? <KnowledgeLibrary key={vault.id} entities={entities} onOpen={openEntity}/> : vault && page ? <PageEditor key={page.id} page={page} entities={entities} onChange={patch => workspace.updatePage(patch)} onOpenEntity={openEntity} onCreateEntity={setCreate} onSave={() => run(() => workspace.saver.flush())}/> : <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1>Your space to think</h1><p>A fresh vault for pages, knowledge, and the connections between them.</p><button className="button primary" disabled={!vault} onClick={() => run(() => workspace.newPage())}>Create your first page</button></section>}
      </div>
    </main>
    {aiOpen && view==='pages' && page && vault && !vault.locked && !busy && <IntelligencePanel key={vault.id+'/'+page.id} page={page} onClose={()=>setAiOpen(false)} onSettings={()=>setSettingsOpen(true)} onFlush={async()=>{await workspace.saver.flush();return workspace.snapshot().page;}}/>}
    {panelId && vault && !vault.locked && !busy && <EntityPanel key={vault.id + '/' + panelId} vaultId={vault.id} id={panelId} entities={entities} onOpen={openEntity} onClose={() => setPanelId(null)} onUpdated={() => workspace.refreshEntities()} onError={workspace.report}/>}
    {create && <CreateEntityDialog initial={create} onClose={() => setCreate(null)} onSubmit={async input => {
      const result = await workspace.createEntity(input);
      if (create.source && workspace.snapshot().page) workspace.updatePage({sourceIds: [...new Set([...workspace.snapshot().page!.sourceIds, result.id])]});
      create.onCreated?.(result.id); openEntity(result.id);
    }}/>}
    {renameTarget && <NameDialog maxLength={500} title="Rename page" value={renameTarget.title} onSave={name => workspace.renamePage(renameTarget.id,name)} onClose={() => setRenameTarget(null)}/>}
    {deleteTarget && <ConfirmDialog title="Move note to Trash?" description={`“${deleteTarget.title || 'Untitled'}” will be kept in Trash for 30 days. You can restore it until then.`} action="Move to Trash" onConfirm={() => workspace.deletePage(deleteTarget.id)} onClose={() => setDeleteTarget(null)}/>}
    {settingsOpen && <SettingsDialog appearance={appearance} onChange={setAppearance} storageError={storageError} onClose={() => setSettingsOpen(false)}/>}
    {vaultAction && <VaultDialog action={vaultAction} onClose={() => setVaultAction(null)} onSubmit={value => vaultAction === 'create' ? workspace.createVault(value) : vaultAction === 'lock' ? workspace.lock(value) : workspace.unlock(value)}/>}
    {error && <div id="toast" role="alert">{error}<button className="toast-close" aria-label="Dismiss error" onClick={workspace.dismissError}>×</button></div>}
  </>;
}
