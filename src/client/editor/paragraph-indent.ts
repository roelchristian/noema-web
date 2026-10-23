import type {Block} from '../../shared/domain';

/** Track prose sections independently in each column; callouts do not consume an opening paragraph. */
export function paragraphFlow(blocks: readonly Block[]): Map<string, 'first' | 'continuation'> {
  const result = new Map<string, 'first' | 'continuation'>();
  const started = new Set<string>();
  for (const block of blocks) {
    if (block.semantic || block.semanticGroup) continue;
    const scope = block.column ? `${block.column.id}:${block.column.index}` : 'page';
    if (block.type === 'heading1' || block.type === 'heading2' || block.type === 'divider') started.delete(scope);
    if (block.type !== 'paragraph') continue;
    result.set(block.id, started.has(scope) ? 'continuation' : 'first');
    if (block.content.some(segment => segment.entityId || segment.math || segment.text?.trim())) started.add(scope);
  }
  return result;
}
