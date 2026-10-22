import type {Page, Segment} from './domain.js';
import {isAIExplanation} from './semantic-blocks.js';

export const pageAIStatuses = ['regular', 'regular_with_ai_explanations', 'ai_assisted', 'ai_generated', 'ai_generated_edited'] as const;
export type PageAIStatus = typeof pageAIStatuses[number];
export const pageAIStatusLabels: Record<PageAIStatus, string> = {
  regular: 'Regular',
  ai_assisted: 'AI-assisted',
  regular_with_ai_explanations: 'Regular with AI explanations',
  ai_generated: 'AI-generated',
  ai_generated_edited: 'AI-generated, edited',
};
export const pageAIStatusDescriptions: Record<PageAIStatus, string> = {
  regular: 'A regular page without AI explanation blocks or accepted AI writing edits.',
  ai_assisted: 'Includes accepted AI writing edits.',
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
export function nextPageAIStatus(previous: Pick<Page, 'title' | 'blocks' | 'aiStatus' | 'aiReviewAccepted'>, next: Pick<Page, 'title' | 'blocks' | 'aiReviewAccepted'>, name: (id: string) => string | undefined): PageAIStatus {
  if (previous.aiStatus === 'ai_generated_edited') return 'ai_generated_edited';
  if (previous.aiStatus === 'ai_generated') {
    if(previous.title!==next.title)return 'ai_generated_edited';
    const before=previous.blocks.filter(block=>!isAIExplanation(block)),after=next.blocks.filter(block=>!isAIExplanation(block));
    const same=before.length===after.length && before.every((block,i)=>block===after[i] || authoredContent({title:'',blocks:[block]},name)===authoredContent({title:'',blocks:[after[i]!]},name));
    return same ? 'ai_generated' : 'ai_generated_edited';
  }
  if(previous.aiReviewAccepted||next.aiReviewAccepted||previous.aiStatus==='ai_assisted')return 'ai_assisted';
  return next.blocks.some(isAIExplanation) ? 'regular_with_ai_explanations' : 'regular';
}

/** Read legacy origin together with the durable record of accepted writing edits. */
export function reviewedPageAIStatus(status:PageAIStatus,accepted:boolean):PageAIStatus {
  return accepted&&(status==='regular'||status==='regular_with_ai_explanations')?'ai_assisted':status;
}

/** Accepted reviews assist authorship without changing a page's generated origin. */
export function pageAIProvenance(page:Pick<Page,'aiStatus'|'aiReviewAccepted'>){
  const status=reviewedPageAIStatus(page.aiStatus??'regular',!!page.aiReviewAccepted);
  if(page.aiReviewAccepted){
    const generated=status==='ai_generated'||status==='ai_generated_edited';
    return {label:generated?pageAIStatusLabels[status]:'AI-assisted',description:(generated?pageAIStatusDescriptions[status]+' ':'')+'Includes accepted AI writing edits.',assisted:true};
  }
  return {label:pageAIStatusLabels[status],description:pageAIStatusDescriptions[status],assisted:status!=='regular'};
}
