import type { EntityInput, EntityType, Page, Segment, Entity } from './domain.js';
export interface EntitySuggestion extends EntityInput {
  id: string; evidence: string; reason: string; existingId: string | null;
  status: 'pending' | 'accepted' | 'rejected';
}
export interface EntitySuggestionEdit { id: string; name: string; type: EntityType; subtypes: string[]; existingId: string | null }
export interface EntityScan { id: string; revision: number; suggestions: EntitySuggestion[] }
export interface EntityReview { page: Page; scan: EntityScan; entities: Entity[] }

// Match within adjacent text segments, including phrases spanning formatting.
// Existing mentions form a boundary and are never replaced.
export function mentionEvidence(page: Page, evidence: string, entityId: string): Page | null {
  if (!evidence.trim()) return null;
  let replaced = false;
  function replace(segments: Segment[]): Segment[] {
    if (replaced) return segments;
    const output: Segment[] = [];
    for (let i = 0; i < segments.length;) {
      if (segments[i]!.entityId || segments[i]!.math) { output.push(segments[i++]!); continue; }
      const run: Extract<Segment, {text: string}>[] = [];
      while (i < segments.length && !segments[i]!.entityId && !segments[i]!.math) run.push(segments[i++]! as Extract<Segment, {text: string}>);
      const index = replaced ? -1 : run.map(s => s.text || '').join('').indexOf(evidence);
      if (index < 0) { output.push(...run); continue; }
      let offset = 0, inserted = false;
      for (const segment of run) {
        const value = segment.text || '', end = offset + value.length;
        if (end <= index || offset >= index + evidence.length) output.push(segment);
        else {
          if (offset < index) output.push({...segment, text: value.slice(0, index - offset)});
          if (!inserted) { output.push({entityId}); inserted = true; }
          if (end > index + evidence.length) output.push({...segment, text: value.slice(index + evidence.length - offset)});
        }
        offset = end;
      }
      replaced = true;
    }
    return output;
  }
  const blocks = page.blocks.map(block => block.type === 'math' ? block : block.type === 'table'
    ? {...block, rows: block.rows?.map(row => row.map(replace))}
    : {...block, content: replace(block.content)});
  return replaced ? {...page, blocks} : null;
}
