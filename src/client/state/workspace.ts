import { api } from '../api';
import type { Entity, EntityInput, Page, PageSummary, Vault } from '../../shared/domain';
import { PageSaver, type SaveStatus } from './page-saver';
export interface WorkspaceState {
  vaults: Vault[]; vault: Vault | null; pages: PageSummary[]; entities: Entity[];
  page: Page | null; view: 'pages' | 'entities'; busy: boolean; error: string | null; saveStatus: SaveStatus;
}
export class Workspace {
  private state: WorkspaceState = {vaults: [], vault: null, pages: [], entities: [], page: null, view: 'pages', busy: true, error: null, saveStatus: 'saved'};
  private listeners = new Set<() => void>();
  private pageCache = new Map<string, Page>();
  private navigation = false;
  private loadSequence = 0;
  readonly saver = new PageSaver(
    page => api.savePage(page.vault_id, page.id, page),
    saved => {
      const cached = this.pageCache.get(saved.id);
      if (cached) this.pageCache.set(saved.id, {...cached, revision: saved.revision});
      if (this.state.page?.id === saved.id && this.state.vault?.id === saved.vault_id) this.patch({page: {...this.state.page, revision: saved.revision}});
    },
    (saveStatus, error) => this.patch({saveStatus, ...(error ? {error: error.message} : {})}),
  );
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private patch(patch: Partial<WorkspaceState>) { this.state = {...this.state, ...patch}; this.listeners.forEach(fn => fn()); }
  report = (error: unknown) => this.patch({error: error instanceof Error ? error.message : String(error)});
  dismissError = () => this.patch({error: null});
  async init() {
    try {
      const vaults = await api.vaults(); this.patch({vaults});
      let remembered: string | null = null;
      try { remembered = localStorage.getItem('noema-vault'); } catch { /* Storage may be disabled. */ }
      await this.selectVault(vaults.find(v => v.id === remembered)?.id || vaults[0]!.id);
    } catch (error) { this.patch({busy: false}); this.report(error); }
  }
  private async navigate(work: () => Promise<void>) {
    if (this.navigation) return;
    this.navigation = true; this.patch({busy: true});
    try { await this.saver.flush(); await work(); }
    finally { this.navigation = false; this.patch({busy: false}); }
  }
  async selectVault(id: string) {
    await this.navigate(async () => {
      const vaults = await api.vaults(), vault = vaults.find(v => v.id === id);
      if (!vault) throw new Error('Vault not found');
      ++this.loadSequence;
      this.pageCache.clear(); this.patch({vaults, vault, pages: [], entities: [], page: null, view: 'pages', error: null});
      try { localStorage.setItem('noema-vault', id); } catch { /* The app can work without browser storage. */ }
      if (vault.locked) return;
      const [pages, entities] = await Promise.all([api.pages(id), api.entities(id)]);
      this.patch({pages, entities});
      if (pages[0]) await this.loadPage(pages[0].id);
    });
  }
  private async loadPage(id: string) {
    const vault = this.state.vault!;
    const page = this.pageCache.get(id) || await api.page(vault.id, id);
    this.pageCache.set(id, page); this.patch({page, view: 'pages'});
  }
  async openPage(id: string) { await this.navigate(() => this.loadPage(id)); }
  async showPages() { if (this.state.pages.length) await this.openPage(this.state.page?.id || this.state.pages[0]!.id); else await this.newPage(); }
  showEntities() { if (!this.state.busy) this.patch({view: 'entities'}); }
  updatePage(patch: Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds'>>) {
    const current = this.state.page;
    if (!current || this.state.busy || this.state.vault?.locked) return;
    const page = {...current, ...patch}; this.pageCache.set(page.id, page);
    this.patch({page, pages: this.state.pages.map(p => p.id === page.id ? {...p, title: page.title} : p)});
    this.saver.enqueue(page);
  }
  async newPage() {
    await this.navigate(async () => {
      const vault = this.state.vault!; const page = await api.createPage(vault.id);
      this.pageCache.set(page.id, page); this.patch({page, pages: [page, ...this.state.pages], view: 'pages'});
    });
  }
  async deletePage() {
    await this.navigate(async () => {
      const {page, vault} = this.state; if (!page || !vault) return;
      await api.deletePage(vault.id, page.id); this.pageCache.delete(page.id);
      const pages = this.state.pages.filter(p => p.id !== page.id); this.patch({pages, page: null});
      if (pages[0]) await this.loadPage(pages[0].id);
    });
  }
  async createEntity(input: EntityInput) {
    const vault = this.state.vault!, sequence = this.loadSequence;
    const result = await api.createEntity(vault.id, input), entities = await api.entities(vault.id);
    if (sequence === this.loadSequence) this.patch({entities});
    return result;
  }
  async refreshEntities() {
    const vault = this.state.vault!, sequence = this.loadSequence;
    const entities = await api.entities(vault.id);
    if (sequence === this.loadSequence) this.patch({entities});
  }
  async createVault(name: string) {
    await this.saver.flush(); const vault = await api.createVault(name); await this.selectVault(vault.id);
  }
  async lock(passphrase?: string) {
    await this.saver.flush(); const id = this.state.vault!.id; await api.lock(id, passphrase); await this.selectVault(id);
  }
  async unlock(passphrase: string) {
    const id = this.state.vault!.id; await api.unlock(id, passphrase); await this.selectVault(id);
  }
}
