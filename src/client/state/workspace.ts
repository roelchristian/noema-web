import { api } from '../api';
import type { Entity, EntityInput, Page, PageSummary, Vault, Organization, OrganizationContext, RecentItem, ItemKind, TrashedPage } from '../../shared/domain';
import { PageSaver, type SaveStatus } from './page-saver';
export interface WorkspaceState {
  vaults: Vault[]; vault: Vault | null; trash: TrashedPage[]; pages: PageSummary[]; entities: Entity[];
  organization: Organization; organizationContext: OrganizationContext; recent: RecentItem[];
  page: Page | null; view: 'pages' | 'entities' | 'organization' | 'favourites' | 'recent' | 'trash'; busy: boolean; error: string | null; saveStatus: SaveStatus;
}
export class Workspace {
  private state: WorkspaceState = {vaults: [], vault: null, trash: [], pages: [], entities: [], organization: {collections: [], folders: [], locations: [], favourites: []}, organizationContext: {collection: '', folder: ''}, recent: [], page: null, view: 'pages', busy: true, error: null, saveStatus: 'saved'};
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
      this.pageCache.clear(); this.patch({vaults, vault, trash: [], pages: [], entities: [], organization: {collections: [], folders: [], locations: [], favourites: []}, organizationContext: {collection: '', folder: ''}, recent: [], page: null, view: 'pages', error: null});
      try { localStorage.setItem('noema-vault', id); } catch { /* The app can work without browser storage. */ }
      if (vault.locked) return;
      const [pages, entities, organization] = await Promise.all([api.pages(id), api.entities(id), api.organization(id)]);
      let recent: RecentItem[] = [];
      try {
        const stored: unknown = JSON.parse(localStorage.getItem('noema-recent/' + id) || '[]');
        if (Array.isArray(stored)) recent = stored.filter((item): item is RecentItem => !!item && typeof item === 'object' && (item.kind === 'page' || item.kind === 'entity') && typeof item.item_id === 'string' && typeof item.opened_at === 'string').slice(0, 50);
      } catch { /* Recent history is optional when storage is unavailable. */ }
      this.patch({pages, entities, organization, recent});
      if (pages[0]) await this.loadPage(pages[0].id);
    });
  }
  private async loadPage(id: string) {
    const vault = this.state.vault!;
    const page = this.pageCache.get(id) || await api.page(vault.id, id);
    this.pageCache.set(id, page); this.patch({page, view: 'pages'}); this.recordRecent('page', id);
  }
  async openPage(id: string) { await this.navigate(() => this.loadPage(id)); }
  async showPages() { if (this.state.pages.length) await this.openPage(this.state.page?.id || this.state.pages[0]!.id); else await this.newPage(); }
  showOrganization(favourites = false) { if (!this.state.busy) this.patch({view: favourites ? 'favourites' : 'organization'}); }
  showRecent() { if (!this.state.busy) this.patch({view: 'recent'}); }
  setOrganization = (organization: Organization) => {
    const current = this.state.organizationContext;
    const collection = organization.collections.some(c => c.id === current.collection) ? current.collection : '';
    const folder = organization.folders.some(f => f.id === current.folder && (f.collection_id || '') === collection) ? current.folder : '';
    this.patch({organization, organizationContext: {collection, folder}});
  };
  setOrganizationContext = (patch: Partial<OrganizationContext>) => {
    this.patch({organizationContext: {...this.state.organizationContext, ...patch}});
  };
  openOrganization(collection = '', folder = '') {
    if (!this.state.busy) this.patch({view: 'organization', organizationContext: {collection, folder}});
  }
  recordRecent(kind: ItemKind, item_id: string) {
    const vault = this.state.vault;
    if (!vault || vault.locked) return;
    const recent = [{kind, item_id, opened_at: new Date().toISOString()}, ...this.state.recent.filter(item => item.kind !== kind || item.item_id !== item_id)].slice(0, 50);
    this.patch({recent});
    try { localStorage.setItem('noema-recent/' + vault.id, JSON.stringify(recent)); } catch { /* Keep session history when storage is unavailable. */ }
  }
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
      this.pageCache.set(page.id, page); this.patch({page, pages: [page, ...this.state.pages], view: 'pages'}); this.recordRecent('page', page.id);
    });
  }
  refreshTrash = async () => {
    const vault = this.state.vault, sequence = this.loadSequence;
    if (!vault || vault.locked) return;
    const trash = await api.trash(vault.id);
    if (sequence === this.loadSequence && this.state.view === 'trash') this.patch({trash});
  };
  async showTrash() {
    await this.navigate(async () => {
      const vault = this.state.vault; if (!vault || vault.locked) return;
      this.patch({trash: await api.trash(vault.id), view: 'trash'});
    });
  }
  async renamePage(id: string, title: string) {
    await this.navigate(async () => {
      const vault = this.state.vault; if (!vault || vault.locked) return;
      const original = this.pageCache.get(id) || await api.page(vault.id,id);
      const saved = await api.savePage(vault.id,id,{...original,title});
      this.pageCache.set(id,saved);
      this.patch({pages: this.state.pages.map(page => page.id === id ? saved : page), ...(this.state.page?.id === id ? {page: saved} : {})});
    });
  }
  async togglePageFavourite(id: string) {
    const vault = this.state.vault, sequence = this.loadSequence; if (!vault || vault.locked || this.state.busy) return;
    const favourite = !this.state.organization.favourites.some(item => item.kind === 'page' && item.item_id === id);
    const organization = await api.organize(vault.id,'favourites',{kind: 'page',item_id: id,favourite});
    if (sequence === this.loadSequence) this.setOrganization(organization);
  }
  async deletePage(id = this.state.page?.id) {
    await this.navigate(async () => {
      const {vault, page, organization} = this.state; if (!id || !vault) return;
      await api.deletePage(vault.id, id); this.pageCache.delete(id);
      const pages = this.state.pages.filter(p => p.id !== id);
      this.patch({pages, page: page?.id === id ? null : page, organization: {...organization,
        locations: organization.locations.filter(item => item.kind !== 'page' || item.item_id !== id),
        favourites: organization.favourites.filter(item => item.kind !== 'page' || item.item_id !== id),
      }});
      if (page?.id === id && pages[0]) await this.loadPage(pages[0].id);
    });
  }
  async restorePage(id: string) {
    await this.navigate(async () => {
      const vault = this.state.vault; if (!vault || vault.locked) return;
      const restored = await api.restorePage(vault.id, id);
      this.pageCache.set(id, restored);
      this.patch({trash: this.state.trash.filter(note => note.id !== id), pages: [restored, ...this.state.pages.filter(note => note.id !== id)]});
      await this.loadPage(id);
      try { this.setOrganization(await api.organization(vault.id)); } catch (error) { this.report(error); }
    });
  }
  async permanentlyDeletePage(id: string) {
    await this.navigate(async () => {
      const vault = this.state.vault; if (!vault || vault.locked) return;
      await api.permanentlyDeletePage(vault.id, id);
      this.patch({trash: this.state.trash.filter(note => note.id !== id)});
      this.pageCache.delete(id);
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
