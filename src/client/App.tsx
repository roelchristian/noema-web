import { useEffect, useState, useSyncExternalStore } from 'react';
import { Workspace } from './state/workspace';
import { Icon } from './components/Icon';
import { PageEditor } from './editor/PageEditor';
import { EntityPanel } from './knowledge/EntityPanel';
import { KnowledgeLibrary } from './knowledge/KnowledgeLibrary';
import { CreateEntityDialog, type CreateEntityRequest } from './knowledge/CreateEntityDialog';
import { VaultDialog, type VaultAction } from './vaults/VaultDialog';
export function App() {
  const [workspace] = useState(() => new Workspace());
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const {vaults, vault, pages, entities, page, view, busy, error, saveStatus} = state;
  const [panelId, setPanelId] = useState<string | null>(null), [create, setCreate] = useState<CreateEntityRequest | null>(null), [vaultAction, setVaultAction] = useState<VaultAction | null>(null);
  const run = (work: () => Promise<unknown>) => { void work().catch(workspace.report); };
  useEffect(() => { void workspace.init(); return () => workspace.saver.dispose(); }, [workspace]);
  useEffect(() => { setPanelId(null); setCreate(null); }, [vault?.id, vault?.locked]);
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
    <aside className="sidebar"><a className="brand" href="/">n<span>noema</span><small>LOCAL</small></a>
      <div className="vault-controls"><label htmlFor="vault-select">VAULT</label><select id="vault-select" aria-label="Current vault" value={vault?.id || ''} disabled={busy || !vaults.length} onChange={e => run(() => workspace.selectVault(e.target.value))}>{!vault && <option value="">Loading vaults…</option>}{vaults.map(v => <option key={v.id} value={v.id}>{v.locked ? 'Locked · ' : ''}{v.name}</option>)}</select><div className="vault-actions"><button disabled={busy} onClick={() => setVaultAction('create')}>+ New vault</button><button disabled={disabled} onClick={() => { if (vault?.protected) run(() => workspace.lock()); else setVaultAction('lock'); }}>Lock</button></div></div>
      <div className="workspace-label">IN THIS VAULT</div>
      <button className={'nav ' + (view === 'pages' ? 'active' : '')} disabled={disabled} onClick={() => run(() => workspace.showPages())}><span data-icon="page"><Icon name="page"/></span><span>Pages</span><kbd>P</kbd></button>
      <button className={'nav ' + (view === 'entities' ? 'active' : '')} disabled={disabled} onClick={() => workspace.showEntities()}><span data-icon="knowledge"><Icon name="knowledge"/></span><span>Knowledge entities</span><span className="count">{entities.length}</span></button>
      <div className="section-label">PAGES <button title="New page" aria-label="New page" disabled={disabled} onClick={() => run(() => workspace.newPage())}>+</button></div>
      <nav id="page-list">{pages.map(p => <button key={p.id} className={'page-link ' + (page?.id === p.id && view === 'pages' ? 'selected' : '')} disabled={disabled} onClick={() => run(() => workspace.openPage(p.id))}><span><Icon name="page"/></span>{p.title || 'Untitled'}</button>)}</nav>
      <div className="sidebar-footer"><span className="status-dot"/>Local vault<small>Export / import · Planned</small></div>
    </aside>
    <main><header className="topbar"><div id="breadcrumb"><span>{vault?.name || 'Noema'}</span>{vault && !vault.locked && <><b>/</b>{view === 'entities' ? 'Knowledge entities' : 'Pages'}{view === 'pages' && page && <><b>/</b>{page.title || 'Untitled'}</>}</>}</div><div className="top-actions"><button id="save-status" role="status" onClick={() => run(() => workspace.saver.flush())}>{status}</button><button className="button small" disabled={disabled} onClick={() => setCreate({})}>+ New entity</button></div></header>
      <div id="content" inert={busy} aria-busy={busy}>
        {busy ? <p className="loading-state" role="status">Loading workspace…</p> : vault?.locked ? <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1>{vault.name}</h1><p>This vault is locked. Unlock it to access its pages and knowledge.</p><button className="button primary" onClick={() => setVaultAction('unlock')}>Unlock vault</button><small>Export and import are planned.</small></section> : vault && view === 'entities' ? <KnowledgeLibrary key={vault.id} entities={entities} onOpen={setPanelId}/> : vault && page ? <PageEditor key={page.id} page={page} vault={vault} entities={entities} onChange={patch => workspace.updatePage(patch)} onDelete={() => { if (confirm('Delete this page?')) run(() => workspace.deletePage()); }} onOpenEntity={setPanelId} onCreateEntity={setCreate} onSave={() => run(() => workspace.saver.flush())}/> : <section className="locked-state"><div className="vault-symbol"><Icon name="vault"/></div><h1>Your space to think</h1><p>A fresh vault for pages, knowledge, and the connections between them.</p><button className="button primary" disabled={!vault} onClick={() => run(() => workspace.newPage())}>Create your first page</button></section>}
      </div>
    </main>
    {panelId && vault && !vault.locked && !busy && <EntityPanel key={vault.id + '/' + panelId} vaultId={vault.id} id={panelId} entities={entities} onOpen={setPanelId} onClose={() => setPanelId(null)} onUpdated={() => workspace.refreshEntities()} onError={workspace.report}/>}
    {create && <CreateEntityDialog initial={create} onClose={() => setCreate(null)} onSubmit={async input => {
      const result = await workspace.createEntity(input);
      if (create.source && workspace.snapshot().page) workspace.updatePage({sourceIds: [...new Set([...workspace.snapshot().page!.sourceIds, result.id])]});
      create.onCreated?.(result.id); setPanelId(result.id);
    }}/>}
    {vaultAction && <VaultDialog action={vaultAction} onClose={() => setVaultAction(null)} onSubmit={value => vaultAction === 'create' ? workspace.createVault(value) : vaultAction === 'lock' ? workspace.lock(value) : workspace.unlock(value)}/>}
    {error && <div id="toast" role="alert">{error}<button className="toast-close" aria-label="Dismiss error" onClick={workspace.dismissError}>×</button></div>}
  </>;
}
