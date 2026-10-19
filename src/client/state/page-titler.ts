import type { PageDomains, Page } from '../../shared/domain';
import {TAXONOMY_VERSION} from '../../shared/domains';
const key = (page: Page) => `${page.vault_id}/${page.id}`;
// The server's drift assessment owns freshness; changed bytes alone do not invalidate subjects.
const needsUtility=(page:Page)=>!page.editLocked && (untitled(page) || page.pageDomains?.origin!=='manual' && (!page.pageDomains || page.pageDomains.taxonomyVersion!==TAXONOMY_VERSION || page.pageDomains.status==='needs_refresh' || page.pageDomains.status==='unclassified'));
const idleDelay=(page:Page)=>untitled(page)?10_000:!page.pageDomains||page.pageDomains.status==='unclassified'?12_000:40_000;
const untitled = (page: Page) => !page.title.trim() || page.title.trim() === 'Untitled';
interface Candidate { page: Page; version: number; running: boolean; timer?: ReturnType<typeof setTimeout> }
/** Observe persisted background results; the server queue owns generation and retries. */
export class PageTitler {
  private candidates = new Map<string, Candidate>();
  constructor(
    private readPage: (page: Page) => Promise<{title: string; revision: number;pageDomains?:PageDomains;enrichmentPending?:boolean}>,
    private apply: (page: Page, title: string,classification?:PageDomains) => void,
    private entityName: (id: string) => string = () => '',
  ) {}
  register(page: Page) {
    if (needsUtility(page) && !this.candidates.has(key(page))) this.candidates.set(key(page), {page, version: 0, running: false});
  }
  observe(page: Page, saved = false) {
    this.register(page);
    const candidate = this.candidates.get(key(page));
    if (!candidate) return;
    clearTimeout(candidate.timer); candidate.version++; candidate.page = page;
    if (!needsUtility(page)) { this.remove(page); return; }
    const text = page.blocks.flatMap(block => (block.type === 'table' || block.type === 'columns')
      ? (block.rows ?? []).flatMap(row => row.flatMap(cell => cell)) : block.content)
      .map(segment => segment.entityId ? this.entityName(segment.entityId) : segment.text || '').join(' ').trim();
    if (saved && text.length >= 20) {
      candidate.timer = setTimeout(() => { void this.run(candidate); }, idleDelay(page));
    }
  }
  private async run(candidate: Candidate) {
    if (candidate.running) {
      candidate.timer = setTimeout(() => { void this.run(candidate); }, idleDelay(candidate.page));
      return;
    }
    const {page, version} = candidate;
    candidate.running = true;
    try {
      const result = await this.readPage(page);
      if (this.candidates.get(key(page)) !== candidate || candidate.version !== version || result.revision !== page.revision) return;
      this.apply(page, untitled(page)?result.title:page.title, result.pageDomains);
      if(result.enrichmentPending) {
        // Poll persisted state only; reads cannot dispatch work or reset its retry budget.
        candidate.timer=setTimeout(()=>{void this.run(candidate);},untitled({...page,title:result.title})?5000:40_000);
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
