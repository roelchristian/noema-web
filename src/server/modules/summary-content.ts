import { isAIExplanation } from '../../shared/semantic-blocks.js';
import { createHash } from 'node:crypto';
import type { Page, Segment } from '../../shared/domain.js';

type SummaryPage = Pick<Page, 'title' | 'blocks'>;
type ResolveName = (id: string) => string | undefined;

/** Exactly the note text supplied to summary/title generation; styling is excluded. */
export function summaryInput(page: SummaryPage, name: ResolveName, includeTitle = true, includeAI = false): string {
  const plain = (content: Segment[]) => content.map(segment => segment.entityId ? name(segment.entityId) || '[mention]' : segment.text).join('');
  return (includeTitle ? page.title + '\n' : '') + page.blocks.filter(block => includeAI || !isAIExplanation(block)).map(block =>
    (block.type === 'table' ? (block.rows ?? []).map(row => row.map(plain).join('\t')).join('\n') : plain(block.content)) + '\n'
  ).join('');
}

export function summaryContentHash(page: SummaryPage, name: ResolveName, includeAI = false): string {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  // Generated explanations never stale their source summary. includeAI supports legacy hash migration.
  // Keep title and body separate, but ignore whitespace, block styles and text runs.
  const content = [normalize(page.title), normalize(summaryInput(page, name, false, includeAI))];
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/** Classification follows body meaning; automatic title changes do not invalidate it. */
export function conceptContentHash(page: SummaryPage, name: ResolveName): string {
  const plain=(segments:Segment[])=>segments.map(segment=>segment.entityId?segment.mentionText??name(segment.entityId)??'[mention]':segment.text??'').join('');
  const body=page.blocks.filter(block=>!isAIExplanation(block)).map(block=>block.type==='table'?(block.rows??[]).map(row=>row.map(plain).join('\t')).join('\n'):plain(block.content)).join('\n');
  return createHash('sha256').update(body.replace(/\s+/g,' ').trim().toLowerCase()).digest('hex');
}
