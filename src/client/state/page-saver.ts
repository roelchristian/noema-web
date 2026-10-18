import type { Page } from '../../shared/domain';
import {pageDraftJournal, type PageDraftEntry, type PageDraftJournal} from './page-draft-journal';
export type SaveStatus = 'saved' | 'pending' | 'identifying' | 'saving' | 'error';
const key = (page: Pick<Page, 'vault_id' | 'id'>) => `${page.vault_id}/${page.id}`;
const asError = (value: unknown) => value instanceof Error ? value : new Error(String(value));
/** Each snapshot keeps its vault and revision, even while navigation or edits continue. */
export class PageSaver {
  private pending = new Map<string, Page>();
  private journalEntries = new Map<string, PageDraftEntry>();
  private failed = new Set<string>();
  private statuses = new Map<string, SaveStatus>();
  private generations = new Map<string, number>();
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private send: (page: Page) => Promise<Page>,
    private onSaved: (page: Page, original: Page) => void,
    private onStatus: (status: SaveStatus, error?: Error, page?: Page) => void,
    private prepare?: (page: Page) => Promise<Page>,
    private onJournalError?: (error: Error | null, page: Page) => void,
    private journal: PageDraftJournal = pageDraftJournal,
  ) {}
  get hasPending() { return this.pending.size > 0 || this.running !== null; }
  statusFor(vaultId: string, pageId: string): SaveStatus {return this.statuses.get(key({vault_id: vaultId, id: pageId})) ?? 'saved';}
  pendingPage(vaultId: string, pageId: string): Page | undefined {
    const page = this.pending.get(key({vault_id: vaultId, id: pageId}));
    return page ? structuredClone(page) : undefined;
  }
  private status(status: SaveStatus, page: Page, error?: Error) {
    this.statuses.set(key(page), status); this.onStatus(status, error, page);
  }
  private persistedEntry(page: Page) {
    return this.journal.entries(page.vault_id, page.id).find(entry => entry.writerId === this.journal.writerId);
  }
  private persist(page: Page) {
    try {
      const entry = this.journal.write(page);
      this.journalEntries.set(key(page), entry); this.onJournalError?.(null, page);
    } catch (value) {
      const entry = this.persistedEntry(page);
      if (entry) this.journalEntries.set(key(page), entry);
      this.onJournalError?.(asError(value), page);
    }
  }
  enqueue(page: Page) {
    const snapshot = structuredClone(page), id = key(snapshot);
    this.pending.set(id, snapshot); this.failed.delete(id);
    this.persist(snapshot);
    this.status('pending', snapshot); clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(false).catch(() => {}); }, 400);
  }
  retry(vaultId: string, pageId: string): Promise<void> {
    const id = key({vault_id: vaultId, id: pageId});
    const start = () => {this.failed.delete(id); return this.run(new Set([id]));};
    return this.running ? this.running.catch(() => {}).then(start) : start();
  }
  discard(vaultId: string, pageId: string, discardJournal = true): void {
    const id = key({vault_id: vaultId, id: pageId});
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.pending.delete(id); this.failed.delete(id); this.statuses.delete(id); this.journalEntries.delete(id);
    if (discardJournal) this.journal.discardPage(vaultId, pageId);
  }
  flush(retryFailed = true): Promise<void> {
    clearTimeout(this.timer);
    if (retryFailed) this.failed.clear();
    return this.run();
  }
  private run(only?: Set<string>): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain(only).finally(() => {
      this.running = null;
      if ([...this.pending.keys()].some(id => !this.failed.has(id))) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {void this.flush(false).catch(() => {});}, 0);
      }
    });
    return this.running;
  }
  private async drain(only?: Set<string>) {
    let firstError: Error | undefined;
    const attemptedFailures = new Set<string>();
    while (this.pending.size) {
      const next = [...this.pending.entries()].find(([id]) => !this.failed.has(id) && !attemptedFailures.has(id) && (!only || only.has(id)));
      if (!next) break;
      const [id, snapshot] = next;
      const generation = this.generations.get(id) ?? 0;
      try {
        let prepared = snapshot;
        if (this.prepare) {
          this.status('identifying', snapshot);
          prepared = await this.prepare(snapshot);
          if (this.pending.get(id) !== snapshot) continue;
        }
        let entry = this.journalEntries.get(id);
        if (entry) {
          try {entry = this.journal.markSent(entry, prepared); this.journalEntries.set(id, entry); this.onJournalError?.(null, prepared);}
          catch (value) {entry = this.persistedEntry(snapshot) ?? entry; this.onJournalError?.(asError(value), snapshot);}
        }
        this.status('saving', snapshot);
        const saved = await this.send(prepared);
        if ((this.generations.get(id) ?? 0) !== generation) continue;
        const newer = this.pending.get(id);
        if (newer === snapshot) this.pending.delete(id);
        else if (newer) newer.revision = saved.revision;
        try {
          if (entry) this.journal.acknowledge(entry, saved, newer && newer !== snapshot ? newer : undefined);
          else if (newer && newer !== snapshot) this.persist(newer);
          if (newer && newer !== snapshot) {
            const rebased = this.persistedEntry(newer);
            if (rebased) this.journalEntries.set(id, rebased);
          } else this.journalEntries.delete(id);
          this.onJournalError?.(null, newer ?? saved);
        } catch (value) {this.onJournalError?.(asError(value), newer ?? saved);}
        this.failed.delete(id);
        this.onSaved(saved, snapshot);
        this.status(newer && newer !== snapshot ? 'pending' : 'saved', newer && newer !== snapshot ? newer : saved);
      } catch (value) {
        if ((this.generations.get(id) ?? 0) !== generation) continue;
        const error = asError(value);
        this.failed.add(id); attemptedFailures.add(id); firstError ??= error;
        this.status('error', snapshot, error);
      }
    }
    if (firstError) throw firstError;
  }
  dispose() { clearTimeout(this.timer); }
}
