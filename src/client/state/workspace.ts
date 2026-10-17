import { PageTitler } from './page-titler';
import { api } from '../api';
import type { Entity, EntityInput, Page, PageSummary, Vault, Organization, OrganizationContext, RecentItem, ItemKind, TrashedPage } from '../../shared/domain';
import { PageSaver, type SaveStatus } from './page-saver';
export interface WorkspaceState {
  vaults: Vault[]; vault: Vault | null; trash: TrashedPage[]; pages: PageSummary[]; entities: Entity[];
  organization: Organization; organizationContext: OrganizationContext; recent: RecentItem[];
  page: Page | null; view: 'pages' | 'entities' | 'organization' | 'favourites' | 'recent' | 'trash'; busy: boolean; reviewing: boolean; error: string | null; saveStatus: SaveStatus;
}
export class Workspace {
  private state: WorkspaceState = {vaults: [], vault: null, trash: [], pages: [], entities: [], organization: {collections: [], folders: [], locations: [], favourites: []}, organizationContext: {collection: '', folder: ''}, recent: [], page: null, view: 'organization', busy: true, reviewing: false, error: null, saveStatus: 'saved'};
  private listeners = new Set<() => void>();
  private pageCache = new Map<string, Page>();
  private navigation = false;
  private loadSequence = 0;
  readonly titler = new PageTitler(
    page => api.generateTitle(page.vault_id, page.id, page.revision),
    (original, title) => {
      const cached = this.pageCache.get(original.id);
      if (!cached || cached.vault_id !== original.vault_id || this.state.vault?.locked) return;
      const page = {...cached, title};
      this.pageCache.set(page.id, page);
      this.patch({pages: this.state.pages.map(item => item.id === page.id ? {...item, title} : item),
        ...(this.state.page?.id === page.id ? {page} : {})});
      this.saver.enqueue(page);
    },
  );
  readonly saver = new PageSaver(
    page => api.savePage(page.vault_id, page.id, page),
    saved => {
      const cached = this.pageCache.get(saved.id);
      if (cached) {
        const page = {...cached, revision: saved.revision};
        this.pageCache.set(saved.id, page);
        this.titler.observe(page, JSON.stringify(cached.blocks) === JSON.stringify(saved.blocks) && cached.title === saved.title);
      }
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
      this.titler.dispose(); this.pageCache.clear(); this.patch({vaults, vault, trash: [], pages: [], entities: [], organization: {collections: [], folders: [], locations: [], favourites: []}, organizationContext: {collection: '', folder: ''}, recent: [], page: null, view: 'organization', error: null});
      try { localStorage.setItem('noema-vault', id); } catch { /* The app can work without browser storage. */ }
      if (vault.locked) return;
      const [pages, entities, organization] = await Promise.all([api.pages(id), api.entities(id), api.organization(id)]);
      let recent: RecentItem[] = [];
      try {
        const stored: unknown = JSON.parse(localStorage.getItem('noema-recent/' + id) || '[]');
        if (Array.isArray(stored)) recent = stored.filter((item): item is RecentItem => !!item && typeof item === 'object' && (item.kind === 'page' || item.kind === 'entity') && typeof item.item_id === 'string' && typeof item.opened_at === 'string').slice(0, 50);
      } catch { /* Recent history is optional when storage is unavailable. */ }
      this.patch({pages, entities, organization, recent});
    });
  }
  private async loadPage(id: string) {
    const vault = this.state.vault!;
    const page = this.pageCache.get(id) || await api.page(vault.id, id);
    this.pageCache.set(id, page); this.patch({page, view: 'pages'}); this.recordRecent('page', id);
    this.titler.register(page); this.titler.observe(page, true);
  }
  async openPage(id: string) { await this.navigate(() => this.loadPage(id)); }
  async showPages() { this.openOrganization(); }
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
  updatePage(patch: Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds' | 'icon'>>) {
    const current = this.state.page;
    if (!current || this.state.busy || this.state.reviewing || this.state.vault?.locked) return;
    const page = {...current, ...patch}; this.pageCache.set(page.id, page);
    this.patch({page, pages: this.state.pages.map(p => p.id === page.id ? {...p, title: page.title, icon: page.icon} : p)});
    this.titler.observe(page);
    this.saver.enqueue(page);
  }
  async newPage() {
    await this.navigate(async () => {
      const vault = this.state.vault!; const page = await api.createPage(vault.id);
      this.titler.register(page);
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
      this.titler.observe({...original,title});
      const saved = await api.savePage(vault.id,id,{...original,title});
      this.titler.observe(saved);
      this.pageCache.set(id,saved);
      this.patch({pages: this.state.pages.map(page => page.id === id ? saved : page), ...(this.state.page?.id === id ? {page: saved} : {})});
    });
  }
  async locatePage(id: string, collection: string, folder: string | null, remove = false) {
    const vault = this.state.vault, sequence = this.loadSequence;
    if (!vault || vault.locked) return;
    const organization = await api.organize(vault.id, 'locations', {kind: 'page', item_id: id, collection_id: collection || null, folder_id: folder || null, remove});
    if (sequence === this.loadSequence) this.setOrganization(organization);
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
      const deleted = this.pageCache.get(id); if (deleted) this.titler.remove(deleted);
      await api.deletePage(vault.id, id);
      this.pageCache.delete(id);
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
  async reviewEntity(scanId: string, suggestionId: string | string[], decision: 'accepted' | 'rejected', edits?: import('../../shared/entity-scan').EntitySuggestionEdit[]) {
    if (this.navigation) throw new Error('Another note operation is finishing. Try again.');
    const original = this.state.page;
    if (!original || this.state.vault?.locked) throw new Error('Open the note to review suggestions.');
    // Serialize with autosave without entering the workspace loading state. The
    // editor stays mounted; only editing pauses for the duration of the write.
    this.navigation = true;
    this.patch({reviewing:true});
    this.titler.observe(original);
    try {
      await this.saver.flush();
      const page = this.state.page;
      if (!page || page.id !== original.id || page.vault_id !== original.vault_id) throw new Error('The selected note changed. Try again.');
      this.titler.observe(page);
      const result = await api.reviewEntity(page.vault_id,page.id,page.revision,scanId,suggestionId,decision,edits);
      this.pageCache.set(page.id,result.page);
      this.patch({page:result.page,entities:result.entities,pages:this.state.pages.map(p => p.id === page.id ? result.page : p)});
      return result.scan;
    } finally {
      this.navigation = false;
      this.patch({reviewing:false});
      if (this.state.page) this.titler.observe(this.state.page,true);
    }
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
