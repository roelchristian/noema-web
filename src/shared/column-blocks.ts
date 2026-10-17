import {blockSegments, type Block, type BlockType} from './domain.js';
import {isAIExplanation} from './semantic-blocks.js';

export function allowedInColumn(type: BlockType) {return type !== 'columns' && type !== 'table';}

/** Upgrade legacy text cells to ordinary blocks with a shared column layout. */
export function expandColumnBlocks(blocks: Block[]): Block[] {
  if (!blocks.some(block => block.type === 'columns' && !isAIExplanation(block))) return blocks;
  const ids = new Set(blocks.map(block => block.id));
  return blocks.flatMap(block => {
    if (block.type !== 'columns' || isAIExplanation(block)) return [block];
    let rightId = block.id + '-right';
    while (ids.has(rightId)) rightId += '-right';
    ids.add(rightId);
    return ([0, 1] as const).map(index => ({
      ...block, id: index === 0 ? block.id : rightId, type: 'paragraph' as const,
      content: block.rows?.[0]?.[index] ?? [], rows: undefined,
      column: {id: block.id, index},
    }));
  });
}

/** Split disconnected layouts so moving a block never pulls distant content into it. */
export function normalizeColumnBlocks(blocks: Block[]): Block[] {
  const unnested = blocks.map(block => block.column && !allowedInColumn(block.type)
    ? {...block,type:'paragraph' as const,content:block.rows?.flatMap((row, index) => [...(index ? [{text:'\n'}] : []), ...row.flatMap((cell, column) => [...(column ? [{text:'\t'}] : []), ...cell])]) ?? blockSegments(block),rows:undefined} : block);
  const expanded = expandColumnBlocks(unnested);
  let current: string | undefined, detached = false;
  const seen = new Set<string>();
  const normalized = expanded.map(block => {
    const id = block.column?.id;
    if (id !== current) {
      detached = !!id && seen.has(id);
      if (id) seen.add(id);
      current = id;
    }
    return detached ? {...block, column: undefined} : block;
  });
  // Keep document order identical to the visual reading order for selection and keyboard actions.
  const result: Block[] = [];
  for (let index = 0; index < normalized.length;) {
    const block = normalized[index]!;
    if (!block.column) {result.push(block); index++; continue;}
    let end = index + 1;
    while (end < normalized.length && normalized[end]!.column?.id === block.column.id) end++;
    result.push(...normalized.slice(index, end).sort((a, b) => a.column!.index - b.column!.index));
    index = end;
  }
  return result.every((block, index) => block === blocks[index]) && result.length === blocks.length ? blocks : result;
}
