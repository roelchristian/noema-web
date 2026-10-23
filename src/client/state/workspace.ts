import {immutableBlocks,immutablePage} from '../../shared/immutable-blocks';
import {citationSourceIds} from '../../shared/citations';
import { readWorkspaceURL, workspaceURL, type NavigationAddress, type WorkspaceAddress } from './navigation-address';
import {clearLibraryViewStates} from './library-view-state';
import {clearEntityDrafts, pruneEntityDrafts} from '../knowledge/entity-drafts';
import {pageDraftJournal, type PageDraftEntry} from './page-draft-journal';
import {nextPageAIStatus} from '../../shared/page-ai-status';
import {entityMentionName} from '../../shared/domain';
import {entitiesForPage} from '../../shared/concept-classification';
import { identifyEntityMentions } from '../../shared/auto-entities';
import { canIdentifyEntities, yieldForEntityMatching } from '../editor/auto-entity-matching';
import { PageTitler } from './page-titler';
import { api, ApiError } from '../api';
import type { Entity, EntityInput, Page, PageSummary, Vault, Organization, OrganizationContext, RecentItem, ItemKind, TrashedPage } from '../../shared/domain';
import { PageSaver, type SaveStatus } from './page-saver';
export interface PageSaveIssue {vaultId: string; pageId: string; title: string; message: string}
export interface PageDraftRecovery {vaultId: string; pageId: string; title: string; drafts: PageDraftEntry[]}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
const pageContent = (page: Page) => JSON.stringify(canonical({title:page.title,icon:page.icon??null,featuredImageId:page.featuredImageId??null,blocks:page.blocks,sourceIds:page.sourceIds,aiReviewAccepted:!!page.aiReviewAccepted}));
const applyDraft = (server: Page, draft: Page): Page => ({...server,title:draft.title,icon:draft.icon,featuredImageId:draft.featuredImageId,blocks:structuredClone(draft.blocks),sourceIds:[...draft.sourceIds],entityMatchCache:undefined,conceptContentHash:undefined});
export interface WorkspaceState {
  saveFailures: PageSaveIssue[]; draftStorageFailures: PageSaveIssue[]; draftRecoveries: PageDraftRecovery[];
  domainSavingPageId: string | null;
  canGoBack: boolean; canGoForward: boolean;
  entityPanelId: string | null;
  entityId: string | null;
  vaults: Vault[]; vault: Vault | null; trash: TrashedPage[]; pages: PageSummary[]; entities: Entity[];
  creationFocusPageId: string | null;
  initialEditingPageId: string | null;
  organization: Organization; organizationContext: OrganizationContext; recent: RecentItem[];
  sourceId: string | null; page: Page | null; view: 'review' | 'calendar' | 'entity' | 'source' | 'pages' | 'entities' | 'organization' | 'favourites' | 'recent' | 'trash' | 'inbox'; busy: boolean; loadingPageId: string | null; reviewing: boolean; error: string | null; saveStatus: SaveStatus;
}
export class Workspace {
  private state: WorkspaceState = {initialEditingPageId:null,creationFocusPageId:null,entityId:null,sourceId:null,domainSavingPageId:null,saveFailures: [], draftStorageFailures: [], draftRecoveries: [], entityPanelId: null, canGoBack: false, canGoForward: false, vaults: [], vault: null, trash: [], pages: [], entities: [], organization: {collections: [], folders: [], locations: [], memberships: [], favourites: []}, organizationContext: {collection: '', folder: ''}, recent: [], page: null, view: 'organization', busy: true, loadingPageId: null, reviewing: false, error: null, saveStatus: 'saved'};
  private browserAttached = false;
  private browserInitialized = false;
  private browserSession = '';
  private browserIndex = 0;
  private browserMaxIndex = 0;
  private browserRestoring = false;
  private pendingBrowserAddress: {address: WorkspaceAddress | null; index: number} | null = null;
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
    page => api.pageMetadata(page.vault_id, page.id),
    (original, title,pageDomains,metadata) => {
      const cached = this.pageCache.get(original.id);
      if (!cached || this.state.draftRecoveries.some(item=>item.vaultId===original.vault_id&&item.pageId===original.id) || cached.editLocked || cached.revision!==original.revision || this.pageLockPending || cached.vault_id !== original.vault_id || this.state.vault?.locked) return;
      const page = {...cached, title:cached.title===original.title?title:cached.title,...(metadata?{enrichmentPending:metadata.enrichmentPending,enrichmentPendingFields:metadata.enrichmentPendingFields,enrichmentFields:metadata.enrichmentFields,summaryContentHash:metadata.summaryContentHash,language:metadata.language}:{}),...(pageDomains && !(cached.pageDomains?.origin==='manual' && pageDomains.origin!=='manual') && pageDomains.revision>=(cached.pageDomains?.revision??0)?{pageDomains}:{})};
      const fields = (value:Page) => [value.title,value.pageDomains,value.enrichmentPending,value.enrichmentPendingFields,value.enrichmentFields,value.summaryContentHash,value.language];
      if(JSON.stringify(fields(page))===JSON.stringify(fields(cached)))return;
      this.pageCache.set(page.id, page);
      this.patch({pages: this.state.pages.map(item => item.id === page.id ? {...item, title:page.title} : item),
        ...(this.state.page?.id === page.id ? {page} : {})});
    },
    id => this.state.entities.find(entity => entity.id === id)?.name || '',
  );
  readonly saver = new PageSaver(
    page => api.savePage(page.vault_id, page.id, page),
    (saved, original) => {
      // A reload may have recovered a journal written by an earlier tab session.
      try {
        for (const entry of pageDraftJournal.entries(saved.vault_id,saved.id)) {
          if (entry.baseRevision <= original.revision && (pageContent(entry.snapshot) === pageContent(original) || pageContent(entry.snapshot) === pageContent(saved))) pageDraftJournal.acknowledge(entry,saved);
        }
      } catch (error) {this.report(error);}
      this.patch({saveFailures:this.state.saveFailures.filter(issue=>issue.vaultId!==saved.vault_id||issue.pageId!==saved.id)});
      const cached = this.pageCache.get(saved.id);
      if (cached) {
        const unchanged = cached.blocks === original.blocks;
        const page = {...cached, title:cached.title===original.title?saved.title:cached.title,titleEdited:cached.title===original.title?undefined:cached.titleEdited,enrichmentPending:saved.enrichmentPending,enrichmentPendingFields:saved.enrichmentPendingFields,enrichmentFields:saved.enrichmentFields,language:saved.language,aiReviewAccepted:!!(cached.aiReviewAccepted||saved.aiReviewAccepted), aiStatus:nextPageAIStatus(saved,cached,id=>entityMentionName(this.state.entities.find(entity=>entity.id===id))), ...(unchanged && !this.state.reviewing && canIdentifyEntities() ? {blocks: saved.blocks} : {}), pageDomains:saved.pageDomains,conceptClassification:saved.conceptClassification,conceptContentHash:unchanged?saved.conceptContentHash:undefined,revision: saved.revision, summaryContentHash: saved.summaryContentHash, updated_at: saved.updated_at};
        this.pageCache.set(saved.id, page);
        if(!this.pageLockPending)this.titler.observe(page, unchanged);
      }
      if (this.state.vault?.id === saved.vault_id) this.patch({pages: this.state.pages.map(page => page.id === saved.id ? {...page, title:this.pageCache.get(saved.id)?.title??page.title, aiStatus:this.pageCache.get(saved.id)?.aiStatus ?? saved.aiStatus, updated_at: saved.updated_at} : page), ...(this.state.page?.id === saved.id ? {page: this.pageCache.get(saved.id) || {...this.state.page, aiStatus:saved.aiStatus, pageDomains:saved.pageDomains,conceptClassification:saved.conceptClassification,conceptContentHash:this.state.page.blocks===original.blocks?saved.conceptContentHash:undefined,revision: saved.revision, summaryContentHash: saved.summaryContentHash, updated_at: saved.updated_at}} : {})});
    },
    (saveStatus, error, failed) => this.patch({saveStatus, ...(error ? {error: error.message} : {}), ...(error && failed ? {saveFailures:[...this.state.saveFailures.filter(issue=>issue.vaultId!==failed.vault_id||issue.pageId!==failed.id),{vaultId:failed.vault_id,pageId:failed.id,title:failed.title,message:error.message}]} : {})}),
    async page => {
      await yieldForEntityMatching();
      if (this.state.vault?.id !== page.vault_id || this.state.vault.locked || this.state.reviewing || !canIdentifyEntities()) return page;
      const {blocks} = identifyEntityMentions(page.blocks, entitiesForPage(page,this.state.entities), page.vault_id);
      return blocks === page.blocks ? page : {...page, blocks};
    },
    (error, page) => this.patch({draftStorageFailures:[...this.state.draftStorageFailures.filter(issue=>issue.vaultId!==page.vault_id||issue.pageId!==page.id),...(error?[{vaultId:page.vault_id,pageId:page.id,title:page.title,message:error.message}]:[])]}),
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
    if(patch.page) {
      patch.page=immutablePage(patch.page,patch.page.id===previous.page?.id?previous.page.blocks:undefined);
      this.pageCache.set(patch.page.id,patch.page);
      if(patch.page.id!==previous.page?.id || patch.page.vault_id!==previous.page?.vault_id || patch.page.revision!==previous.page?.revision)this.saver.prime(patch.page);
    }
    this.state = {...this.state, ...patch};
    // Only leaving this note ends its initial writing session; saves and metadata
    // updates replace page objects without reopening the editor.
    if(this.state.initialEditingPageId && (this.state.view!=='pages' ||
      this.state.page?.id!==this.state.initialEditingPageId || !this.state.vault ||
      this.state.vault.locked || this.state.vault.id!==previous.vault?.id)) {
      this.state={...this.state,initialEditingPageId:null};
    }
    if (this.state.view !== 'entity' || !this.state.vault || this.state.vault.locked) this.state = {...this.state, entityId:null};
    else {
      const entity = this.state.entities.find(entity => entity.id === this.state.entityId);
      if (!entity) this.state = {...this.state, view:'entities', entityId:null};
      else if (entity.type === 'source') this.state = {...this.state, view:'source', sourceId:entity.id, entityId:null};
    }
    if (this.state.view !== 'source' || !this.state.vault || this.state.vault.locked) this.state = {...this.state, sourceId:null};
    else if (!this.state.entities.some(entity => entity.id === this.state.sourceId && entity.type === 'source')) {
      this.state = {...this.state, view:'entities', sourceId:null};
    }
    if (!this.state.vault || this.state.vault.locked || this.state.vault.id !== previous.vault?.id ||
      this.state.view !== previous.view || this.state.view === 'entity' && this.state.entityId !== previous.entityId || this.state.view === 'source' && this.state.sourceId !== previous.sourceId || this.state.view === 'pages' && this.state.page?.id !== previous.page?.id ||
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
          sourceId: this.state.view === 'source' ? this.state.sourceId : null,
          subjectId: this.state.view === 'entity' ? this.state.entityId : null,
        }));
      } catch { /* Navigation still works when browser storage is unavailable. */ }
    }
    this.listeners.forEach(fn => fn());
  }
  attachBrowserNavigation() {
    this.browserAttached = true;
    this.browserSession = window.history.state?.noemaSession ?? window.crypto?.randomUUID?.() ?? String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    this.browserIndex = window.history.state?.noemaIndex ?? 0;
    this.browserMaxIndex = this.browserIndex;
    try {
      const maximum = Number(sessionStorage.getItem('noema-history/' + this.browserSession));
      if (Number.isSafeInteger(maximum)) this.browserMaxIndex = Math.max(this.browserIndex, maximum);
    } catch { /* Browser traversal still works without session storage. */ }
    window.history.replaceState({...window.history.state, noemaIndex:this.browserIndex, noemaSession:this.browserSession}, '', window.location.href);
    const pop = () => {
      this.pendingBrowserAddress = {address:readWorkspaceURL(), index:window.history.state?.noemaIndex ?? 0};
      this.cancelPageLoad();
      void this.restoreBrowserNavigation();
    };
    window.addEventListener('popstate', pop);
    return () => { this.browserAttached = false; window.removeEventListener('popstate', pop); };
  }
  private async restoreBrowserNavigation() {
    if (this.browserRestoring) return;
    this.browserRestoring = true;
    this.traversingHistory = true;
    this.patch({});
    try {
      while (this.pendingBrowserAddress && this.browserAttached) {
        // Finish writes and vault operations before applying a browser traversal.
        if (this.state.busy || this.state.reviewing || this.navigation) await new Promise<void>(resolve => {
          const unsubscribe = this.subscribe(() => {
            if (!this.state.busy && !this.state.reviewing && !this.navigation) { unsubscribe(); resolve(); }
          });
        });
        const target = this.pendingBrowserAddress;
        this.pendingBrowserAddress = null;
        this.browserIndex = target.index;
        this.browserMaxIndex = Math.max(this.browserMaxIndex, target.index);
        const address = target.address;
        if (address && address.vaultId !== this.state.vault?.id) await this.selectVault(address.vaultId, address);
        else if (!this.state.vault?.locked) await this.navigate(async () => {
          if (address) await this.restoreAddress(address);
          else this.patch({view:'organization', organizationContext:{collection:'',folder:''}});
        });
      }
    } catch (error) { this.report(error); }
    finally {
      this.browserRestoring = false;
      this.traversingHistory = false;
      // Canonicalize unavailable/deleted targets without adding another entry.
      this.browserInitialized = false;
      this.patch({});
    }
  }
  private syncBrowserNavigation(address: NavigationAddress) {
    if (!this.browserAttached || this.browserRestoring || this.traversingHistory || !this.state.vault || this.state.vault.locked || this.state.busy || this.state.loadingPageId !== null) return;
    const url = workspaceURL({...address, vaultId:this.state.vault.id});
    const changed = window.location.pathname + window.location.search !== url;
    if (!this.browserInitialized) {
      window.history.replaceState({...window.history.state, noemaIndex:this.browserIndex, noemaSession:this.browserSession}, '', url);
      this.browserInitialized = true;
    } else if (changed) {
      this.browserIndex++;
      this.browserMaxIndex = this.browserIndex;
      window.history.pushState({noemaIndex:this.browserIndex, noemaSession:this.browserSession}, '', url);
      try { sessionStorage.setItem('noema-history/' + this.browserSession, String(this.browserMaxIndex)); }
      catch { /* Forward availability can be rediscovered after reload. */ }
    }
  }
  private validAddress(address: NavigationAddress) {
    if (address.entityId && !this.state.entities.some(entity => entity.id === address.entityId)) return false;
    if (address.view === 'entity') return this.state.entities.some(entity => entity.id === address.subjectId && entity.type !== 'source');
    if (address.view === 'source') return this.state.entities.some(entity => entity.id === address.sourceId && entity.type === 'source');
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
      const address: NavigationAddress = {view: this.state.view, pageId: this.state.view === 'pages' ? this.state.page?.id ?? null : null,
          sourceId: this.state.view === 'source' ? this.state.sourceId : null, entityId: this.state.entityPanelId, subjectId: this.state.view === 'entity' ? this.state.entityId : null,
        collection: this.state.view === 'organization' ? this.state.organizationContext.collection : '',
        folder: this.state.view === 'organization' ? this.state.organizationContext.folder : ''};
      if (this.validAddress(address) && JSON.stringify(address) !== JSON.stringify(this.history[this.historyIndex])) {
        this.history = [...this.history.slice(0, this.historyIndex + 1), address];
        this.historyIndex = this.history.length - 1;
      }
    }
    if (vaultId && !this.state.busy && this.state.loadingPageId === null) this.syncBrowserNavigation({
      view:this.state.view, pageId:this.state.view === 'pages' ? this.state.page?.id ?? null : null, sourceId:this.state.view === 'source' ? this.state.sourceId : null, entityId:this.state.entityPanelId, subjectId:this.state.view === 'entity' ? this.state.entityId : null,
      collection:this.state.view === 'organization' ? this.state.organizationContext.collection : '',
      folder:this.state.view === 'organization' ? this.state.organizationContext.folder : '',
    });
    this.state = {...this.state,
      canGoBack: !this.traversingHistory && (this.browserAttached ? this.browserIndex > 0 : this.history.slice(0, this.historyIndex).some(address => this.validAddress(address))),
      canGoForward: !this.traversingHistory && (this.browserAttached ? this.browserIndex < this.browserMaxIndex : this.history.slice(this.historyIndex + 1).some(address => this.validAddress(address)))};
  }
  async goHistory(direction: -1 | 1) {
    if (this.traversingHistory || this.state.busy || this.state.reviewing || this.state.loadingPageId !== null || !this.state.vault || this.state.vault.locked) return;
    if (this.browserAttached) { window.history.go(direction); return; }
    let index = this.historyIndex + direction;
    while (index >= 0 && index < this.history.length && !this.validAddress(this.history[index]!)) index += direction;
    const address = this.history[index];
    if (!address) return;
    this.traversingHistory = true;
    this.patch({});
    try {
      const sameView = this.state.view === address.view && (address.view === 'pages' ? this.state.page?.id === address.pageId : address.view === 'source' ? this.state.sourceId === address.sourceId : address.view === 'entity' ? this.state.entityId === address.subjectId :
        address.view !== 'organization' || this.state.organizationContext.collection === address.collection && this.state.organizationContext.folder === address.folder);
      if (!sameView && address.view === 'pages') await this.openPage(address.pageId!);
      else if (!sameView && address.view === 'entity') await this.openEntityHome(address.subjectId!);
      else if (!sameView && address.view === 'source') await this.openSource(address.sourceId!);
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
  private async restoreAddress(requested?: WorkspaceAddress) {
    const {vault, organization, pages} = this.state;
    if (!vault || vault.locked) return;
    let stored: Record<string, unknown>;
    const urlAddress = requested ?? (this.browserAttached ? readWorkspaceURL() : null);
    const explicit = urlAddress?.vaultId === vault.id ? urlAddress : null;
    try {
      const value: unknown = explicit ?? JSON.parse(localStorage.getItem('noema-address/' + vault.id) || 'null');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      stored = value as Record<string, unknown>;
    } catch { return; }
    if (typeof stored.view !== 'string' || !['review', 'calendar', 'pages', 'source', 'entity', 'organization', 'entities', 'favourites', 'recent', 'trash', 'inbox'].includes(stored.view)) return;
    const collection = organization.collections.some(item => item.id === stored.collection) ? String(stored.collection) : '';
    const folder = !collection && organization.folders.some(item => item.id === stored.folder) ? String(stored.folder) : '';
    this.patch({organizationContext: {collection, folder}, entityPanelId:null});
    if (stored.view === 'entity') {
      const entity = this.state.entities.find(entity => entity.id === stored.subjectId);
      if (entity) this.patch(entity.type === 'source' ? {view:'source',sourceId:entity.id} : {view:'entity',entityId:entity.id});
      else {
        this.patch({view:'entities'});
        if (explicit) this.report(new Error('This entity is unavailable. It may have been deleted.'));
      }
      if (typeof stored.entityId === 'string' && this.state.entities.some(entity => entity.id === stored.entityId)) this.patch({entityPanelId:stored.entityId});
      return;
    }
    if (stored.view === 'source') {
      if (typeof stored.sourceId === 'string' && this.state.entities.some(entity => entity.id === stored.sourceId && entity.type === 'source')) {
        this.patch({view:'source',sourceId:stored.sourceId});
        if (typeof stored.entityId === 'string' && this.state.entities.some(entity => entity.id === stored.entityId)) this.patch({entityPanelId:stored.entityId});
      } else {
        this.patch({view:'entities'});
        if (explicit) this.report(new Error('This source is unavailable. It may have been deleted.'));
      }
      return;
    }
    if (stored.view === 'pages') {
      if (typeof stored.pageId === 'string' && pages.some(page => page.id === stored.pageId)) {
        const cached = this.pageCache.get(stored.pageId);
        if (cached?.vault_id === vault.id) this.patch({page:cached, view:'pages'});
        else await this.loadPage(stored.pageId, false);
      }
      else {
        this.patch({view:'organization', organizationContext: {collection: '', folder: ''}});
        if (explicit) this.report(new Error('This page is unavailable. It may have been moved to Trash or deleted.'));
      }
      if (typeof stored.entityId === 'string' && this.state.entities.some(entity => entity.id === stored.entityId)) this.patch({entityPanelId:stored.entityId});
      return;
    }
    if (stored.view === 'trash') this.patch({trash: await api.trash(vault.id)});
    this.patch({view: stored.view as WorkspaceState['view']});
    if (typeof stored.entityId === 'string' && this.state.entities.some(entity => entity.id === stored.entityId)) this.patch({entityPanelId:stored.entityId});
  }
  report = (error: unknown) => this.patch({error: error instanceof Error ? error.message : String(error)});
  dismissError = () => this.patch({error: null});
  async init() {
    try {
      const vaults = await api.vaults(); this.patch({vaults});
      try {pageDraftJournal.pruneVaults(new Set(vaults.map(item=>item.id)));} catch (error) {this.report(error);}
      for (const item of vaults) if(item.locked) this.clearVaultDrafts(item.id);
      let remembered: string | null = null;
      try { remembered = localStorage.getItem('noema-vault'); } catch { /* Storage may be disabled. */ }
      const requested = this.browserAttached ? readWorkspaceURL() : null;
      const selected=vaults.find(v=>v.id===requested?.vaultId)??vaults.find(v=>v.id===remembered)??vaults[0];
      if (requested && !vaults.some(v=>v.id===requested.vaultId)) this.report(new Error('The linked vault is unavailable.'));
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
    this.navigation = true; this.patch({busy: true, creationFocusPageId:null});
    try { await this.saver.flush(); await work(); }
    finally { this.navigation = false; this.patch({busy: false}); }
  }
  async selectVault(id: string, address?: WorkspaceAddress) {
    await this.navigate(async () => {
      const vaults = await api.vaults(), vault = vaults.find(v => v.id === id);
      if (!vault) throw new Error('Vault not found');
      try {pageDraftJournal.pruneVaults(new Set(vaults.map(item=>item.id)));} catch (error) {this.report(error);}
      for (const item of vaults) if (item.locked) this.clearVaultDrafts(item.id);
      ++this.loadSequence;
      this.titler.dispose(); this.pageCache.clear(); this.patch({vaults, vault, trash: [], pages: [], entities: [], organization: {collections: [], folders: [], locations: [], memberships: [], favourites: []}, organizationContext: {collection: '', folder: ''}, recent: [], page: null, view: 'organization', error: null});
      try { localStorage.setItem('noema-vault', id); } catch { /* The app can work without browser storage. */ }
      if (vault.locked) {this.clearVaultDrafts(id); return;}
      const [pages, entities, organization] = await Promise.all([api.pages(id), api.entities(id), api.organization(id)]);
      let recent: RecentItem[] = [];
      try {
        const stored: unknown = JSON.parse(localStorage.getItem('noema-recent/' + id) || '[]');
        if (Array.isArray(stored)) recent = stored.filter((item): item is RecentItem => !!item && typeof item === 'object' && (item.kind === 'page' || item.kind === 'entity') && typeof item.item_id === 'string' && typeof item.opened_at === 'string').slice(0, 50);
      } catch { /* Recent history is optional when storage is unavailable. */ }
      try {pageDraftJournal.pruneVault(id,new Set(pages.map(page=>page.id)));} catch (error) {this.report(error);}
      pruneEntityDrafts(id,entities.map(entity=>entity.id));
      this.patch({pages, entities, organization, recent});
      await this.restoreAddress(address);
    });
  }
  private recoverPage(server: Page): Page {
    const entries = pageDraftJournal.entries(server.vault_id,server.id);
    const candidates: PageDraftEntry[] = [], unresolved: PageDraftEntry[] = [];
    for (const entry of entries) {
      if (server.revision >= entry.baseRevision && pageContent(server) === pageContent(entry.snapshot)) {
        try {pageDraftJournal.acknowledge(entry,server);} catch (error) {this.report(error);} continue;
      }
      const sent = entry.lastSent;
      const acknowledged = sent && server.revision === sent.revision + 1 && pageContent(server) === pageContent(sent);
      if (!server.editLocked && (entry.baseRevision === server.revision || acknowledged)) candidates.push(entry);
      else unresolved.push(entry);
    }
    const distinct = new Set(candidates.map(entry=>pageContent(entry.snapshot)));
    const remaining = [...candidates,...unresolved];
    this.patch({draftRecoveries:[...this.state.draftRecoveries.filter(item=>item.vaultId!==server.vault_id||item.pageId!==server.id),...(remaining.length && (unresolved.length || distinct.size!==1)?[{vaultId:server.vault_id,pageId:server.id,title:server.title,drafts:remaining}]:[])]});
    if (!unresolved.length && distinct.size === 1) {
      const draft = applyDraft(server,candidates.sort((a,b)=>b.updatedAt-a.updatedAt)[0]!.snapshot);
      this.saver.enqueue(draft);
      return draft;
    }
    return server;
  }
  async restorePageDraft(entry: PageDraftEntry) {
    const vault = this.state.vault, sequence = this.loadSequence;
    if (!vault || vault.locked || vault.id!==entry.vaultId || this.state.page?.id!==entry.pageId) return;
    // An unrelated failed page cannot block an explicit recovery. A conflict
    // on this page is resolved by the freshly fetched revision below.
    if (this.saver.pendingPage(vault.id,entry.pageId)) await this.saver.retry(vault.id,entry.pageId).catch(()=>{});
    const displayed = this.state.page;
    const server = await api.page(vault.id,entry.pageId);
    if (sequence!==this.loadSequence || this.state.vault?.locked || this.state.page?.id!==entry.pageId) throw new Error('The selected page changed. Open the draft review again.');
    if (this.state.page!==displayed) throw new Error('The page changed while reviewing the draft. Review it again before restoring.');
    if (server.editLocked) throw new Error('Unlock this page before restoring its draft.');
    const recovery = this.state.draftRecoveries.find(item=>item.vaultId===vault.id&&item.pageId===entry.pageId);
    const retained = recovery?.drafts.filter(draft=>draft.id!==entry.id).map(draft=>draft.writerId===pageDraftJournal.writerId?pageDraftJournal.retain(draft):draft) ?? [];
    const page = applyDraft(server,entry.snapshot);
    this.pageCache.set(page.id,page);
    this.patch({page,pages:this.state.pages.map(item=>item.id===page.id?{...item,title:page.title,icon:page.icon,featuredImageId:page.featuredImageId}:item),draftRecoveries:this.state.draftRecoveries.map(item=>item.vaultId===vault.id&&item.pageId===page.id?{...item,drafts:retained}:item).filter(item=>item.drafts.length)});
    if (typeof document!=='undefined') document.dispatchEvent(new CustomEvent('noema:document-replaced',{detail:page}));
    this.saver.enqueue(page);
  }
  async discardPageDrafts(vaultId: string, pageId: string) {
    const recovery = this.state.draftRecoveries.find(item=>item.vaultId===vaultId&&item.pageId===pageId);
    if (!recovery || this.state.vault?.locked || this.state.vault?.id!==vaultId) return;
    const pending = this.saver.pendingPage(vaultId,pageId);
    if (pending && recovery.drafts.some(entry=>entry.writerId===pageDraftJournal.writerId&&entry.baseRevision===pending.revision&&pageContent(entry.snapshot)===pageContent(pending))) {
      const server = await api.page(vaultId,pageId);
      if (this.state.vault?.id!==vaultId||this.state.vault.locked) throw new Error('The selected vault changed.');
      const current = this.saver.pendingPage(vaultId,pageId);
      if (!current || current.revision!==pending.revision || pageContent(current)!==pageContent(pending)) throw new Error('The draft changed. Review it again before discarding.');
      // Cancel the failed generation as well as its journal; it must never be
      // resurrected by Retry or a later edit after the user discards it.
      const activeEntries = pageDraftJournal.entries(vaultId,pageId).filter(entry=>entry.writerId===pageDraftJournal.writerId&&entry.baseRevision===current.revision&&pageContent(entry.snapshot)===pageContent(current));
      this.saver.discard(vaultId,pageId,false);
      for (const entry of activeEntries) pageDraftJournal.discard(entry);
      this.pageCache.set(pageId,server);
      this.patch({...(this.state.page?.id===pageId?{page:server}:{}),pages:this.state.pages.map(item=>item.id===pageId?server:item),saveFailures:this.state.saveFailures.filter(issue=>issue.vaultId!==vaultId||issue.pageId!==pageId),draftStorageFailures:this.state.draftStorageFailures.filter(issue=>issue.vaultId!==vaultId||issue.pageId!==pageId)});
      if (typeof document!=='undefined') document.dispatchEvent(new CustomEvent('noema:document-replaced',{detail:server}));
    }
    for (const entry of recovery.drafts) pageDraftJournal.discard(entry);
    this.patch({draftRecoveries:this.state.draftRecoveries.filter(item=>item!==recovery)});
  }
  retryPageSave = async (vaultId: string, pageId: string) => {
    if(this.state.vault?.id!==vaultId||this.state.vault.locked)return;
    const pending = this.saver.pendingPage(vaultId,pageId);
    if (!pending) return;
    const server = await api.page(vaultId,pageId);
    if(this.state.vault?.id!==vaultId||this.state.vault.locked)return;
    // A successful PUT may have lost its response while the connection dropped.
    // Rebase only when its exact payload is confirmed on the server.
    if (server.revision!==pending.revision) {
      const entries = pageDraftJournal.entries(vaultId,pageId);
      const knownSave = pageContent(server)===pageContent(pending) || entries.some(entry=>entry.writerId===pageDraftJournal.writerId&&entry.baseRevision===pending.revision&&pageContent(entry.snapshot)===pageContent(pending)&&entry.lastSent&&server.revision===entry.lastSent.revision+1&&pageContent(server)===pageContent(entry.lastSent));
      if (knownSave && !server.editLocked) {
        const current = this.saver.pendingPage(vaultId,pageId);
        if (!current) return;
        if (current.revision>server.revision) return this.saver.retry(vaultId,pageId);
        const cached = this.pageCache.get(pageId);
        if (cached?.vault_id===vaultId) {
          const rebased = {...cached,revision:server.revision}; this.pageCache.set(pageId,rebased);
          if (this.state.page?.id===pageId) this.patch({page:rebased});
        }
        this.saver.enqueue({...current,revision:server.revision});
      } else {
        if (entries.length) this.patch({draftRecoveries:[...this.state.draftRecoveries.filter(item=>item.vaultId!==vaultId||item.pageId!==pageId),{vaultId,pageId,title:server.title,drafts:entries}]});
        throw new Error(server.editLocked?'Unlock this page before saving the unfinished draft.':'The saved page has changed. Review the recovered draft before restoring it.');
      }
    }
    await this.saver.retry(vaultId,pageId);
  };
  pageSaveStatus = (vaultId: string, pageId: string): SaveStatus => this.saver.statusFor(vaultId,pageId);
  private clearVaultDrafts(vaultId: string) {
    try {pageDraftJournal.discardVault(vaultId);} catch (error) {this.report(error);}
    clearEntityDrafts(vaultId); clearLibraryViewStates(vaultId);
    this.patch({saveFailures:this.state.saveFailures.filter(item=>item.vaultId!==vaultId),draftStorageFailures:this.state.draftStorageFailures.filter(item=>item.vaultId!==vaultId),draftRecoveries:this.state.draftRecoveries.filter(item=>item.vaultId!==vaultId)});
  }
  private async loadPage(id: string, recordRecent = true) {
    const vault = this.state.vault!;
    // Fetch the body and its current review cache together before mounting the editor.
    const page = this.recoverPage(await api.page(vault.id, id));
    this.pageCache.set(id, page); this.patch({page, view: 'pages'});
    if (recordRecent) this.recordRecent('page', id);
    this.titler.register(page); this.titler.observe(page, true);
  }
  async openPage(id: string, options: {fresh?:boolean} = {}) {
    const vault = this.state.vault;
    if (!vault || vault.locked || this.state.busy || this.state.reviewing || this.navigation && this.state.loadingPageId === null) return;
    // Re-selecting the displayed page should preserve its editor and selection.
    if (!options.fresh && this.state.view === 'pages' && this.state.page?.id === id) {this.cancelPageLoad(); return;}
    this.pageRequest?.abort();
    const sequence = ++this.pageLoadSequence, controller = new AbortController();
    this.pageRequest = controller; this.navigation = true;
    const current = () => sequence === this.pageLoadSequence && this.state.vault?.id === vault.id && !this.state.vault.locked;
    const cached = this.pageCache.get(id);
    if (!options.fresh && cached?.vault_id === vault.id && this.state.pages.some(page => page.id === id)) {
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
      const server = await api.page(vault.id,id,controller.signal);
      if (!current()) return;
      const page = this.recoverPage(server);
      this.pageCache.set(id,page); this.patch({page,view:'pages',loadingPageId:null,...(!this.state.pages.some(item=>item.id===id)?{pages:[page,...this.state.pages]}:{})});
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
  async openEntityHome(id: string) {
    const vault = this.state.vault;
    const entity = this.state.entities.find(entity => entity.id === id);
    if (!vault || vault.locked || !entity || this.state.busy || this.state.reviewing || this.pageLockPending) return;
    if (entity.type === 'source') return this.openSource(id);
    if (this.state.view === 'entity' && this.state.entityId === id) { this.closeEntity(); return; }
    await this.navigate(async () => {
      if (this.state.vault?.id !== vault.id || this.state.vault.locked || !this.state.entities.some(entity => entity.id === id)) return;
      this.patch({view:'entity',entityId:id,entityPanelId:null,error:null});
      this.recordRecent('entity',id);
    });
  }
  async openSource(id: string) {
    const vault = this.state.vault;
    if (!vault || vault.locked || this.state.busy || this.state.reviewing || this.pageLockPending ||
      !this.state.entities.some(entity => entity.id === id && entity.type === 'source')) return;
    if (this.state.view === 'source' && this.state.sourceId === id) return;
    // Keep the outgoing note and its journal intact until pending writes finish.
    await this.navigate(async () => {
      if (this.state.vault?.id !== vault.id || this.state.vault.locked ||
        !this.state.entities.some(entity => entity.id === id && entity.type === 'source')) return;
      this.patch({view:'source',sourceId:id,error:null});
      this.recordRecent('entity',id);
    });
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
  updatePage(patch: Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds' | 'icon' | 'featuredImageId' | 'aiReviewAccepted'>>) {
    const current = this.state.page;
    if (this.state.view !== 'pages' || !current || current.editLocked || this.pageLockPending || this.state.busy || this.state.loadingPageId !== null || this.state.reviewing || this.state.vault?.locked) return;
    const page = {...current, ...patch,...(patch.title!==undefined&&patch.title!==current.title?{titleEdited:true}:{}),aiReviewAccepted:!!(current.aiReviewAccepted||patch.aiReviewAccepted),...(patch.blocks&&patch.blocks!==current.blocks?{conceptContentHash:undefined}:{})};
    page.blocks=immutableBlocks(page.blocks,current.blocks);
    page.sourceIds=[...new Set([...page.sourceIds,...citationSourceIds(page.blocks)])];
    page.aiStatus=nextPageAIStatus(current,page,id=>entityMentionName(this.state.entities.find(entity=>entity.id===id)));
    if(page.featuredImageId && !page.blocks.some(block=>block.type==='image' && block.imageId===page.featuredImageId))page.featuredImageId=null;
    this.pageCache.set(page.id, page);
    this.patch({page, pages: this.state.pages.map(p => p.id === page.id ? {...p, title: page.title, icon: page.icon, featuredImageId: page.featuredImageId, aiStatus:page.aiStatus,aiReviewAccepted:page.aiReviewAccepted} : p)});
    this.titler.observe(page);
    this.saver.enqueue(page);
  }
  async setPageDomains(primaryDomainId:string|null,secondaryDomainIds:string[]) {
    const original=this.state.page,sequence=this.loadSequence;
    if(!original||original.editLocked||this.pageLockPending||this.state.vault?.locked)return;
    this.pageLockPending=true;
    this.patch({domainSavingPageId:original.id});
    this.titler.remove(original);
    try {
      await this.saver.flush();
      if(sequence!==this.loadSequence||this.state.page?.id!==original.id)throw new Error('The page changed. Open it again before editing subjects.');
      const current=this.pageCache.get(original.id)??this.state.page;
      this.titler.remove(current);
      const page=await api.setPageDomains(original.vault_id,original.id,current.revision,primaryDomainId,secondaryDomainIds);
      if(sequence!==this.loadSequence)return;
      this.pageCache.set(page.id,page);
      if(this.state.page?.id===page.id)this.patch({page});
      this.titler.remove(page);
      // A domain edit does not schedule title generation or embeddings.
    } finally {this.pageLockPending=false;this.patch({domainSavingPageId:null});}
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
  registerGeneratedPage(page:Page) {
    if(this.state.vault?.id!==page.vault_id||this.state.vault.locked)return;
    this.pageCache.set(page.id,page);
    this.patch({pages:[page,...this.state.pages.filter(item=>item.id!==page.id)]});
    if(page.readingNote) {
      const sequence=this.loadSequence;
      void api.organization(page.vault_id).then(organization=>{
        if(sequence===this.loadSequence&&this.state.vault?.id===page.vault_id&&!this.state.vault.locked)this.setOrganization(organization);
      }).catch(error=>{if(sequence===this.loadSequence)this.report(error);});
    }
  }
  consumeCreationFocus = (id:string) => {
    if(this.state.creationFocusPageId===id)this.patch({creationFocusPageId:null});
  };
  async newPage() {
    // Capture before navigation flushes pending edits or changes the visible view.
    const destination=this.state.view==='organization'?{...this.state.organizationContext}:{collection:'',folder:''};
    await this.navigate(async () => {
      const vault = this.state.vault!; const page = await api.createPage(vault.id,destination);
      this.titler.register(page);
      this.pageCache.set(page.id, page); this.patch({page, initialEditingPageId:page.id, creationFocusPageId:page.id, pages: [page, ...this.state.pages], view: 'pages',
        organization:{...this.state.organization,
          locations:destination.folder?[...this.state.organization.locations,{kind:'page',item_id:page.id,folder_id:destination.folder}]:this.state.organization.locations,
          memberships:destination.collection?[...this.state.organization.memberships,{kind:'page',item_id:page.id,collection_id:destination.collection}]:this.state.organization.memberships}}); this.recordRecent('page', page.id);
    });
  }
  refreshTrash = async () => {
    const vault = this.state.vault, sequence = this.loadSequence;
    if (!vault || vault.locked) return;
    const trash = await api.trash(vault.id);
    if (sequence === this.loadSequence && this.state.view === 'trash') this.patch({trash});
  };
  async showReview() {
    await this.navigate(async()=>{
      if(this.state.vault&&!this.state.vault.locked)this.patch({view:'review',entityPanelId:null});
    });
  }
  async showCalendar() {
    await this.navigate(async()=>{
      if(this.state.vault&&!this.state.vault.locked)this.patch({view:'calendar',entityPanelId:null});
    });
  }
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
      const saved = await api.savePage(vault.id,id,{...original,title,titleEdited:true});
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
      try {this.saver.discard(vault.id,id);} catch (error) {this.report(error);}
      this.patch({saveFailures:this.state.saveFailures.filter(issue=>issue.vaultId!==vault.id||issue.pageId!==id),draftStorageFailures:this.state.draftStorageFailures.filter(issue=>issue.vaultId!==vault.id||issue.pageId!==id),draftRecoveries:this.state.draftRecoveries.filter(item=>item.vaultId!==vault.id||item.pageId!==id)});
      this.pageCache.delete(id);
      const pages = this.state.pages.filter(p => p.id !== id);
      this.patch({pages, page: page?.id === id ? null : page, organization: {...organization,
        locations: organization.locations.filter(item => item.kind !== 'page' || item.item_id !== id),
        memberships: organization.memberships.filter(item => item.kind !== 'page' || item.item_id !== id),
        favourites: organization.favourites.filter(item => item.kind !== 'page' || item.item_id !== id),
      }});
      if (page?.id === id && pages[0]) await this.loadPage(pages[0].id);
      try { this.setOrganization(await api.organization(vault.id)); } catch (error) { this.report(error); }
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
    await this.changeTrashedPages([id], 'delete');
  }
  async restorePages(ids: string[]) {
    await this.changeTrashedPages(ids, 'restore');
  }
  async permanentlyDeletePages(ids: string[]) {
    await this.changeTrashedPages(ids, 'delete');
  }
  private async changeTrashedPages(ids: string[], action: 'restore' | 'delete') {
    await this.navigate(async () => {
      const vault = this.state.vault; if (!vault || vault.locked) return;
      const errors: unknown[] = [];
      for (const id of new Set(ids)) {
        try {
          if (action === 'restore') {
            const restored = await api.restorePage(vault.id, id);
            this.pageCache.set(id, restored);
            this.patch({pages: [restored, ...this.state.pages.filter(note => note.id !== id)]});
          } else {
            await api.permanentlyDeletePage(vault.id, id);
            try {this.saver.discard(vault.id,id);} catch (error) {this.report(error);}
            this.patch({saveFailures:this.state.saveFailures.filter(issue=>issue.vaultId!==vault.id||issue.pageId!==id),draftStorageFailures:this.state.draftStorageFailures.filter(issue=>issue.vaultId!==vault.id||issue.pageId!==id),draftRecoveries:this.state.draftRecoveries.filter(item=>item.vaultId!==vault.id||item.pageId!==id)});
            this.pageCache.delete(id);
          }
          this.patch({trash: this.state.trash.filter(note => note.id !== id)});
        } catch (error) { errors.push(error); }
      }
      if (action === 'restore') {
        try { this.setOrganization(await api.organization(vault.id)); } catch (error) { this.report(error); }
      }
      if (errors.length) throw new Error(`${errors.length} ${errors.length === 1 ? 'note' : 'notes'} could not be ${action === 'restore' ? 'restored' : 'deleted'}. ${errors[0] instanceof Error ? errors[0].message : String(errors[0])}`);
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
  refreshInbox = async () => {
    const vault=this.state.vault, sequence=this.loadSequence;
    if(!vault||vault.locked)return;
    const [pages,organization]=await Promise.all([api.pages(vault.id),api.organization(vault.id)]);
    if(sequence===this.loadSequence&&this.state.vault?.id===vault.id&&!this.state.vault.locked) {
      this.patch({pages});this.setOrganization(organization);
    }
  };
  async refreshEntities(signal?:AbortSignal) {
    const vault = this.state.vault, sequence = this.loadSequence;
    if(!vault||vault.locked||signal?.aborted)return;
    const entities = await api.entities(vault.id,signal);
    if (!signal?.aborted&&sequence===this.loadSequence&&this.state.vault?.id===vault.id&&!this.state.vault.locked) {this.pageCache.clear();pruneEntityDrafts(vault.id,entities.map(entity=>entity.id));this.patch({entities});}
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
      this.clearVaultDrafts(id);
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
    await this.saver.flush(); const id = this.state.vault!.id; const locked = await api.lock(id, passphrase);
    this.pageCache.clear(); this.titler.dispose(); this.patch({vault:locked,page:null,pages:[],entities:[]});
    this.clearVaultDrafts(id); await this.selectVault(id);
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
