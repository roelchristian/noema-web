import type { PageDomains, Page } from '../../shared/domain';
const key = (page: Page) => `${page.vault_id}/${page.id}`;
// Observation is read-only; generation debounce and retry policy remain server-owned.
const refreshDelay = 2000;
const untitled = (page: Page) => !page.title.trim() || page.title.trim() === 'Untitled';
interface Candidate { page: Page; version: number; running: boolean; timer?: ReturnType<typeof setTimeout> }
/** Observe persisted background results; the server queue owns generation and retries. */
export class PageTitler {
  private candidates = new Map<string, Candidate>();
  constructor(
    private readPage: (page: Page) => Promise<Pick<Page,'title'|'revision'> & Partial<Page>>,
    private apply: (page: Page, title: string,classification?:PageDomains,metadata?:Partial<Page>) => void,
    private entityName: (id: string) => string = () => '',
  ) {}
  register(page: Page) {
    if (!page.editLocked && !this.candidates.has(key(page))) this.candidates.set(key(page), {page, version: 0, running: false});
  }
  observe(page: Page, saved = false) {
    this.register(page);
    const candidate = this.candidates.get(key(page));
    if (!candidate) return;
    clearTimeout(candidate.timer); candidate.version++; candidate.page = page;
    if (page.editLocked) { this.remove(page); return; }
    const text = page.blocks.flatMap(block => (block.type === 'table' || block.type === 'columns')
      ? (block.rows ?? []).flatMap(row => row.flatMap(cell => cell)) : block.content)
      .map(segment => segment.entityId ? this.entityName(segment.entityId) : segment.text || '').join(' ').trim();
    if (saved && text.length >= 20) {
      candidate.timer = setTimeout(() => { void this.run(candidate); }, refreshDelay);
    }
  }
  private async run(candidate: Candidate) {
    if (candidate.running || typeof document !== 'undefined' && document.hidden) {
      candidate.timer = setTimeout(() => { void this.run(candidate); }, refreshDelay);
      return;
    }
    const {page, version} = candidate;
    candidate.running = true;
    try {
      const result = await this.readPage(page);
      if (this.candidates.get(key(page)) !== candidate || candidate.version !== version || result.revision !== page.revision) return;
      this.apply(page, untitled(page)?result.title:page.title, result.pageDomains, result);
      if(result.enrichmentPending) {
        // Poll persisted state only; reads cannot dispatch work or reset its retry budget.
        candidate.timer=setTimeout(()=>{void this.run(candidate);},refreshDelay);
      }else this.remove(page);
    } catch {
      // Read failures are quiet. A later saved edit/open can resume observation.
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
