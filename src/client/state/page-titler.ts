import type { Page } from '../../shared/domain';
const key = (page: Page) => `${page.vault_id}/${page.id}`;
const untitled = (page: Page) => !page.title.trim() || page.title.trim() === 'Untitled';
interface Candidate { page: Page; version: number; running: boolean; retries: number; timer?: ReturnType<typeof setTimeout> }
/** Untitled pages resume when opened; each edit invalidates any outstanding result. */
export class PageTitler {
  private candidates = new Map<string, Candidate>();
  constructor(
    private generate: (page: Page) => Promise<{title: string; revision: number}>,
    private apply: (page: Page, title: string) => void,
  ) {}
  register(page: Page) {
    if (untitled(page) && !this.candidates.has(key(page))) this.candidates.set(key(page), {page, version: 0, running: false, retries: 0});
  }
  observe(page: Page, saved = false) {
    const candidate = this.candidates.get(key(page));
    if (!candidate) return;
    clearTimeout(candidate.timer); candidate.version++; candidate.page = page; candidate.retries = 0;
    if (!untitled(page)) { this.remove(page); return; }
    const text = page.blocks.flatMap(block => block.type === 'table'
      ? (block.rows ?? []).flatMap(row => row.flatMap(cell => cell)) : block.content)
      .map(segment => segment.text || '').join(' ').trim();
    if (saved && text.length >= 20) {
      candidate.timer = setTimeout(() => { void this.run(candidate); }, 3000);
    }
  }
  private async run(candidate: Candidate) {
    if (candidate.running) {
      candidate.timer = setTimeout(() => { void this.run(candidate); }, 3000);
      return;
    }
    const {page, version} = candidate;
    candidate.running = true;
    try {
      const result = await this.generate(page);
      if (this.candidates.get(key(page)) !== candidate || candidate.version !== version || result.revision !== page.revision) return;
      this.remove(page);
      this.apply(page, result.title);
    } catch (error) {
      // Retry temporary provider/network failures, but never overwrite a newer edit.
      // Missing credentials and permanent failures wait for a later saved edit/open.
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      if (this.candidates.get(key(page)) === candidate && candidate.version === version &&
          (status === 429 || status === 502 || status === 503 || error instanceof TypeError) && candidate.retries < 2) {
        const delay = candidate.retries++ === 0 ? 15000 : 60000;
        candidate.timer = setTimeout(() => { void this.run(candidate); }, delay);
      }
    } finally { candidate.running = false; }
  }
  remove(page: Page) {
    clearTimeout(this.candidates.get(key(page))?.timer);
    this.candidates.delete(key(page));
  }
  dispose() {
    for (const candidate of this.candidates.values()) clearTimeout(candidate.timer);
    this.candidates.clear();
  }
}
