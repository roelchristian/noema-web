import type { Page } from '../../shared/domain';
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';
const key = (page: Page) => `${page.vault_id}/${page.id}`;
/** Each snapshot keeps its vault and revision, even while navigation or edits continue. */
export class PageSaver {
  private pending = new Map<string, Page>();
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private send: (page: Page) => Promise<Page>,
    private onSaved: (page: Page) => void,
    private onStatus: (status: SaveStatus, error?: Error) => void,
  ) {}
  get hasPending() { return this.pending.size > 0 || this.running !== null; }
  enqueue(page: Page) {
    this.pending.set(key(page), structuredClone(page));
    this.onStatus('pending'); clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 400);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }
  private async drain() {
    try {
      while (this.pending.size) {
        this.onStatus('saving');
        const [id, snapshot] = this.pending.entries().next().value!;
        const saved = await this.send(snapshot);
        const newer = this.pending.get(id);
        if (newer === snapshot) this.pending.delete(id);
        else if (newer) newer.revision = saved.revision;
        this.onSaved(saved);
      }
      this.onStatus('saved');
    } catch (value) {
      const error = value instanceof Error ? value : new Error(String(value));
      this.onStatus('error', error); throw error;
    }
  }
  dispose() { clearTimeout(this.timer); }
}
