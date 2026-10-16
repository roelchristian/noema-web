import type { Page } from '../../shared/domain';
const key = (page: Page) => `${page.vault_id}/${page.id}`;
const untitled = (page: Page) => !page.title.trim() || page.title.trim() === 'Untitled';
interface Candidate { page: Page; version: number; running: boolean; timer?: ReturnType<typeof setTimeout> }
/** Only newly created pages qualify; each edit invalidates any outstanding result. */
export class PageTitler {
  private candidates = new Map<string, Candidate>();
  constructor(
    private generate: (page: Page) => Promise<{title: string; revision: number}>,
    private apply: (page: Page, title: string) => void,
  ) {}
  register(page: Page) {
    if (untitled(page)) this.candidates.set(key(page), {page, version: 0, running: false});
  }
  observe(page: Page, saved = false) {
    const candidate = this.candidates.get(key(page));
    if (!candidate) return;
    clearTimeout(candidate.timer); candidate.version++; candidate.page = page;
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
    } catch {
      // Background utilities are best effort. A later saved edit can try again;
      // missing credentials and provider errors must never interrupt writing.
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
