import {entitiesForPage} from '../../shared/concept-classification';
import { identifyEntityMentions } from '../../shared/auto-entities';
import { canIdentifyEntities, yieldForEntityMatching } from '../editor/auto-entity-matching';
import { PageTitler } from './page-titler';
import { api, ApiError } from '../api';
import type { Entity, EntityInput, Page, PageSummary, Vault, Organization, OrganizationContext, RecentItem, ItemKind, TrashedPage } from '../../shared/domain';
import { PageSaver, type SaveStatus } from './page-saver';
export interface WorkspaceState {
  canGoBack: boolean; canGoForward: boolean;
  entityPanelId: string | null;
  vaults: Vault[]; vault: Vault | null; trash: TrashedPage[]; pages: PageSummary[]; entities: Entity[];
  organization: Organization; organizationContext: OrganizationContext; recent: RecentItem[];
  page: Page | null; view: 'pages' | 'entities' | 'organization' | 'favourites' | 'recent' | 'trash' | 'inbox'; busy: boolean; loadingPageId: string | null; reviewing: boolean; error: string | null; saveStatus: SaveStatus;
}
type NavigationAddress = {view: WorkspaceState['view']; pageId: string | null; entityId: string | null; collection: string; folder: string};
export class Workspace {
  private state: WorkspaceState = {entityPanelId: null, canGoBack: false, canGoForward: false, vaults: [], vault: null, trash: [], pages: [], entities: [], organization: {collections: [], folders: [], locations: [], memberships: [], favourites: []}, organizationContext: {collection: '', folder: ''}, recent: [], page: null, view: 'organization', busy: true, loadingPageId: null, reviewing: false, error: null, saveStatus: 'saved'};
  private history: NavigationAddress[] = [];
  private historyIndex = -1;
  private historyVault: string | null = null;
  private traversingHistory = false;
  private listeners = new Set<() => void>();
  private pageCache = new Map<string, Page>();
  private navigation = false;
  private loadSequence = 0;
  private pageLoadSequence = 0;
  private pageLockPending = false;
  private pageRequest: AbortController | null = null;
  readonly titler = new PageTitler(
    page => api.generateTitle(page.vault_id, page.id, page.revision, true),
    (original, title,conceptClassification) => {
      const cached = this.pageCache.get(original.id);
      if (!cached || cached.editLocked || this.pageLockPending || cached.vault_id !== original.vault_id || this.state.vault?.locked) return;
      const page = {...cached, title,...(conceptClassification?{conceptClassification}:{})};
      this.pageCache.set(page.id, page);
      this.patch({pages: this.state.pages.map(item => item.id === page.id ? {...item, title} : item),
        ...(this.state.page?.id === page.id ? {page} : {})});
      if(page.title!==cached.title)this.saver.enqueue(page);
    },
    id => this.state.entities.find(entity => entity.id === id)?.name || '',
  );
  readonly saver = new PageSaver(
    page => api.savePage(page.vault_id, page.id, page),
    (saved, original) => {
      const cached = this.pageCache.get(saved.id);
      if (cached) {
        const unchanged = JSON.stringify(cached.blocks) === JSON.stringify(original.blocks);
        const page = {...cached, ...(unchanged && !this.state.reviewing && canIdentifyEntities() ? {blocks: saved.blocks} : {}), conceptClassification:saved.conceptClassification,conceptContentHash:unchanged?saved.conceptContentHash:undefined,revision: saved.revision, summaryContentHash: saved.summaryContentHash, updated_at: saved.updated_at};
        this.pageCache.set(saved.id, page);
        this.titler.observe(page, unchanged && cached.title === saved.title);
      }
      if (this.state.vault?.id === saved.vault_id) this.patch({pages: this.state.pages.map(page => page.id === saved.id ? {...page, updated_at: saved.updated_at} : page), ...(this.state.page?.id === saved.id ? {page: this.pageCache.get(saved.id) || {...this.state.page, conceptClassification:saved.conceptClassification,conceptContentHash:JSON.stringify(this.state.page.blocks)===JSON.stringify(original.blocks)?saved.conceptContentHash:undefined,revision: saved.revision, summaryContentHash: saved.summaryContentHash, updated_at: saved.updated_at}} : {})});
    },
    (saveStatus, error) => this.patch({saveStatus, ...(error ? {error: error.message} : {})}),
    async page => {
      await yieldForEntityMatching();
      if (this.state.vault?.id !== page.vault_id || this.state.vault.locked || this.state.reviewing || !canIdentifyEntities()) return page;
      const {blocks} = identifyEntityMentions(page.blocks, entitiesForPage(page,this.state.entities), page.vault_id);
      return blocks === page.blocks ? page : {...page, blocks};
    },
  );
  identifyEntities = async () => {
    const page = this.state.page;
    if (!page || page.editLocked || this.pageLockPending || this.state.view !== 'pages' || this.state.busy || this.state.loadingPageId !== null || this.state.reviewing || this.state.vault?.locked || this.saver.hasPending || !canIdentifyEntities()) return;
    this.patch({saveStatus: 'identifying'});
    try {
      await yieldForEntityMatching();
      if (this.state.page !== page || this.state.view !== 'pages' || this.state.busy || this.state.loadingPageId !== null || this.state.reviewing || this.state.vault?.locked || this.saver.hasPending || !canIdentifyEntities()) return;
      const {blocks, count} = identifyEntityMentions(page.blocks, entitiesForPage(page,this.state.entities), page.vault_id);
      if (count) this.updatePage({blocks});
    } catch (error) { this.report(error); }
    finally { if (this.state.saveStatus === 'identifying' && !this.saver.hasPending) this.patch({saveStatus: 'saved'}); }
  };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private patch(patch: Partial<WorkspaceState>) {
    const previous = this.state;
    this.state = {...this.state, ...patch};
    if (!this.state.vault || this.state.vault.locked || this.state.vault.id !== previous.vault?.id ||
      this.state.view !== previous.view || this.state.view === 'pages' && this.state.page?.id !== previous.page?.id ||
      this.state.view === 'organization' && (this.state.organizationContext.collection !== previous.organizationContext.collection || this.state.organizationContext.folder !== previous.organizationContext.folder) ||
      this.state.entityPanelId && !this.state.entities.some(entity => entity.id === this.state.entityPanelId)) {
      this.state = {...this.state, entityPanelId: null};
    }
    this.updateHistory();
    // Do not replace the saved address with intermediate loading/locked state.
    if (!this.state.busy && this.state.loadingPageId === null && this.state.vault && !this.state.vault.locked &&
      (patch.view !== undefined || patch.organizationContext !== undefined || patch.busy === false || patch.loadingPageId === null)) {
      try {
        localStorage.setItem('noema-address/' + this.state.vault.id, JSON.stringify({
          view: this.state.view, ...this.state.organizationContext,
          pageId: this.state.view === 'pages' ? this.state.page?.id ?? null : null,
        }));
      } catch { /* Navigation still works when browser storage is unavailable. */ }
    }
    this.listeners.forEach(fn => fn());
  }
  private validAddress(address: NavigationAddress) {
    if (address.entityId && !this.state.entities.some(entity => entity.id === address.entityId)) return false;
    if (address.view === 'pages') return this.state.pages.some(page => page.id === address.pageId);
    if (address.view !== 'organization') return true;
    return (!address.collection || this.state.organization.collections.some(item => item.id === address.collection)) &&
      (!address.folder || this.state.organization.folders.some(item => item.id === address.folder));
  }
  private updateHistory() {
    const vaultId = this.state.vault && !this.state.vault.locked ? this.state.vault.id : null;
    if (vaultId !== this.historyVault) {
      this.history = []; this.historyIndex = -1; this.historyVault = vaultId;
    }
    if (!this.traversingHistory && vaultId && !this.state.busy && this.state.loadingPageId === null) {
      const currentIndex = this.historyIndex;
      this.historyIndex = this.history.filter((address, index) => index <= currentIndex && this.validAddress(address)).length - 1;
      this.history = this.history.filter(address => this.validAddress(address));
      const address: NavigationAddress = {view: this.state.view, pageId: this.state.view === 'pages' ? this.state.page?.id ?? null : null, entityId: this.state.entityPanelId,
        collection: this.state.view === 'organization' ? this.state.organizationContext.collection : '',
        folder: this.state.view === 'organization' ? this.state.organizationContext.folder : ''};
      if (this.validAddress(address) && JSON.stringify(address) !== JSON.stringify(this.history[this.historyIndex])) {
        this.history = [...this.history.slice(0, this.historyIndex + 1), address];
        this.historyIndex = this.history.length - 1;
      }
    }
    this.state = {...this.state,
      canGoBack: !this.traversingHistory && this.history.slice(0, this.historyIndex).some(address => this.validAddress(address)),
      canGoForward: !this.traversingHistory && this.history.slice(this.historyIndex + 1).some(address => this.validAddress(address))};
  }
  async goHistory(direction: -1 | 1) {
    if (this.traversingHistory || this.state.busy || this.state.reviewing || this.state.loadingPageId !== null || !this.state.vault || this.state.vault.locked) return;
    let index = this.historyIndex + direction;
    while (index >= 0 && index < this.history.length && !this.validAddress(this.history[index]!)) index += direction;
    const address = this.history[index];
    if (!address) return;
    this.traversingHistory = true;
    this.patch({});
    try {
      const sameView = this.state.view === address.view && (address.view === 'pages' ? this.state.page?.id === address.pageId :
        address.view !== 'organization' || this.state.organizationContext.collection === address.collection && this.state.organizationContext.folder === address.folder);
      if (!sameView && address.view === 'pages') await this.openPage(address.pageId!);
      else if (!sameView) await this.navigate(async () => {
        if (address.view === 'trash') this.patch({trash: await api.trash(this.state.vault!.id)});
        this.patch({view: address.view, organizationContext: {collection: address.collection, folder: address.folder}});
      });
      this.patch({entityPanelId: address.entityId});
      if (address.entityId) this.recordRecent('entity', address.entityId);
      this.historyIndex = index;
    } finally {
      this.traversingHistory = false;
      this.patch({});
    }
  }
  openEntity(id: string) {
    if (!this.state.vault || this.state.vault.locked || this.state.busy || this.state.reviewing || this.state.loadingPageId !== null || this.traversingHistory || !this.state.entities.some(entity => entity.id === id)) return;
    this.patch({entityPanelId: id});
    this.recordRecent('entity', id);
  }
  closeEntity() {
    if (this.state.entityPanelId) this.patch({entityPanelId: null});
  }
  private async restoreAddress() {
    const {vault, organization, pages} = this.state;
    if (!vault || vault.locked) return;
    let stored: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(localStorage.getItem('noema-address/' + vault.id) || 'null');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      stored = value as Record<string, unknown>;
    } catch { return; }
    if (typeof stored.view !== 'string' || !['pages', 'organization', 'entities', 'favourites', 'recent', 'trash', 'inbox'].includes(stored.view)) return;
    const collection = organization.collections.some(item => item.id === stored.collection) ? String(stored.collection) : '';
    const folder = !collection && organization.folders.some(item => item.id === stored.folder) ? String(stored.folder) : '';
    this.patch({organizationContext: {collection, folder}});
    if (stored.view === 'pages') {
      if (typeof stored.pageId === 'string' && pages.some(page => page.id === stored.pageId)) await this.loadPage(stored.pageId, false);
      else this.patch({organizationContext: {collection: '', folder: ''}});
      return;
    }
    if (stored.view === 'trash') this.patch({trash: await api.trash(vault.id)});
    this.patch({view: stored.view as WorkspaceState['view']});
  }
  report = (error: unknown) => this.patch({error: error instanceof Error ? error.message : String(error)});
  dismissError = () => this.patch({error: null});
  async init() {
    try {
      const vaults = await api.vaults(); this.patch({vaults});
      let remembered: string | null = null;
      try { remembered = localStorage.getItem('noema-vault'); } catch { /* Storage may be disabled. */ }
      const selected=vaults.find(v=>v.id===remembered)??vaults[0];
      if(!selected){this.patch({busy:false,view:'organization'});return;}
      await this.selectVault(selected.id);
    } catch (error) { this.patch({busy: false}); this.report(error); }
  }
  private cancelPageLoad() {
    ++this.pageLoadSequence;
    this.pageRequest?.abort(); this.pageRequest = null;
    if (this.state.loadingPageId !== null) {
      this.navigation = false;
      this.patch({loadingPageId:null});
    }
  }
  private async navigate(work: () => Promise<void>) {
    // Vault changes and destructive operations invalidate any pending note response.
    this.cancelPageLoad();
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
      this.titler.dispose(); this.pageCache.clear(); this.patch({vaults, vault, trash: [], pages: [], entities: [], organization: {collections: [], folders: [], locations: [], memberships: [], favourites: []}, organizationContext: {collection: '', folder: ''}, recent: [], page: null, view: 'organization', error: null});
      try { localStorage.setItem('noema-vault', id); } catch { /* The app can work without browser storage. */ }
      if (vault.locked) return;
      const [pages, entities, organization] = await Promise.all([api.pages(id), api.entities(id), api.organization(id)]);
      let recent: RecentItem[] = [];
      try {
        const stored: unknown = JSON.parse(localStorage.getItem('noema-recent/' + id) || '[]');
        if (Array.isArray(stored)) recent = stored.filter((item): item is RecentItem => !!item && typeof item === 'object' && (item.kind === 'page' || item.kind === 'entity') && typeof item.item_id === 'string' && typeof item.opened_at === 'string').slice(0, 50);
      } catch { /* Recent history is optional when storage is unavailable. */ }
      this.patch({pages, entities, organization, recent});
      await this.restoreAddress();
    });
  }
  private async loadPage(id: string, recordRecent = true) {
    const vault = this.state.vault!;
    // Fetch the body and its current review cache together before mounting the editor.
    const page = await api.page(vault.id, id);
    this.pageCache.set(id, page); this.patch({page, view: 'pages'});
    if (recordRecent) this.recordRecent('page', id);
    this.titler.register(page); this.titler.observe(page, true);
  }
  async openPage(id: string) {
    const vault = this.state.vault;
    if (!vault || vault.locked || this.state.busy || this.state.reviewing || this.navigation && this.state.loadingPageId === null) return;
    // Re-selecting the displayed page should preserve its editor and selection.
    if (this.state.view === 'pages' && this.state.page?.id === id) {this.cancelPageLoad(); return;}
    this.pageRequest?.abort();
    const sequence = ++this.pageLoadSequence, controller = new AbortController();
    this.pageRequest = controller; this.navigation = true;
    const current = () => sequence === this.pageLoadSequence && this.state.vault?.id === vault.id && !this.state.vault.locked;
    const cached = this.pageCache.get(id);
    if (cached?.vault_id === vault.id && this.state.pages.some(page => page.id === id)) {
      // The saver owns vault-scoped snapshots, so cached navigation need not wait
      // for outgoing writes. Keep drafts in memory even if a background save fails.
      this.navigation = false; this.pageRequest = null;
      this.patch({page:cached,view:'pages',loadingPageId:null,error:null});
      this.recordRecent('page',id);
      this.titler.register(cached); this.titler.observe(cached,!this.saver.hasPending);
      if (this.saver.hasPending) void this.saver.flush().catch(this.report);
      else {
        this.pageRequest = controller;
        void api.page(vault.id,id,controller.signal).then(fresh => {
          // Ignore revalidation if navigation, editing, or saving has intervened.
          if (!current() || controller.signal.aborted || this.saver.hasPending || this.pageCache.get(id) !== cached) return;
          if (fresh.revision < cached.revision || JSON.stringify(fresh) === JSON.stringify(cached)) return;
          this.pageCache.set(id,fresh);
          this.patch({page:fresh,pages:this.state.pages.map(page=>page.id===id?fresh:page)});
        }).catch(error => {
          if (!current() || controller.signal.aborted) return;
          if (error instanceof ApiError && error.status === 404) this.pageCache.delete(id);
          // Keep the cached note usable when offline; writes surface save failures.
        }).finally(()=>{if(current() && this.pageRequest === controller)this.pageRequest=null;});
      }
      return;
    }
    this.patch({loadingPageId:id,error:null});
    try {
      // Keep the old editor mounted but inert until its pending writes are safe.
      await this.saver.flush();
      if (!current()) return;
      const page = await api.page(vault.id,id,controller.signal);
      if (!current()) return;
      this.pageCache.set(id,page); this.patch({page,view:'pages',loadingPageId:null});
      this.recordRecent('page',id);
      this.titler.register(page); this.titler.observe(page,true);
    } catch (error) {
      if (current() && !controller.signal.aborted) throw error;
    } finally {
      if (sequence === this.pageLoadSequence) {
        this.navigation = false; this.pageRequest = null;
        this.patch({loadingPageId:null});
      }
    }
  }
  async showPages() { this.openOrganization(); }
  showOrganization(favourites = false) { if (!this.state.busy && this.state.loadingPageId === null) this.patch({view: favourites ? 'favourites' : 'organization'}); }
  showInbox() { if (!this.state.busy && this.state.loadingPageId === null) this.patch({view: 'inbox'}); }
  showRecent() { if (!this.state.busy && this.state.loadingPageId === null) this.patch({view: 'recent'}); }
  setOrganization = (organization: Organization) => {
    const current = this.state.organizationContext;
    const collection = organization.collections.some(c => c.id === current.collection) ? current.collection : '';
    const folder = organization.folders.some(f => f.id === current.folder && !collection) ? current.folder : '';
    this.patch({organization, organizationContext: {collection, folder}});
  };
  setOrganizationContext = (patch: Partial<OrganizationContext>) => {
    this.patch({organizationContext: {...this.state.organizationContext, ...patch}});
  };
  openOrganization(collection = '', folder = '') {
    if (!this.state.busy && this.state.loadingPageId === null) this.patch({view: 'organization', organizationContext: {collection, folder}});
  }
  recordRecent(kind: ItemKind, item_id: string) {
    const vault = this.state.vault;
    if (!vault || vault.locked) return;
    const recent = [{kind, item_id, opened_at: new Date().toISOString()}, ...this.state.recent.filter(item => item.kind !== kind || item.item_id !== item_id)].slice(0, 50);
    this.patch({recent});
    try { localStorage.setItem('noema-recent/' + vault.id, JSON.stringify(recent)); } catch { /* Keep session history when storage is unavailable. */ }
  }
  showEntities() { if (!this.state.busy && this.state.loadingPageId === null) this.patch({view: 'entities'}); }
  updatePage(patch: Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds' | 'icon' | 'featuredImageId'>>) {
    const current = this.state.page;
    if (!current || current.editLocked || this.pageLockPending || this.state.busy || this.state.loadingPageId !== null || this.state.reviewing || this.state.vault?.locked) return;
    const page = {...current, ...patch,...(patch.blocks&&patch.blocks!==current.blocks?{conceptContentHash:undefined}:{})};
    if(page.featuredImageId && !page.blocks.some(block=>block.type==='image' && block.imageId===page.featuredImageId))page.featuredImageId=null;
    this.pageCache.set(page.id, page);
    this.patch({page, pages: this.state.pages.map(p => p.id === page.id ? {...p, title: page.title, icon: page.icon, featuredImageId: page.featuredImageId} : p)});
    this.titler.observe(page);
    this.saver.enqueue(page);
  }
  async setPageEditLock(locked: boolean, password?: string) {
    const original=this.state.page, sequence=this.loadSequence;
    if (!original || this.pageLockPending || this.state.vault?.locked) return;
    this.pageLockPending=true;
    this.titler.remove(original);
    try {
      await this.saver.flush();
      if (sequence!==this.loadSequence || this.state.page?.id!==original.id) throw new Error('The page changed. Open it again before changing its lock.');
      const current=this.pageCache.get(original.id) ?? this.state.page;
      const page=await api.setPageEditLock(original.vault_id,original.id,current.revision,locked,password);
      if (sequence!==this.loadSequence) return;
      this.pageCache.set(page.id,page);
      if (this.state.page?.id===page.id) this.patch({page});
      this.titler.observe(page,true);
    } finally {this.pageLockPending=false;}
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
    const organization = await api.organize(vault.id, collection ? 'memberships' : 'locations', {kind: 'page', item_id: id, ...(collection ? {collection_id: collection, remove} : {folder_id: folder || null, remove})});
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
        memberships: organization.memberships.filter(item => item.kind !== 'page' || item.item_id !== id),
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
  addEntityAlias = async (id: string, alias: string) => {
    const vault = this.state.vault, sequence = this.loadSequence;
    if (!vault || vault.locked) throw new Error('Unlock the vault to add an alias.');
    const entity = await api.addEntityAlias(vault.id,id,alias);
    if (sequence === this.loadSequence && this.state.vault?.id === vault.id && !this.state.vault.locked) {
      this.patch({entities: this.state.entities.map(current => current.id === id ? entity : current)});
    }
  };
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
      if (result.schema) window.dispatchEvent(new CustomEvent('entity-schema-changed', {detail: {vault: page.vault_id, schema: result.schema}}));
      this.pageCache.set(page.id,result.page);
      this.patch({page:result.page,entities:result.entities,pages:this.state.pages.map(p => p.id === page.id ? result.page : p)});
      return result.scan;
    } finally {
      this.navigation = false;
      this.patch({reviewing:false});
      if (this.state.page) this.titler.observe(this.state.page,true);
    }
  }
  async refreshEntities(signal?:AbortSignal) {
    const vault = this.state.vault, sequence = this.loadSequence;
    if(!vault||vault.locked||signal?.aborted)return;
    const entities = await api.entities(vault.id,signal);
    if (!signal?.aborted&&sequence===this.loadSequence&&this.state.vault?.id===vault.id&&!this.state.vault.locked) this.patch({entities});
  }
  async previewVaultDeletion(id:string) {
    if(this.state.vault?.id!==id)throw new Error('The selected vault changed.');
    await this.saver.flush();
    return api.previewVaultDeletion(id);
  }
  async deleteVault(id:string,confirmation:import('../../shared/domain').VaultDeletionConfirmation) {
    let result:import('../../shared/domain').VaultDeletionResult|undefined;
    await this.navigate(async()=>{
      if(this.state.vault?.id!==id||this.state.vault.locked)throw new Error('Open and unlock this vault before deleting it.');
      this.titler.dispose();
      try{result=await api.deleteVault(id,confirmation);}catch(error){if(this.state.page){this.titler.register(this.state.page);this.titler.observe(this.state.page,true);}throw error;}
      ++this.loadSequence;this.pageCache.clear();
      this.patch({vaults:result.vaults,vault:null,page:null,pages:[],entities:[],trash:[],organization:{collections:[],folders:[],locations:[],memberships:[],favourites:[]},organizationContext:{collection:'',folder:''},recent:[],view:'organization',error:null});
      try{localStorage.removeItem('noema-address/'+id);localStorage.removeItem('noema-recent/'+id);localStorage.removeItem('noema-vault');}catch{/* Optional browser history. */}
    });
    if(!result)throw new Error('Another operation is in progress. Try again.');
    const remaining=result.vaults.find(vault=>!vault.locked)??result.vaults[0];
    if(remaining){try{await this.selectVault(remaining.id);}catch(error){this.report(error);}}
    return result;
  }
  async createVault(name: string) {
    await this.saver.flush(); const vault = await api.createVault(name); await this.selectVault(vault.id);
  }
  async exportVault() {
    const id=this.state.vault?.id;
    if(!id||this.state.vault?.locked)throw new Error('Unlock a vault before exporting it.');
    await this.saver.flush();
    return api.exportVault(id);
  }
  async importVault(file:File,name?:string) {
    await this.saver.flush();
    const vault=await api.importVault(file,name);
    await this.selectVault(vault.id);
  }
  async lock(passphrase?: string) {
    await this.saver.flush(); const id = this.state.vault!.id; await api.lock(id, passphrase); await this.selectVault(id);
  }
  async setPassphrase(currentPassphrase: string, passphrase: string | null) {
    const id = this.state.vault?.id;
    if (!id || this.state.vault?.locked) throw new Error('Open and unlock a vault before changing its passphrase.');
    await this.saver.flush();
    const vault = await api.setVaultPassphrase(id, currentPassphrase, passphrase);
    this.patch({vaults: this.state.vaults.map(item => item.id === id ? vault : item), ...(this.state.vault?.id === id ? {vault} : {})});
  }
  async unlock(passphrase: string) {
    const id = this.state.vault!.id; await api.unlock(id, passphrase); await this.selectVault(id);
  }
}
