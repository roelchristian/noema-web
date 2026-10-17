import { isEntityTaggingText, type EntityInput, type EntityType, type Page, type Segment, type Entity } from './domain.js';
export interface EntitySuggestion extends EntityInput {
  id: string; evidence: string; reason: string; existingId: string | null;
  status: 'pending' | 'accepted' | 'rejected';
}
export interface EntitySuggestionEdit { id: string; name: string; type: EntityType; subtypes: string[]; existingId: string | null }
export interface EntityScan { id: string; revision: number; suggestions: EntitySuggestion[] }
export interface EntityReview { page: Page; scan: EntityScan; entities: Entity[] }

// Match within adjacent text segments, including phrases spanning formatting.
// Existing mentions, formulas, and excluded text form boundaries and are never replaced.
// Match whitespace equivalently while slicing the original, unnormalized text.
export function mentionEvidence(page: Page, evidence: string, entityId: string): Page | null {
  if (!evidence.trim()) return null;
  const pattern = new RegExp(evidence.trim().split(/\s+/u).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'u');
  let replaced = false;
  function replace(segments: Segment[]): Segment[] {
    if (replaced) return segments;
    const output: Segment[] = [];
    for (let i = 0; i < segments.length;) {
      if (!isEntityTaggingText(segments[i]!)) { output.push(segments[i++]!); continue; }
      const run: Extract<Segment, {text: string}>[] = [];
      while (i < segments.length && isEntityTaggingText(segments[i]!)) run.push(segments[i++]! as Extract<Segment, {text: string}>);
      const match = replaced ? null : pattern.exec(run.map(s => s.text || '').join(''));
      if (!match) { output.push(...run); continue; }
      const index = match.index, matchEnd = index + match[0].length;
      let offset = 0, inserted = false;
      for (const segment of run) {
        const value = segment.text || '', end = offset + value.length;
        if (end <= index || offset >= matchEnd) output.push(segment);
        else {
          if (offset < index) output.push({...segment, text: value.slice(0, index - offset)});
          if (!inserted) { output.push({entityId, ...(match[0] !== evidence ? {mentionText:match[0]} : {})}); inserted = true; }
          if (end > matchEnd) output.push({...segment, text: value.slice(matchEnd - offset)});
        }
        offset = end;
      }
      replaced = true;
    }
    return output;
  }
  const blocks = page.blocks.map(block => block.type === 'math' || block.type === 'image' ? block : block.type === 'table'
    ? {...block, rows: block.rows?.map(row => row.map(replace))}
    : {...block, content: replace(block.content)});
  return replaced ? {...page, blocks} : null;
}
