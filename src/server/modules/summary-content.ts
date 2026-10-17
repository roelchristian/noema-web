import { createHash } from 'node:crypto';
import type { Page, Segment } from '../../shared/domain.js';

type SummaryPage = Pick<Page, 'title' | 'blocks'>;
type ResolveName = (id: string) => string | undefined;

/** Exactly the note text supplied to summary/title generation; styling is excluded. */
export function summaryInput(page: SummaryPage, name: ResolveName, includeTitle = true): string {
  const plain = (content: Segment[]) => content.map(segment => segment.entityId ? name(segment.entityId) || '[mention]' : segment.text).join('');
  return (includeTitle ? page.title + '\n' : '') + page.blocks.map(block =>
    (block.type === 'table' ? (block.rows ?? []).map(row => row.map(plain).join('\t')).join('\n') : plain(block.content)) + '\n'
  ).join('');
}

export function summaryContentHash(page: SummaryPage, name: ResolveName): string {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  // Keep title and body separate, but ignore whitespace, block styles and text runs.
  const content = [normalize(page.title), normalize(summaryInput(page, name, false))];
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
