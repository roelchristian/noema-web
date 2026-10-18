import {blockTypes, type Page} from '../../shared/domain';
import {isSemanticKind} from '../../shared/semantic-blocks';
import {pageIcons} from '../../shared/page-icons';

export interface PageDraftEntry {
  version: 1; id: string; writerId: string; vaultId: string; pageId: string;
  baseRevision: number; updatedAt: number; snapshot: Page; lastSent?: Page;
}
const prefix = 'noema:page-draft:v1:';
const uniqueId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clone = <T,>(value: T): T => structuredClone(value);
const storageKey = (entry: PageDraftEntry) => `${prefix}${encodeURIComponent(entry.vaultId)}:${encodeURIComponent(entry.pageId)}:${entry.writerId}:${entry.baseRevision}`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const natural = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const optionalText = (value: unknown) => value === undefined || typeof value === 'string';
function segments(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 1000 && value.every(segment => record(segment) && (
    identifier(segment.entityId) ? segment.text === undefined && optionalText(segment.mentionText) : typeof segment.text === 'string' && segment.entityId === undefined && segment.mentionText === undefined
  ) && ['bold','italic','underline','strike','code','math','skipAutoTag'].every(mark => segment[mark] === undefined || typeof segment[mark] === 'boolean') && optionalText(segment.href));
}
function validBlock(value: unknown): boolean {
  if (!record(value) || !identifier(value.id) || !blockTypes.some(type => type === value.type) || typeof value.checked !== 'boolean' || !segments(value.content)) return false;
  if (value.rows !== undefined && (!Array.isArray(value.rows) || !value.rows.every(row => Array.isArray(row) && row.every(segments)))) return false;
  if (value.type === 'table' && (!Array.isArray(value.rows) || !value.rows.length || value.rows.length > 100 || !Array.isArray(value.rows[0]) || !value.rows[0].length || value.rows[0].length > 20 || value.rows.some(row => !Array.isArray(row) || row.length !== (value.rows as unknown[][])[0]!.length))) return false;
  if (value.type === 'columns' && (!Array.isArray(value.rows) || value.rows.length !== 1 || !Array.isArray(value.rows[0]) || value.rows[0].length !== 2)) return false;
  if (value.type === 'image' && !identifier(value.imageId)) return false;
  if (value.column !== undefined && (!record(value.column) || !identifier(value.column.id) || value.column.index !== 0 && value.column.index !== 1 || value.type === 'columns' || value.type === 'table')) return false;
  if (value.semantic !== undefined && !isSemanticKind(value.semantic)) return false;
  if (value.semanticGroup !== undefined) {
    const group = value.semanticGroup;
    if (!record(group) || !identifier(group.id) || !isSemanticKind(group.kind)) return false;
    if (group.source !== undefined && (!record(group.source) || !Array.isArray(group.source.blockIds) || !group.source.blockIds.every(identifier) || typeof group.source.excerpt !== 'string')) return false;
  }
  return (value.imageId === undefined || identifier(value.imageId)) && optionalText(value.alt);
}
function validPage(value: unknown): value is Page {
  if (!record(value) || !identifier(value.id) || !identifier(value.vault_id) || !natural(value.revision) || typeof value.title !== 'string' || typeof value.updated_at !== 'string' || !Array.isArray(value.blocks) || value.blocks.length > 2000 || !value.blocks.every(validBlock) || !Array.isArray(value.sourceIds) || value.sourceIds.length > 1000 || !value.sourceIds.every(identifier)) return false;
  if (new Set(value.blocks.map(block => block.id)).size !== value.blocks.length) return false;
  if (value.icon !== undefined && value.icon !== null && !pageIcons.some(icon => icon.id === value.icon)) return false;
  return value.featuredImageId === undefined || value.featuredImageId === null || identifier(value.featuredImageId);
}
function minimalPage(page: Page): Page {
  return clone({id: page.id, vault_id: page.vault_id, title: page.title, blocks: page.blocks, sourceIds: page.sourceIds, revision: page.revision, updated_at: page.updated_at, icon: page.icon ?? null, featuredImageId: page.featuredImageId ?? null});
}
function parse(value: string | null): PageDraftEntry | null {
  if (!value) return null;
  try {
    const entry: unknown = JSON.parse(value);
    if (!record(entry) || entry.version !== 1 || !identifier(entry.id) || !identifier(entry.writerId) || !identifier(entry.vaultId) || !identifier(entry.pageId) || !natural(entry.updatedAt) || !natural(entry.baseRevision) || !validPage(entry.snapshot) || entry.snapshot.id !== entry.pageId || entry.snapshot.vault_id !== entry.vaultId || entry.snapshot.revision !== entry.baseRevision) return null;
    if (entry.lastSent !== undefined && (!validPage(entry.lastSent) || entry.lastSent.id !== entry.pageId || entry.lastSent.vault_id !== entry.vaultId)) return null;
    return {version: 1, id: entry.id, writerId: entry.writerId, vaultId: entry.vaultId, pageId: entry.pageId, baseRevision: entry.baseRevision, updatedAt: entry.updatedAt, snapshot: minimalPage(entry.snapshot), ...(entry.lastSent ? {lastSent: minimalPage(entry.lastSent as Page)} : {})};
  } catch {return null;}
}

/** Writer-owned slots keep an acknowledgement from erasing later edits or
 * another tab's draft. Applying snapshots requires a workspace revision check. */
