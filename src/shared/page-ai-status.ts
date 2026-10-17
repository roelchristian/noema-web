import type {Page, Segment} from './domain.js';
import {isAIExplanation} from './semantic-blocks.js';

export const pageAIStatuses = ['regular', 'regular_with_ai_explanations', 'ai_generated', 'ai_generated_edited'] as const;
export type PageAIStatus = typeof pageAIStatuses[number];
export const pageAIStatusLabels: Record<PageAIStatus, string> = {
  regular: 'Regular',
  regular_with_ai_explanations: 'Regular with AI explanations',
  ai_generated: 'AI-generated',
  ai_generated_edited: 'AI-generated, edited',
};
export const pageAIStatusDescriptions: Record<PageAIStatus, string> = {
  regular: 'A regular page without AI explanation blocks.',
  regular_with_ai_explanations: 'A regular page containing AI explanation blocks.',
  ai_generated: 'Created from an AI-generated draft.',
  ai_generated_edited: 'Created from an AI-generated draft, then edited by a user.',
};
export function isPageAIStatus(value: unknown): value is PageAIStatus {
  return pageAIStatuses.some(status => status === value);
}

/** Ignore automatic entity tagging and regenerated IDs while retaining visible edits and formatting. */
function authoredContent(page: Pick<Page, 'title' | 'blocks'>, name: (id: string) => string | undefined) {
  const content = (segments: Segment[]) => {
    const runs: {style: string; text: string}[] = [];
    for (const segment of segments) {
      const text = segment.entityId ? segment.mentionText ?? name(segment.entityId) ?? segment.entityId : segment.text ?? '';
      if (!text) continue;
      const style = JSON.stringify([!!segment.bold, !!segment.italic, !!segment.underline, !!segment.strike, !!segment.code, !!segment.math, segment.href ?? null]);
      const last = runs.at(-1);
      if (last?.style === style) last.text += text;
      else runs.push({style, text});
    }
    return runs;
  };
  return JSON.stringify([page.title, page.blocks.filter(block => !isAIExplanation(block)).map(block => [
    block.type, block.checked, block.column?.index ?? null, block.semantic ?? null,
    block.semanticGroup?.kind ?? null, content(block.content), block.rows?.map(row => row.map(content)) ?? null,
    block.imageId ?? null, block.alt ?? null,
  ])]);
}
export function nextPageAIStatus(previous: Pick<Page, 'title' | 'blocks' | 'aiStatus'>, next: Pick<Page, 'title' | 'blocks'>, name: (id: string) => string | undefined): PageAIStatus {
  if (previous.aiStatus === 'ai_generated_edited') return 'ai_generated_edited';
  if (previous.aiStatus === 'ai_generated') {
    return authoredContent(previous, name) === authoredContent(next, name) ? 'ai_generated' : 'ai_generated_edited';
  }
  return next.blocks.some(isAIExplanation) ? 'regular_with_ai_explanations' : 'regular';
}
