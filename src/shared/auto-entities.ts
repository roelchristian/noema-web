import { blockSegments, isEntityTaggingText, type Block, type Entity, type Segment } from './domain.js';

export const normalizeEntityName = (name: string) => name.trim().replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface AmbiguousEntityMatch { id: string; text: string; context: string; entityIds: string[] }
export interface EntityMatchResolution { match: AmbiguousEntityMatch; entityId: string; all?: boolean }
export function linkedEntityIds(blocks: Block[]) {
  return new Set(blocks.filter(block => block.type !== 'math' && block.type !== 'image').flatMap(block => blockSegments(block).flatMap(segment => segment.entityId ? [segment.entityId] : [])));
}

/** Deterministic links for unique names and aliases; collisions are returned for review. */
export function identifyEntityMentions(blocks: Block[], entities: Entity[], vaultId: string, resolution?: EntityMatchResolution, pageContext = linkedEntityIds(blocks)) {
  const names = new Map<string, Entity[]>();
  const ambiguous: AmbiguousEntityMatch[] = [];
  for (const entity of entities) {
    if (entity.vault_id !== vaultId) continue;
    for (const value of [entity.name, ...(entity.aliases ?? [])]) {
      const name = normalizeEntityName(value);
      if (!name) continue;
      const matches = names.get(name) ?? [];
      if (!matches.some(item => item.id === entity.id)) matches.push(entity);
      names.set(name, matches);
    }
  }
  const candidates = [...names.entries()].sort((a, b) => b[0].length - a[0].length);
  if (!candidates.length) return {blocks, count: 0, ambiguous};
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${candidates.map(([name]) => name.split(' ').map(part => escape(part).replace(/'/g, "['‘’]").replace(/"/g, '["“”]')).join('\\s+')).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  let count = 0;
  function segments(content: Segment[], location: string): Segment[] {
    const output: Segment[] = [];
    const resolved: AmbiguousEntityMatch[] = [];
    let added = 0;
    for (let index = 0; index < content.length;) {
      const first = content[index]!;
      if (!isEntityTaggingText(first)) { output.push(first); index++; continue; }
      const run: {segment: Segment; start: number; end: number}[] = [];
      const runStart = index;
      let text = '';
      while (index < content.length) {
        const segment = content[index]!;
        if (!isEntityTaggingText(segment)) break;
        const start = text.length; text += segment.text ?? '';
        run.push({segment, start, end: text.length}); index++;
      }
      const appendText = (start: number, end: number) => {
        for (const item of run) {
          const from = Math.max(start, item.start), to = Math.min(end, item.end);
          if (from < to) { const {entityId, mentionText, text: previousText, ...style} = item.segment; output.push({...style, text: text.slice(from, to)}); }
        }
      };
      pattern.lastIndex = 0;
      let start = 0;
      for (const match of text.matchAll(pattern)) {
        const matches = names.get(normalizeEntityName(match[0])) ?? [];
        let entity = matches.length === 1 ? matches[0] : undefined;
        if (matches.length > 1) {
          const candidate: AmbiguousEntityMatch = {id: `${location}:${runStart}:${match.index}`, text: match[0], context: text.slice(Math.max(0, match.index! - 45), match.index! + match[0].length + 45), entityIds: matches.map(item => item.id)};
          const explicit = resolution && (resolution.all ? normalizeEntityName(candidate.text) === normalizeEntityName(resolution.match.text) : candidate.id === resolution.match.id && candidate.text === resolution.match.text);
          const onPage = matches.filter(item => pageContext.has(item.id));
          if (explicit) entity = matches.find(item => item.id === resolution.entityId);
          else if (onPage.length === 1) entity = onPage[0];
          if (!entity) ambiguous.push(candidate);
          else resolved.push(candidate);
        }
        if (!entity) continue;
        appendText(start, match.index!);
        output.push({entityId: entity.id, ...(normalizeEntityName(match[0]) !== normalizeEntityName(entity.name) ? {mentionText: match[0]} : {})}); added++;
        start = match.index! + match[0].length;
      }
      appendText(start, text.length);
    }
    // Respect the API's segment limit rather than turn a valid note unsaveable.
    if (!added || output.length > 1000) { ambiguous.push(...resolved); return content; }
    count += added;
    return output;
  }
  const result = blocks.map(block => {
    if (block.type === 'math' || block.type === 'image') return block;
    if (block.type === 'table') {
      let changed = false;
      const rows = block.rows?.map((row, rowIndex) => row.map((cell, colIndex) => { const next = segments(cell, JSON.stringify([block.id, rowIndex, colIndex])); changed ||= next !== cell; return next; }));
      return changed ? {...block, rows} : block;
    }
    const content = segments(block.content, JSON.stringify([block.id]));
    return content === block.content ? block : {...block, content};
  });
  return {blocks: count ? result : blocks, count, ambiguous};
}
