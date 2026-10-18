import type { Block, Segment } from '../../shared/domain';
import { isAIExplanation } from '../../shared/semantic-blocks';

export interface CleanupOptions { paragraphBreaks: boolean; repeatedSpaces: boolean; lineEdges: boolean }
export const defaultCleanupOptions: CleanupOptions = {paragraphBreaks: true, repeatedSpaces: true, lineEdges: true};

/** Keep each remaining character attached to its original rich-text segment. */
function cleanSegments(segments: Segment[], options: CleanupOptions): Segment[] {
  const protectedSegment = (segment: Segment) => !!(segment.entityId || segment.code || segment.math || segment.sourceReference);
  let characters = segments.flatMap((segment, owner) => (protectedSegment(segment) ? ['\ufffc'] : (segment.text ?? '').split('')).map(text => ({text, owner})));
  function replace(pattern: RegExp, keep: number, replacement?: string) {
    const text = characters.map(character => character.text).join('');
    for (const match of [...text.matchAll(pattern)].reverse()) {
      const start = match.index!;
      if (replacement !== undefined) characters[start].text = replacement;
      characters.splice(start + keep, match[0].length - keep);
    }
  }
  if (options.lineEdges) replace(/^[ \t\u00a0]+|[ \t\u00a0]+$/gm, 0);
  if (options.repeatedSpaces) replace(/[ \t\u00a0]{2,}/g, 1, ' ');
  if (options.paragraphBreaks) replace(/\n{3,}/g, 2);
  const text = segments.map(() => '');
  for (const character of characters) text[character.owner] += character.text;
  let changed = false;
  const result = segments.flatMap((segment, index) => {
    if (protectedSegment(segment) || text[index] === segment.text) return [segment];
    changed = true;
    return text[index] ? [{...segment, text: text[index]} as Segment] : [];
  });
  return changed ? result : segments;
}

function blankParagraph(block: Block) {
  return block.type === 'paragraph' && !block.column && !block.semantic && !block.semanticGroup && block.content.every(segment => !segment.entityId && !segment.code && !segment.math && !segment.sourceReference && !(segment.text ?? '').trim());
}

export function cleanNote(blocks: Block[], options: CleanupOptions) {
  let changedBlocks = 0;
  const normalized = blocks.map(block => {
    if (block.type === 'image' || block.type === 'math' || isAIExplanation(block)) return block;
    if (block.type === 'table' || block.type === 'columns') {
      let changed = false;
      const rows = block.rows?.map(row => row.map(cell => {
        const next = cleanSegments(cell, options);
        if (next !== cell) changed = true;
        return next;
      }));
      if (!changed) return block;
      changedBlocks++;
      return {...block, rows};
    }
    const content = cleanSegments(block.content, options);
    if (content === block.content) return block;
    changedBlocks++;
    return {...block, content};
  });
  let result = normalized;
  if (options.paragraphBreaks) {
    result = normalized.filter((block, index) => !blankParagraph(block) || index === 0 || !blankParagraph(normalized[index - 1]));
    const firstContent = result.findIndex(block => !blankParagraph(block));
    if (firstContent >= 0) {
      let lastContent = result.length - 1;
      while (blankParagraph(result[lastContent])) lastContent--;
      result = result.slice(firstContent, lastContent + 1);
    }
  }
  const removedBlocks = blocks.length - result.length;
  // Preserve the original array for a no-op so autosave and matching stay quiet.
  return {blocks: changedBlocks || removedBlocks ? result : blocks, changedBlocks, removedBlocks};
}
