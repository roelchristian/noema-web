import type {Page, Segment} from './domain.js';
import {isAIExplanation} from './semantic-blocks.js';

export const pageAIStatuses = ['regular', 'regular_with_ai_explanations', 'ai_assisted', 'ai_generated', 'ai_generated_edited'] as const;
export type PageAIStatus = typeof pageAIStatuses[number];
export const pageAIStatusLabels: Record<PageAIStatus, string> = {
  regular: 'No recorded AI writing contributions',
  ai_assisted: 'AI writing edits accepted',
  regular_with_ai_explanations: 'Contains AI explanations',
  ai_generated: 'AI-generated',
  ai_generated_edited: 'AI-generated',
};
export const pageAIStatusDescriptions: Record<PageAIStatus, string> = {
  regular: 'No relevant AI writing contribution has been recorded.',
  ai_assisted: 'AI writing edits were accepted; this does not describe the current text.',
  regular_with_ai_explanations: 'At least one AI explanation block is present.',
  ai_generated: 'Created from an AI-generated draft.',
  ai_generated_edited: 'Created from an AI-generated draft. Recorded editing history: Edited after generation.',
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
      const style = JSON.stringify([!!segment.bold, !!segment.italic, !!segment.underline, !!segment.strike, !!segment.superscript, !!segment.subscript, !!segment.code, !!segment.math, segment.href ?? null]);
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
export function nextPageAIStatus(previous: Pick<Page, 'title' | 'blocks' | 'aiStatus' | 'aiReviewAccepted' | 'creationMethod' | 'generationMetadata' | 'editedAfterGeneration'>, next: Pick<Page, 'title' | 'blocks' | 'aiReviewAccepted' | 'editedAfterGeneration'>, name: (id: string) => string | undefined): PageAIStatus {
  if (previous.aiStatus === 'ai_generated_edited' || previous.editedAfterGeneration && pageProvenanceView(previous).origin === 'ai_generated') return 'ai_generated_edited';
  if (pageProvenanceView(previous).origin === 'ai_generated') {
    if(next.editedAfterGeneration||previous.title!==next.title)return 'ai_generated_edited';
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

/** Creation evidence is separate from durable contributions and surviving blocks. */
export type PageCreationMethod = 'manual_creation' | 'ai_generated';
export interface PageProvenanceView {
  origin: PageCreationMethod | 'unknown';
  generationType?: NonNullable<Page['generationMetadata']>['type'];
  editedAfterGeneration: boolean;
  acceptedAIWritingEdits: boolean;
  containsAIExplanations: boolean;
}
export const pageCreationLabels: Record<PageProvenanceView['origin'], string> = {
  manual_creation: 'Created in Noema', ai_generated: 'AI-generated', unknown: 'Not recorded',
};
type ProvenancePage = Pick<Page, 'aiStatus' | 'aiReviewAccepted' | 'creationMethod' | 'containsAIExplanations' | 'editedAfterGeneration'> & Partial<Pick<Page, 'blocks' | 'generationMetadata'>>;
export function pageProvenanceView(page: ProvenancePage): PageProvenanceView {
  const generated = page.aiStatus === 'ai_generated' || page.aiStatus === 'ai_generated_edited' || page.creationMethod === 'ai_generated' || !!page.generationMetadata;
  return {
    origin: generated ? 'ai_generated' : page.creationMethod === 'manual_creation' ? 'manual_creation' : 'unknown',
    ...(page.generationMetadata ? {generationType: page.generationMetadata.type} : {}),
    editedAfterGeneration: generated && (page.aiStatus === 'ai_generated_edited' || page.editedAfterGeneration === true),
    acceptedAIWritingEdits: !!page.aiReviewAccepted || page.aiStatus === 'ai_assisted',
    // Never use the legacy status here: it may describe blocks since deleted.
    containsAIExplanations: page.blocks ? page.blocks.some(isAIExplanation) : page.containsAIExplanations === true,
  };
}
export function pageAIProvenance(page: ProvenancePage) {
  const view = pageProvenanceView(page);
  const contributions = [
    ...(view.origin === 'ai_generated' ? ['AI-generated content'] : []),
    ...(view.acceptedAIWritingEdits ? [pageAIStatusLabels.ai_assisted] : []),
    ...(view.containsAIExplanations ? [pageAIStatusLabels.regular_with_ai_explanations] : []),
  ];
  const label = view.origin === 'ai_generated' ? pageAIStatusLabels.ai_generated : contributions[0] ?? '';
  return {...view, label, contributions, assisted: contributions.length > 0,
    description: [pageCreationLabels[view.origin], ...contributions,
      ...(view.origin === 'ai_generated' ? [view.editedAfterGeneration ? 'Edited after generation' : 'Unedited since generation'] : []),
    ].join(' · ')};
}