export class PageDraftJournal {
  readonly writerId = uniqueId();
  private memory = new Map<string, PageDraftEntry>();
  private lastTimestamp = 0;
  constructor(private readonly providedStorage?: Storage | null) {}
  private storage(): Storage | null {
    if (this.providedStorage !== undefined) return this.providedStorage;
    return typeof localStorage === 'undefined' ? null : localStorage;
  }
  private all(): Map<string, PageDraftEntry> {
    const found = new Map<string, PageDraftEntry>();
    try {
      const storage = this.storage();
      if (storage) for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(prefix)) continue;
        const entry = parse(storage.getItem(key));
        if (entry && storageKey(entry) === key) found.set(key, entry);
      }
    } catch { /* In-memory drafts remain usable when storage access is denied. */ }
    for (const [key, entry] of this.memory) found.set(key, entry);
    return found;
  }
  entries(vaultId: string, pageId: string): PageDraftEntry[] {
    return [...this.all().values()].filter(entry => entry.vaultId === vaultId && entry.pageId === pageId).sort((a,b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id)).map(clone);
  }
  write(page: Page): PageDraftEntry {
    const previous = this.entries(page.vault_id, page.id).find(entry => entry.writerId === this.writerId);
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    const entry: PageDraftEntry = {version: 1, id: uniqueId(), writerId: this.writerId, vaultId: page.vault_id, pageId: page.id, baseRevision: page.revision, updatedAt: this.lastTimestamp, snapshot: minimalPage(page), ...(previous?.lastSent ? {lastSent: minimalPage(previous.lastSent)} : {})};
    const key = storageKey(entry);
    this.memory.set(key, entry);
    const storage = this.storage();
    if (!storage) throw new Error('Local draft storage is unavailable. Keep this tab open until your changes save.');
    storage.setItem(key, JSON.stringify(entry));
    // Persist the replacement before removing an older revision.
    for (const [oldKey, old] of this.all()) if (oldKey !== key && old.writerId === this.writerId && old.vaultId === page.vault_id && old.pageId === page.id) {
      storage.removeItem(oldKey); this.memory.delete(oldKey);
    }
    return clone(entry);
  }
  /** Preserve a competing recovery before the active writer slot is replaced. */
  retain(entry: PageDraftEntry): PageDraftEntry {
    const retained = {...clone(entry),id:uniqueId(),writerId:`recovered-${uniqueId()}`};
    const key = storageKey(retained), storage = this.storage();
    if (!storage) throw new Error('The other recovered draft could not be preserved. Keep this tab open and try again.');
    storage.setItem(key,JSON.stringify(retained)); this.memory.set(key,retained);
    return clone(retained);
  }
  markSent(entry: PageDraftEntry, page: Page): PageDraftEntry {
    const key = storageKey(entry), current = this.all().get(key);
    if (current?.id !== entry.id) return entry;
    const next = {...current, lastSent: minimalPage(page)};
    this.memory.set(key, next);
    const storage = this.storage();
    if (!storage) throw new Error('Local draft storage is unavailable. Keep this tab open until your changes save.');
    storage.setItem(key, JSON.stringify(next));
    for (const [oldKey, old] of this.all()) if (oldKey !== key && old.writerId === entry.writerId && old.vaultId === entry.vaultId && old.pageId === entry.pageId && old.updatedAt <= entry.updatedAt) {
      storage.removeItem(oldKey); this.memory.delete(oldKey);
    }
    return clone(next);
  }
  acknowledge(entry: PageDraftEntry, saved: Page, newer?: Page): void {
    if (saved.id !== entry.pageId || saved.vault_id !== entry.vaultId) return;
    if (newer) this.write({...newer, revision: saved.revision});
    this.discard(entry);
  }
  discard(entry: PageDraftEntry): void {
    const key = storageKey(entry), storage = this.storage();
    if (this.memory.get(key)?.id === entry.id) this.memory.delete(key);
    if (storage && parse(storage.getItem(key))?.id === entry.id) storage.removeItem(key);
  }
  private discardScope(predicate: (vaultId: string, pageId: string) => boolean): void {
    // Explicit vault/page cleanup also removes damaged records whose payload
    // cannot be parsed. Scope comes from the journal's own encoded key.
    for (const [key, entry] of this.memory) if (predicate(entry.vaultId, entry.pageId)) this.memory.delete(key);
    const storage = this.storage();
    if (!storage) return;
    const remove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const [vault, page] = key.slice(prefix.length).split(':');
      try {
        const vaultId = decodeURIComponent(vault ?? '');
        let pageId = '';
        try {pageId = decodeURIComponent(page ?? '');} catch { /* Vault cleanup still applies. */ }
        if (predicate(vaultId, pageId)) remove.push(key);
      }
      catch { /* An invalid encoded key has no trustworthy vault scope. */ }
    }
    for (const key of remove) storage.removeItem(key);
  }
  discardPage(vaultId: string, pageId: string): void {this.discardScope((vault, page) => vault === vaultId && page === pageId);}
  discardVault(vaultId: string): void {this.discardScope(vault => vault === vaultId);}
  pruneVault(vaultId: string, validIds: Set<string>): void {this.discardScope((vault, page) => vault === vaultId && !validIds.has(page));}
  pruneVaults(validVaultIds: Set<string>): void {this.discardScope(vault => !validVaultIds.has(vault));}
}

export const pageDraftJournal = new PageDraftJournal();
